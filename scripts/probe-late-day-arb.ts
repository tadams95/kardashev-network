// Late-Day Observation Arbitrage Probe
//
// Long-running poller that captures Kalshi orderbook + ground-truth temp
// observations during the last 6 hours of each weather bracket's local-time
// observation window. Writes one row per market per poll cycle to the
// `kalshi_late_day_snapshots` collection.
//
// Hypothesis being tested: when observed-so-far + remaining-hours uncertainty
// makes a bracket near-certain, does Kalshi pricing reflect that or is there
// a persistent gap that can be exploited?
//
// Run modes:
//   tsx scripts/probe-late-day-arb.ts --dry-run    # one cycle, console only
//   tsx scripts/probe-late-day-arb.ts              # long-running, persists to mongo
//
// Designed to run under PM2 as `kardashev-late-day-probe`.

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config()

import { getDb, closeClient } from '../src/lib/db/mongodb'
import { CITY_COORDS } from '../src/lib/utils/cityCoordinates'

// ============================================================================
// Constants
// ============================================================================

const KALSHI_API_BASE = 'https://api.elections.kalshi.com/trade-api/v2'
const POLL_INTERVAL_MS = 60_000
const HEARTBEAT_INTERVAL_MS = 10 * 60_000
const LATE_WINDOW_HOURS = 6
const COLLECTION = 'kalshi_late_day_snapshots'
const TTL_DAYS = 30
const SLEEP_BETWEEN_REQUESTS_MS = 200
const IOWA_USER_AGENT = 'KardashevNetwork late-day-probe/1.0 (https://github.com/tadams95/kardashev-network)'

const CITIES_TO_MONITOR = [
  'NY', 'CHI', 'BOS', 'DAL', 'HOU', 'MIA', 'AUS',
  'SF', 'LA', 'PHX', 'SEA', 'DEN', 'ATL', 'PHI', 'DC', 'LV',
]

const SERIES_PREFIXES = ['KXHIGH', 'KXHIGHT', 'KXLOWT']

const MONTHS: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
}

// ============================================================================
// Types
// ============================================================================

interface KalshiMarket {
  ticker: string
  event_ticker: string
  yes_bid_dollars?: string | null
  yes_ask_dollars?: string | null
  no_bid_dollars?: string | null
  no_ask_dollars?: string | null
  last_price_dollars?: string | null
  volume_fp?: string | null
  volume_24h_fp?: string | null
  open_interest_fp?: string | null
  floor_strike: number | null
  cap_strike: number | null
  strike_type?: string
  result: string
  status: string
  expected_expiration_time?: string
  subtitle?: string
}

function parseDollarString(s: string | null | undefined): number | null {
  if (s == null || s === '') return null
  const n = parseFloat(s)
  return isFinite(n) ? n : null
}

interface UnifiedObservation {
  timestampMs: number
  temperatureF: number
}

type BracketKind = 'le' | 'ge' | 'inner'
type MarketType = 'temperature-high' | 'temperature-low'

interface ParsedEventTicker {
  cityCode: string
  marketType: MarketType
  weatherDate: string  // YYYYMMDD (local-time weather day)
}

interface LateDaySnapshot {
  ticker: string
  eventTicker: string
  cityCode: string
  marketType: MarketType
  bracketKind: BracketKind
  bracketLow: number | null   // °F (floor_strike or null)
  bracketHigh: number | null  // °F (cap_strike or null)
  timestamp: number
  resolvesAt: number | null
  windowStartUtcMs: number
  windowEndUtcMs: number      // observation window end (== local-day midnight UTC)
  minutesToWindowEnd: number
  // Kalshi
  yesBid: number | null   // 0..1
  yesAsk: number | null
  lastPrice: number | null
  yesVolume: number | null
  yesOpenInterest: number | null
  yesBookDepth: Array<[number, number]>   // [price_cents, qty]
  noBookDepth: Array<[number, number]>
  spread: number | null
  midPrice: number | null
  // Observation
  observedSoFar: number | null    // °F, max-so-far (high) or min-so-far (low)
  observedAtTs: number | null
  observationSource: string
  observationCount: number
  // Derived
  bracketDecided: boolean
  obsImpliedYesProb_sigma1: number | null
  obsImpliedYesProb_sigma2: number | null
  obsImpliedYesProb_sigma3: number | null
  priceVsObsGap_sigma2: number | null
  expiresAt: Date
}

// ============================================================================
// Helpers
// ============================================================================

async function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

// erf approximation — Abramowitz & Stegun 7.1.26
function erf(x: number): number {
  const sign = x >= 0 ? 1 : -1
  x = Math.abs(x)
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911
  const t = 1.0 / (1.0 + p * x)
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x)
  return sign * y
}

function phi(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2))
}

/** Convert YYYYMMDD weather day in city's timezone → [startUtcMs, endUtcMs).
 *  Copied from scripts/backfill-noaa-accuracy.ts to keep this script self-contained. */
function localDayUtcWindow(date: string, timezone: string): { startUtcMs: number; endUtcMs: number } {
  const yyyy = parseInt(date.slice(0, 4), 10)
  const mm = parseInt(date.slice(4, 6), 10)
  const dd = parseInt(date.slice(6, 8), 10)
  const targetLocal = `${yyyy.toString().padStart(4, '0')}-${mm.toString().padStart(2, '0')}-${dd.toString().padStart(2, '0')}`
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
  const probeStart = Date.UTC(yyyy, mm - 1, dd, 0, 0, 0)
  for (let h = -14; h <= 14; h++) {
    const candidate = probeStart + h * 3600_000
    const parts = fmt.formatToParts(new Date(candidate))
    const partsObj: Record<string, string> = {}
    for (const p of parts) partsObj[p.type] = p.value
    const localDate = `${partsObj.year}-${partsObj.month}-${partsObj.day}`
    const localTime = `${partsObj.hour}:${partsObj.minute}`
    if (localDate === targetLocal && localTime === '00:00') {
      return { startUtcMs: candidate, endUtcMs: candidate + 24 * 3600_000 }
    }
  }
  return { startUtcMs: probeStart, endUtcMs: probeStart + 24 * 3600_000 }
}

// ============================================================================
// Kalshi API
// ============================================================================

async function fetchKalshiMarkets(seriesTicker: string): Promise<KalshiMarket[]> {
  // Kalshi API rejects status=active filter (verified 2026-05-02). Pull all,
  // filter client-side to status === 'active' (open for trading).
  // Paginate via `cursor` since the default limit is 100 and an event may
  // have 30-60 brackets.
  const out: KalshiMarket[] = []
  let cursor: string | null = null
  for (let page = 0; page < 5; page++) {  // hard cap 5 pages = 500 markets per series
    const url = `${KALSHI_API_BASE}/markets?series_ticker=${seriesTicker}&limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
    try {
      const resp = await fetch(url, { headers: { Accept: 'application/json' } })
      if (!resp.ok) {
        if (resp.status !== 404) {
          console.error(`[kalshi] HTTP ${resp.status} for ${seriesTicker}`)
        }
        break
      }
      const data = await resp.json() as { markets: KalshiMarket[]; cursor?: string }
      const markets = (data.markets || []).filter(m => m.status === 'active')
      out.push(...markets)
      if (!data.cursor || data.cursor === '') break
      cursor = data.cursor
    } catch (err) {
      console.error(`[kalshi] fetch failed for ${seriesTicker}:`, (err as Error).message)
      break
    }
  }
  return out
}

async function fetchOrderbook(ticker: string): Promise<{ yes: Array<[number, number]>; no: Array<[number, number]> } | null> {
  // Kalshi response uses `orderbook_fp` with `yes_dollars` / `no_dollars` as
  // [priceString, qtyString] tuples (e.g., ["0.0100", "485.00"]).
  // We normalize to [priceFloat, qtyFloat] so the rest of the pipeline is unitless.
  const url = `${KALSHI_API_BASE}/markets/${ticker}/orderbook`
  try {
    const resp = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!resp.ok) return null
    const data = await resp.json() as {
      orderbook_fp?: {
        yes_dollars?: Array<[string, string]>
        no_dollars?: Array<[string, string]>
      }
    }
    const ob = data.orderbook_fp
    if (!ob) return { yes: [], no: [] }
    const parseLevels = (levels?: Array<[string, string]>): Array<[number, number]> =>
      (levels ?? []).map(([p, q]) => [parseFloat(p), parseFloat(q)] as [number, number])
        .filter(([p, q]) => isFinite(p) && isFinite(q))
    return {
      yes: parseLevels(ob.yes_dollars),
      no: parseLevels(ob.no_dollars),
    }
  } catch {
    return null
  }
}

// ============================================================================
// Iowa Mesonet ASOS (copied from scripts/backfill-noaa-accuracy.ts)
// ============================================================================

async function fetchIowaAsosObservations(
  station: string,
  startUtcMs: number,
  endUtcMs: number
): Promise<UnifiedObservation[]> {
  const queryStart = new Date(startUtcMs - 24 * 3600_000)
  const queryEnd = new Date(endUtcMs + 24 * 3600_000)
  const qs = new URLSearchParams({
    station, data: 'tmpf',
    year1: String(queryStart.getUTCFullYear()),
    month1: String(queryStart.getUTCMonth() + 1),
    day1: String(queryStart.getUTCDate()),
    year2: String(queryEnd.getUTCFullYear()),
    month2: String(queryEnd.getUTCMonth() + 1),
    day2: String(queryEnd.getUTCDate()),
    tz: 'Etc/UTC', format: 'onlycomma', latlon: 'no', elev: 'no',
    missing: 'M', trace: 'T',
  })
  const url = `https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?${qs.toString()}`
  const res = await fetch(url, { headers: { 'User-Agent': IOWA_USER_AGENT, Accept: 'text/csv' } })
  if (!res.ok) throw new Error(`IowaMesonet HTTP ${res.status} for ${station}`)
  const body = await res.text()
  const lines = body.split('\n')
  if (lines.length < 2) return []
  const header = lines[0].trim().toLowerCase()
  if (!header.startsWith('station,valid,tmpf')) {
    throw new Error(`IowaMesonet unexpected header for ${station}`)
  }
  const observations: UnifiedObservation[] = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    const parts = line.split(',')
    if (parts.length < 3) continue
    const valid = parts[1]
    const tmpfRaw = parts[2]
    if (tmpfRaw === 'M' || tmpfRaw === '') continue
    const temperatureF = parseFloat(tmpfRaw)
    if (!isFinite(temperatureF)) continue
    const m = valid.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/)
    if (!m) continue
    const timestampMs = Date.UTC(
      parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10),
      parseInt(m[4], 10), parseInt(m[5], 10),
    )
    if (timestampMs < startUtcMs || timestampMs >= endUtcMs) continue
    observations.push({ timestampMs, temperatureF })
  }
  return observations
}

// Cached obs lookup — same (station, hourBucket) returns same result for ~15 min.
const obsCache = new Map<string, { ts: number; observations: UnifiedObservation[] }>()
const OBS_CACHE_TTL_MS = 15 * 60_000

async function getObservationsCached(
  station: string,
  startUtcMs: number,
  endUtcMs: number,
): Promise<UnifiedObservation[]> {
  // Cache by (station, windowStart) only — many markets per city share the same
  // windowStart, so this collapses to one fetch per (station, weather-day) per
  // OBS_CACHE_TTL_MS. The endUtcMs is fixed by windowStart anyway.
  const cacheKey = `${station}:${startUtcMs}`
  const cached = obsCache.get(cacheKey)
  if (cached && Date.now() - cached.ts < OBS_CACHE_TTL_MS) {
    return cached.observations
  }
  try {
    const obs = await fetchIowaAsosObservations(station, startUtcMs, endUtcMs)
    obsCache.set(cacheKey, { ts: Date.now(), observations: obs })
    return obs
  } catch (err) {
    if (!cached) {
      console.warn(`[obs] iowa fetch failed for ${station}:`, (err as Error).message)
    }
    return cached?.observations ?? []
  }
}

// ============================================================================
// Event ticker + bracket parsing
// ============================================================================

function parseEventTicker(eventTicker: string): ParsedEventTicker | null {
  // KXHIGH<CITY>-26MAY02 (inner-bracket high), KXHIGHT<CITY>-26MAY02 (threshold high),
  // KXLOWT<CITY>-26MAY02 (threshold low)
  const m = eventTicker.match(/^(KXHIGHT?|KXLOWT?)([A-Z]+)-(\d{2})([A-Z]{3})(\d{2})$/)
  if (!m) return null
  const [, prefix, cityCode, yy, mmm, dd] = m
  const month = MONTHS[mmm]
  if (!month) return null
  const weatherDate = `20${yy}${month.toString().padStart(2, '0')}${dd}`
  const marketType: MarketType = prefix.startsWith('KXHIGH') ? 'temperature-high' : 'temperature-low'
  return { cityCode, marketType, weatherDate }
}

function parseBracketKind(market: KalshiMarket): { kind: BracketKind; low: number | null; high: number | null } {
  // Prefer Kalshi's structured field; fall back to ticker suffix.
  if (market.strike_type === 'greater') {
    return { kind: 'ge', low: market.floor_strike, high: null }
  }
  if (market.strike_type === 'less') {
    return { kind: 'le', low: null, high: market.cap_strike }
  }
  if (market.strike_type === 'between' || (market.floor_strike != null && market.cap_strike != null)) {
    return { kind: 'inner', low: market.floor_strike, high: market.cap_strike }
  }
  // Fallback: parse ticker suffix (-B<v> = ≤, -T<v> = ≥)
  const suffix = market.ticker.match(/-([BT])(\d+(?:\.\d+)?)$/)
  if (suffix) {
    const valueF = parseFloat(suffix[2])
    return suffix[1] === 'B'
      ? { kind: 'le', low: null, high: valueF }
      : { kind: 'ge', low: valueF, high: null }
  }
  return { kind: 'inner', low: market.floor_strike, high: market.cap_strike }
}

// ============================================================================
// Obs-implied YES probability (3 σ heuristics)
// ============================================================================

/** P(bracket resolves YES | observed-so-far + σ-scaled remaining-hours uncertainty).
 *  For high markets: observedSoFar = max-so-far; final max ≥ observedSoFar (only goes up).
 *  For low markets: observedSoFar = min-so-far; final min ≤ observedSoFar (only goes down).
 *  Approximate the remaining excursion as N(0, σ) (one-sided in the relevant direction). */
function obsImpliedYesProb(
  bracketKind: BracketKind,
  low: number | null,
  high: number | null,
  observedSoFar: number,
  marketType: MarketType,
  remainingHours: number,
  sigmaPerHour: number,
  sigmaCap: number,
): number {
  const remHours = Math.max(0, remainingHours)
  const sigma = Math.min(sigmaPerHour * remHours, sigmaCap)

  if (marketType === 'temperature-high') {
    // final_max = observedSoFar + max(0, X) where X ~ N(0, σ).
    // P(final_max ≤ K) ≈ Φ((K - observedSoFar) / σ)  (when observedSoFar ≤ K)
    if (bracketKind === 'le') {
      const cap = high!
      if (observedSoFar > cap) return 0
      if (sigma === 0) return 1
      return phi((cap - observedSoFar) / sigma)
    }
    if (bracketKind === 'ge') {
      const floor = low!
      if (observedSoFar >= floor) return 1
      if (sigma === 0) return 0
      return 1 - phi((floor - observedSoFar) / sigma)
    }
    // inner: low ≤ final_max ≤ high
    if (low == null || high == null) return 0.5
    if (observedSoFar > high) return 0
    if (observedSoFar >= low) {
      if (sigma === 0) return 1
      return phi((high - observedSoFar) / sigma)
    }
    if (sigma === 0) return 0
    return Math.max(0, phi((high - observedSoFar) / sigma) - phi((low - observedSoFar) / sigma))
  }

  // temperature-low: final_min = observedSoFar - max(0, X), X ~ N(0, σ).
  if (bracketKind === 'le') {
    const cap = high!
    if (observedSoFar <= cap) return 1
    if (sigma === 0) return 0
    return 1 - phi((observedSoFar - cap) / sigma)
  }
  if (bracketKind === 'ge') {
    const floor = low!
    if (observedSoFar < floor) return 0
    if (sigma === 0) return 1
    return phi((observedSoFar - floor) / sigma)
  }
  // inner: low ≤ final_min ≤ high
  if (low == null || high == null) return 0.5
  if (observedSoFar < low) return 0
  if (observedSoFar <= high) {
    if (sigma === 0) return 1
    return phi((observedSoFar - low) / sigma)
  }
  if (sigma === 0) return 0
  return Math.max(0, phi((observedSoFar - low) / sigma) - phi((observedSoFar - high) / sigma))
}

// ============================================================================
// Snapshot building
// ============================================================================

async function buildSnapshot(
  market: KalshiMarket,
  parsed: ParsedEventTicker,
  station: string,
  windowStartUtcMs: number,
  windowEndUtcMs: number,
): Promise<LateDaySnapshot | null> {
  const now = Date.now()
  const { kind, low, high } = parseBracketKind(market)

  const orderbook = await fetchOrderbook(market.ticker)
  await sleep(SLEEP_BETWEEN_REQUESTS_MS)

  const obs = await getObservationsCached(station, windowStartUtcMs, Math.min(now, windowEndUtcMs))

  let observedSoFar: number | null = null
  let observedAtTs: number | null = null
  if (obs.length > 0) {
    if (parsed.marketType === 'temperature-high') {
      let best = -Infinity, bestTs = 0
      for (const o of obs) if (o.temperatureF > best) { best = o.temperatureF; bestTs = o.timestampMs }
      if (isFinite(best)) { observedSoFar = best; observedAtTs = bestTs }
    } else {
      let best = Infinity, bestTs = 0
      for (const o of obs) if (o.temperatureF < best) { best = o.temperatureF; bestTs = o.timestampMs }
      if (isFinite(best)) { observedSoFar = best; observedAtTs = bestTs }
    }
  }

  const remainingHours = Math.max(0, windowEndUtcMs - now) / 3600_000

  let p1: number | null = null
  let p2: number | null = null
  let p3: number | null = null
  if (observedSoFar != null) {
    p1 = obsImpliedYesProb(kind, low, high, observedSoFar, parsed.marketType, remainingHours, 1, 3)
    p2 = obsImpliedYesProb(kind, low, high, observedSoFar, parsed.marketType, remainingHours, 2, 5)
    p3 = obsImpliedYesProb(kind, low, high, observedSoFar, parsed.marketType, remainingHours, 3, 8)
  }

  const decided = p1 != null && p2 != null && p3 != null
    && (p1 < 0.03 || p1 > 0.97)
    && (p2 < 0.03 || p2 > 0.97)
    && (p3 < 0.03 || p3 > 0.97)

  // Kalshi *_dollars fields are strings already in 0..1 dollar units.
  const yesBid = parseDollarString(market.yes_bid_dollars)
  const yesAsk = parseDollarString(market.yes_ask_dollars)
  const lastPrice = parseDollarString(market.last_price_dollars)
  const spread = (yesBid != null && yesAsk != null) ? yesAsk - yesBid : null
  const midPrice = (yesBid != null && yesAsk != null) ? (yesBid + yesAsk) / 2 : null
  const priceGap = (midPrice != null && p2 != null) ? midPrice - p2 : null
  const volume = parseDollarString(market.volume_24h_fp ?? market.volume_fp)
  const oi = parseDollarString(market.open_interest_fp)

  return {
    ticker: market.ticker,
    eventTicker: market.event_ticker,
    cityCode: parsed.cityCode,
    marketType: parsed.marketType,
    bracketKind: kind,
    bracketLow: low,
    bracketHigh: high,
    timestamp: now,
    resolvesAt: market.expected_expiration_time
      ? new Date(market.expected_expiration_time).getTime()
      : null,
    windowStartUtcMs,
    windowEndUtcMs,
    minutesToWindowEnd: Math.round((windowEndUtcMs - now) / 60_000),
    yesBid, yesAsk, lastPrice,
    yesVolume: volume,
    yesOpenInterest: oi,
    yesBookDepth: orderbook?.yes ?? [],
    noBookDepth: orderbook?.no ?? [],
    spread, midPrice,
    observedSoFar, observedAtTs,
    observationSource: obs.length > 0 ? 'iowa-asos' : 'unavailable',
    observationCount: obs.length,
    bracketDecided: decided,
    obsImpliedYesProb_sigma1: p1,
    obsImpliedYesProb_sigma2: p2,
    obsImpliedYesProb_sigma3: p3,
    priceVsObsGap_sigma2: priceGap,
    expiresAt: new Date(now + TTL_DAYS * 86400_000),
  }
}

// ============================================================================
// Poll loop
// ============================================================================

async function pollOnce(dryRun: boolean): Promise<{ inWindow: number; persisted: number; cities: Set<string> }> {
  const now = Date.now()
  const stats = { inWindow: 0, persisted: 0, cities: new Set<string>() }
  const snapshots: LateDaySnapshot[] = []

  for (const cityCode of CITIES_TO_MONITOR) {
    const cityInfo = CITY_COORDS[cityCode]
    if (!cityInfo?.resolutionStation || !cityInfo?.timezone) continue

    const allMarkets: KalshiMarket[] = []
    for (const prefix of SERIES_PREFIXES) {
      const ms = await fetchKalshiMarkets(`${prefix}${cityCode}`)
      allMarkets.push(...ms)
      await sleep(SLEEP_BETWEEN_REQUESTS_MS)
    }
    if (allMarkets.length === 0) continue

    for (const market of allMarkets) {
      const parsed = parseEventTicker(market.event_ticker)
      if (!parsed) continue
      const window = localDayUtcWindow(parsed.weatherDate, cityInfo.timezone)
      const lateWindowStart = window.endUtcMs - LATE_WINDOW_HOURS * 3600_000
      if (now < lateWindowStart || now >= window.endUtcMs) continue

      stats.inWindow++
      stats.cities.add(parsed.cityCode)
      const snap = await buildSnapshot(
        market, parsed, cityInfo.resolutionStation,
        window.startUtcMs, window.endUtcMs,
      )
      if (snap) snapshots.push(snap)
    }
  }

  if (dryRun) {
    console.log(`\n[dry-run] in-window markets detected: ${stats.inWindow}`)
    console.log(`[dry-run] cities in window: ${[...stats.cities].join(', ') || '(none)'}`)
    console.log(`[dry-run] snapshots built: ${snapshots.length}`)
    if (snapshots.length > 0) {
      console.log('\n[dry-run] sample snapshot (first):')
      const s = snapshots[0]
      console.log(JSON.stringify({
        ticker: s.ticker,
        city: s.cityCode,
        type: s.marketType,
        kind: s.bracketKind,
        low: s.bracketLow,
        high: s.bracketHigh,
        windowEnd: new Date(s.windowEndUtcMs).toISOString(),
        minutesToWindowEnd: s.minutesToWindowEnd,
        observedSoFar: s.observedSoFar,
        observedAt: s.observedAtTs ? new Date(s.observedAtTs).toISOString() : null,
        obsCount: s.observationCount,
        yesBid: s.yesBid,
        yesAsk: s.yesAsk,
        midPrice: s.midPrice,
        sigmaProbs: {
          p1: s.obsImpliedYesProb_sigma1,
          p2: s.obsImpliedYesProb_sigma2,
          p3: s.obsImpliedYesProb_sigma3,
        },
        decided: s.bracketDecided,
        gap_sigma2: s.priceVsObsGap_sigma2,
        bookLevels: { yes: s.yesBookDepth.length, no: s.noBookDepth.length },
      }, null, 2))
      // Print decided + non-decided counts
      const decided = snapshots.filter(s => s.bracketDecided).length
      console.log(`\n[dry-run] decided=${decided} / ${snapshots.length}`)
      if (decided > 0) {
        const decidedSnaps = snapshots.filter(s => s.bracketDecided)
        console.log('[dry-run] decided snapshots — gap distribution:')
        for (const s of decidedSnaps.slice(0, 5)) {
          console.log(`  ${s.ticker} | obs=${s.observedSoFar?.toFixed(1)}°F | p2=${s.obsImpliedYesProb_sigma2?.toFixed(3)} | mid=${s.midPrice?.toFixed(3)} | gap=${s.priceVsObsGap_sigma2?.toFixed(3)}`)
        }
      }
    }
    return stats
  }

  if (snapshots.length > 0) {
    const db = await getDb()
    const coll = db.collection(COLLECTION)
    await coll.insertMany(snapshots)
    stats.persisted = snapshots.length
  }
  return stats
}

async function ensureIndexes(): Promise<void> {
  const db = await getDb()
  const coll = db.collection(COLLECTION)
  await coll.createIndex({ timestamp: 1 })
  await coll.createIndex({ ticker: 1, timestamp: -1 })
  await coll.createIndex({ cityCode: 1, timestamp: -1 })
  await coll.createIndex({ eventTicker: 1 })
  await coll.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run')
  console.log(`[probe] starting${dryRun ? ' (DRY RUN — one cycle only)' : ' (long-running)'}`)
  console.log(`[probe] cities monitored: ${CITIES_TO_MONITOR.length}`)
  console.log(`[probe] late window: last ${LATE_WINDOW_HOURS}h of local-time observation day`)

  if (dryRun) {
    await pollOnce(true)
    await closeClient()
    process.exit(0)
  }

  await ensureIndexes()
  console.log('[probe] indexes ensured')

  let lastHeartbeat = 0
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const stats = await pollOnce(false)
      const now = Date.now()
      if (now - lastHeartbeat >= HEARTBEAT_INTERVAL_MS) {
        console.log(
          `[probe] heartbeat ${new Date().toISOString()} | in-window=${stats.inWindow} | persisted=${stats.persisted} | cities=${[...stats.cities].join(',') || '-'}`
        )
        lastHeartbeat = now
      }
    } catch (err) {
      console.error('[probe] poll error:', (err as Error).message)
    }
    await sleep(POLL_INTERVAL_MS)
  }
}

main().catch(err => {
  console.error('[probe] fatal:', err)
  process.exit(1)
})
