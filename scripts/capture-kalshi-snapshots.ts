// Periodic snapshot capture of all active KX-prefix Kalshi events.
// Designed for backtest of the fade-the-tail mass-concentration strategy
// (see working-checklist Phase A under "Fade-the-tail mass-concentration").
//
// Runs via crontab every 30 min, offset 15 min from execute-tail-sells:
//   15,45 * * * * cd /var/www/kardashev && npm run capture-kalshi-snapshots >> /var/log/capture-kalshi-snapshots.log 2>&1
//
// Public Kalshi market data does not require auth. We hit the markets
// endpoint with status=open, group by event, and persist a per-event
// snapshot row to the kalshi_market_snapshots collection.

import * as fs from 'fs'
import * as path from 'path'
import { MongoClient } from 'mongodb'
import { extractCityCode, extractMarketType } from '../src/lib/utils/tickerParsing'
import { CITY_COORDS } from '../src/lib/utils/cityCoordinates'
import { fetchWeatherForecast } from '../src/lib/api/openMeteo'
import { extractPerSourcePeakHourAtmosphere, type PerSourcePeakHourAtmosphere } from '../src/lib/utils/dailyForecasts'

// Match the env-loader pattern used in scripts/execute-tail-sells.ts so all
// cron-style scripts handle .env.local consistently (multi-line PEM-safe).
function loadEnvFile() {
  try {
    const envPath = path.join(__dirname, '../.env.local')
    const envContent = fs.readFileSync(envPath, 'utf-8')
    const lines = envContent.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const match = trimmed.match(/^([^=]+)=(.*)$/)
      if (!match) continue
      const key = match[1].trim()
      let value = match[2].trim()
      if (value.includes('BEGIN')) {
        let full = value
        i++
        while (i < lines.length && !lines[i].includes('END')) {
          full += '\n' + lines[i]
          i++
        }
        if (i < lines.length) full += '\n' + lines[i]
        value = full
      }
      process.env[key] = value
    }
  } catch {
    console.warn('[capture-snapshots] Warning: Could not load .env.local')
  }
}

loadEnvFile()

const KALSHI_API_BASE = 'https://api.elections.kalshi.com/trade-api/v2'
const RETENTION_DAYS = 90
const FETCH_TIMEOUT_MS = 30_000

interface KalshiMarketRaw {
  ticker: string
  event_ticker: string
  status: string
  // Kalshi returns price fields as STRINGS in dollars (e.g. "0.0200"), not cents.
  yes_bid_dollars?: string
  yes_ask_dollars?: string
  no_bid_dollars?: string
  no_ask_dollars?: string
  last_price_dollars?: string
  volume_fp?: string         // fixed-point string e.g. "2122.23"
  open_interest_fp?: string
  floor_strike?: number      // numeric strike (always present)
  cap_strike?: number        // present for between/inner brackets
  strike_type?: 'greater' | 'less' | 'between' | 'structured'
  close_time: string
  subtitle?: string          // human-readable bracket label e.g. "59° or above"
  yes_sub_title?: string     // legacy / alternate label field
}

interface KalshiMarketsResponse {
  markets: KalshiMarketRaw[]
  cursor?: string
}

interface BracketSnapshot {
  ticker: string
  yesBid: number | null    // dollars 0-1
  yesAsk: number | null
  yesPrice: number | null  // best available signal: bid/ask mid, else last_price
  noBid: number | null
  noAsk: number | null
  noPrice: number | null
  lastTradePrice: number | null
  volume: number
  openInterest: number
  floorF: number | null
  capF: number | null
  strikeType: string | null  // 'greater' | 'less' | 'between' | 'structured'
  label: string
}

interface EventSnapshot {
  _id: string                      // `${eventTicker}:${snapshotTime}`
  eventTicker: string
  cityCode: string | null
  marketType: 'high' | 'low'
  resolutionDate: string           // YYYY-MM-DD (parsed from close_time)
  snapshotTime: number             // epoch ms
  hoursToResolution: number
  brackets: BracketSnapshot[]
  dominantBracket: string | null   // ticker with highest yesPrice
  dominantConcentration: number    // dominant yesPrice (0-1)
  bracketCount: number
  // Open-Meteo peak-hour atmosphere AS OF this snapshot time. Added 2026-06-19
  // (option-value): pairs an intraday atm series with the existing intraday
  // price series at the same cadence, so the reaction-speed / lead-lag
  // hypothesis becomes testable in ~6-8 weeks. Fail-soft — null/absent if the
  // OM fetch or extraction fails; never blocks price capture.
  omAtmosphere?: PerSourcePeakHourAtmosphere | null
  expiresAt: Date
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
}

// Per-city series fetch — mirrors the production /api/kalshi/markets pattern.
// Builds (prefix × cityCode) tasks for KXHIGH / KXLOW, batches in parallel
// with stagger to stay under Kalshi rate limits. Bulk /markets fetch was
// 5+ min for 600K markets to use 0.08% — this is ~5-10s for the same 81 events.
// Temperature series only (KXRAIN/KXSNOW excluded — different surface).
// KXHIGH / KXLOW are inner-bracket events; KXHIGHT / KXLOWT are threshold variants.
const SERIES_PREFIXES = ['KXHIGH', 'KXHIGHT', 'KXLOW', 'KXLOWT']
const BATCH_SIZE = 5
const BATCH_STAGGER_MS = 300

interface FetchTask { prefix: string; cityCode: string }

async function runBatch(tasks: FetchTask[], all: KalshiMarketRaw[]): Promise<FetchTask[]> {
  const retryNext: FetchTask[] = []
  for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
    if (i > 0) await new Promise(r => setTimeout(r, BATCH_STAGGER_MS))
    const batch = tasks.slice(i, i + BATCH_SIZE)
    const results = await Promise.allSettled(
      batch.map(({ prefix, cityCode }) => {
        const url = new URL(`${KALSHI_API_BASE}/markets`)
        url.searchParams.set('series_ticker', `${prefix}${cityCode}`)
        url.searchParams.set('status', 'open')
        url.searchParams.set('limit', '200')
        return fetchWithTimeout(url.toString())
      })
    )
    for (let j = 0; j < results.length; j++) {
      const r = results[j]
      if (r.status !== 'fulfilled') { retryNext.push(batch[j]); continue }
      if (r.value.status === 429) { retryNext.push(batch[j]); continue }
      if (!r.value.ok) continue
      try {
        const data = (await r.value.json()) as KalshiMarketsResponse
        all.push(...data.markets)
      } catch {/* skip parse errors */}
    }
  }
  return retryNext
}

async function fetchActiveKalshiMarkets(): Promise<KalshiMarketRaw[]> {
  const cityCodes = Object.keys(CITY_COORDS)
  const tasks: FetchTask[] = SERIES_PREFIXES.flatMap(prefix =>
    cityCodes.map(cityCode => ({ prefix, cityCode }))
  )
  console.log(`[capture-snapshots] fetching ${tasks.length} series queries (${SERIES_PREFIXES.length} prefixes × ${cityCodes.length} cities)`)

  const all: KalshiMarketRaw[] = []

  // Pass 1
  let retry = await runBatch(tasks, all)
  console.log(`[capture-snapshots] pass 1: ${all.length} markets so far, ${retry.length} 429'd → retry`)

  // Pass 2 (4s backoff)
  if (retry.length > 0) {
    await new Promise(r => setTimeout(r, 4000))
    retry = await runBatch(retry, all)
    console.log(`[capture-snapshots] pass 2: ${all.length} markets so far, ${retry.length} still failing → retry`)
  }

  // Pass 3 (3s backoff, mirrors production)
  if (retry.length > 0) {
    await new Promise(r => setTimeout(r, 3000))
    retry = await runBatch(retry, all)
    console.log(`[capture-snapshots] pass 3: ${all.length} markets, ${retry.length} permanently failed`)
  }

  console.log(`[capture-snapshots] total: ${all.length} KX markets after ${retry.length === 0 ? 'all retries succeeded' : retry.length + ' tasks failed'}`)
  return all
}

function dollarStrToNum(s: string | undefined): number | null {
  if (s == null) return null
  const n = parseFloat(s)
  return isFinite(n) ? n : null
}

function fpStrToNum(s: string | undefined): number {
  if (s == null) return 0
  const n = parseFloat(s)
  return isFinite(n) ? n : 0
}

function midOrNull(bid: number | null, ask: number | null): number | null {
  if (bid != null && ask != null) return (bid + ask) / 2
  if (bid != null) return bid
  if (ask != null) return ask
  return null
}

function parseResolutionDate(closeTime: string): string {
  // Kalshi close_time is ISO; we use date portion (UTC) for resolution date
  return closeTime.slice(0, 10)
}

function buildBracketSnapshot(m: KalshiMarketRaw): BracketSnapshot {
  const yesBid = dollarStrToNum(m.yes_bid_dollars)
  const yesAsk = dollarStrToNum(m.yes_ask_dollars)
  const noBid = dollarStrToNum(m.no_bid_dollars)
  const noAsk = dollarStrToNum(m.no_ask_dollars)
  const lastTrade = dollarStrToNum(m.last_price_dollars)
  return {
    ticker: m.ticker,
    yesBid,
    yesAsk,
    yesPrice: midOrNull(yesBid, yesAsk) ?? lastTrade,
    noBid,
    noAsk,
    noPrice: midOrNull(noBid, noAsk) ?? (lastTrade != null ? 1 - lastTrade : null),
    lastTradePrice: lastTrade,
    volume: fpStrToNum(m.volume_fp),
    openInterest: fpStrToNum(m.open_interest_fp),
    floorF: m.floor_strike != null ? Number(m.floor_strike) : null,
    capF: m.cap_strike != null ? Number(m.cap_strike) : null,
    strikeType: m.strike_type ?? null,
    label: m.subtitle ?? m.yes_sub_title ?? '',
  }
}

function buildEventSnapshot(eventTicker: string, markets: KalshiMarketRaw[], snapshotTime: number): EventSnapshot {
  const brackets = markets.map(buildBracketSnapshot)
  let dominantBracket: string | null = null
  let dominantConcentration = 0
  for (const b of brackets) {
    if (b.yesPrice != null && b.yesPrice > dominantConcentration) {
      dominantConcentration = b.yesPrice
      dominantBracket = b.ticker
    }
  }

  const closeTime = markets[0]?.close_time ?? ''
  const resolutionDate = parseResolutionDate(closeTime)
  const closeMs = closeTime ? new Date(closeTime).getTime() : snapshotTime
  const hoursToResolution = Math.max(0, Math.round((closeMs - snapshotTime) / 3_600_000))

  return {
    _id: `${eventTicker}:${snapshotTime}`,
    eventTicker,
    cityCode: extractCityCode(eventTicker),
    marketType: extractMarketType(eventTicker),
    resolutionDate,
    snapshotTime,
    hoursToResolution,
    brackets,
    dominantBracket,
    dominantConcentration,
    bracketCount: brackets.length,
    expiresAt: new Date(snapshotTime + RETENTION_DAYS * 24 * 60 * 60 * 1000),
  }
}

// Fetch Open-Meteo peak-hour atm for one (city, marketType, resolutionDate),
// reusing the tested ensemble extraction. Cached per key; fail-soft.
const _atmCache = new Map<string, PerSourcePeakHourAtmosphere | null>()
async function fetchOmAtm(
  cityCode: string | null,
  marketType: 'high' | 'low',
  resolutionDate: string,
): Promise<PerSourcePeakHourAtmosphere | null> {
  if (!cityCode) return null
  const key = `${cityCode}:${marketType}:${resolutionDate}`
  if (_atmCache.has(key)) return _atmCache.get(key)!
  let atm: PerSourcePeakHourAtmosphere | null = null
  try {
    const coords = CITY_COORDS[cityCode]
    if (coords && /^\d{4}-\d{2}-\d{2}$/.test(resolutionDate)) {
      const { data: om } = await fetchWeatherForecast({ lat: coords.lat, lng: coords.lng })
      const [y, m, d] = resolutionDate.split('-')
      const targetDateKey = `${m}/${d}/${y}` // MM/DD/YYYY to match getDateKey()
      const per = extractPerSourcePeakHourAtmosphere(om, coords.timezone, targetDateKey, marketType)
      atm = per['Open-Meteo'] ?? null
    }
  } catch (err: any) {
    console.warn(`[capture-snapshots] atm fetch failed for ${cityCode}/${marketType}: ${err?.message ?? err}`)
  }
  _atmCache.set(key, atm)
  return atm
}

async function main() {
  const start = Date.now()
  const mongoUri = process.env.MONGO_CONNECTION_STRING
  if (!mongoUri) {
    console.error('[capture-snapshots] MONGO_CONNECTION_STRING not set')
    process.exit(1)
  }

  console.log(`[capture-snapshots] starting at ${new Date(start).toISOString()}`)

  const markets = await fetchActiveKalshiMarkets()
  console.log(`[capture-snapshots] fetched ${markets.length} active KX markets`)

  // Group by event
  const byEvent = new Map<string, KalshiMarketRaw[]>()
  for (const m of markets) {
    if (!byEvent.has(m.event_ticker)) byEvent.set(m.event_ticker, [])
    byEvent.get(m.event_ticker)!.push(m)
  }
  console.log(`[capture-snapshots] grouped into ${byEvent.size} events`)

  const snapshotTime = Date.now()
  const snapshots: EventSnapshot[] = []
  for (const [eventTicker, eventMarkets] of byEvent) {
    snapshots.push(buildEventSnapshot(eventTicker, eventMarkets, snapshotTime))
  }

  // Attach Open-Meteo peak-hour atm to each snapshot (fail-soft, cached per
  // city/type/date). Never throws — price capture proceeds regardless.
  let atmAttached = 0
  for (const snap of snapshots) {
    snap.omAtmosphere = await fetchOmAtm(snap.cityCode, snap.marketType, snap.resolutionDate)
    if (snap.omAtmosphere) atmAttached++
  }
  console.log(`[capture-snapshots] attached OM atm to ${atmAttached}/${snapshots.length} snapshots`)

  const client = new MongoClient(mongoUri)
  await client.connect()
  try {
    const db = client.db('kardashev')
    const col = db.collection<EventSnapshot>('kalshi_market_snapshots')

    // Idempotent indexes (cheap if already exist)
    await col.createIndex({ eventTicker: 1, snapshotTime: -1 })
    await col.createIndex({ snapshotTime: -1 })
    await col.createIndex({ resolutionDate: 1 })
    await col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })

    let inserted = 0
    for (const snap of snapshots) {
      try {
        await col.insertOne(snap)
        inserted++
      } catch (err: any) {
        if (err?.code !== 11000) {
          console.error(`[capture-snapshots] insert failed for ${snap._id}:`, err?.message ?? err)
        }
      }
    }
    console.log(`[capture-snapshots] inserted ${inserted}/${snapshots.length} snapshots in ${Date.now() - start}ms`)
  } finally {
    await client.close()
  }
}

main()
  .then(() => {
    // Force exit: the shared ioredis client keeps an open socket that holds the
    // event loop alive, so the process would otherwise hang indefinitely after
    // completing its work. Lingering zombies stacked by the 30-min cron caused
    // the 2026-06-20 OOM outage. Exit explicitly once the work is done.
    process.exit(0)
  })
  .catch(err => {
    console.error('[capture-snapshots] fatal:', err)
    process.exit(1)
  })
