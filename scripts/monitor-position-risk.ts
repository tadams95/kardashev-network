// Tail-Sell Position Risk Monitor
//
// Iterates every `pending` row in `tail_sell_signals` (live + paper across
// all four quadrants), pulls a refreshed forecast for each city, classifies
// the position as OK / WARN / CRITICAL via city-agnostic + quadrant-aware
// rules, persists to `position_risk_snapshots`, and sends Telegram alerts on
// level transitions (OK→WARN/CRITICAL, WARN→CRITICAL) with throttling.
//
// Read-only on `tail_sell_signals` and the live earning path. Never modifies
// signal generation, never auto-closes positions.
//
// Run modes:
//   tsx scripts/monitor-position-risk.ts              # standard (write + alerts)
//   tsx scripts/monitor-position-risk.ts --dry-run    # console only, no writes/alerts
//
// Designed to run under PM2 cron (`kardashev-position-monitor`, every 2h).

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config()

import { getDb, closeClient } from '../src/lib/db/mongodb'
import { getForecastsForCity } from '../src/pages/api/weather/forecasts'
import { buildForecastDistribution } from '../src/lib/models/forecastDistribution'
import { extractPerSourcePeakHourAtmosphere, getDateKey } from '../src/lib/utils/dailyForecasts'
import { filterEnsembleByDate } from '../src/lib/utils/ensembleDateFilter'
import { fetchIowaAsosObservations } from '../src/lib/utils/iowaAsos'
import { CITY_COORDS } from '../src/lib/utils/cityCoordinates'
import { sendTelegramAlert } from '../src/lib/utils/telegram'
import {
  classifyPositionRisk,
  bracketDistanceCurrent,
  recordPositionRiskSnapshot,
  getLatestSnapshotsBySignal,
  type PositionRiskSnapshot,
  type RiskLevel,
} from '../src/lib/models/positionRiskTracker'
import type { TailSellRecord } from '../src/lib/models/tailSellTracker'

const ALERT_THROTTLE_MS = 6 * 60 * 60 * 1000  // 1 alert per signalId per 6h

// ============================================================================
// Helpers
// ============================================================================

interface ParsedTicker {
  resolutionDate: string  // YYYY-MM-DD
}
const MONTHS: Record<string, string> = {
  JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
  JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12',
}
function parseEventTicker(eventTicker: string): ParsedTicker | null {
  const m = eventTicker.match(/-(\d{2})([A-Z]{3})(\d{2})/)
  if (!m) return null
  const mm = MONTHS[m[2]]
  if (!mm) return null
  return { resolutionDate: `20${m[1]}-${mm}-${m[3]}` }
}

/** Compute peak window for a given (city, marketType) on a target date.
 *  High markets: 12-16 local. Low markets: 04-08 local. */
function peakWindow(args: {
  cityTimezone: string
  resolutionDate: string  // YYYY-MM-DD
  marketType: 'high' | 'low'
}): { startUtcMs: number; endUtcMs: number } {
  const peakStartLocal = args.marketType === 'high' ? 12 : 4
  const peakEndLocal = args.marketType === 'high' ? 16 : 8
  // Construct local-tz timestamps and convert to UTC ms.
  // Use a noon-local-tz Date as anchor, then add hours.
  // Simpler approach: construct via Date.UTC on the target date and apply tz offset.
  const [y, m, d] = args.resolutionDate.split('-').map(Number)
  const noonUtc = Date.UTC(y, m - 1, d, 12, 0, 0)
  // Estimate local-tz offset for the date by formatting noon-utc in tz and reading it back.
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: args.cityTimezone, hour: 'numeric', hour12: false,
  })
  const localHourAtNoonUtc = parseInt(fmt.format(new Date(noonUtc)), 10)
  // If localHourAtNoonUtc=8, then UTC is 4h ahead of local → tz offset = -4 → local hour H = UTC hour - (-4) = UTC hour + 4
  // Inverse: localHour = utcHour + tzOffset → tzOffset = localHour - 12 (we used utcHour=12)
  const tzOffsetH = localHourAtNoonUtc - 12  // signed; e.g., NY EDT = -4, PHX MST = -7
  const startUtcMs = Date.UTC(y, m - 1, d, peakStartLocal - tzOffsetH, 0, 0)
  const endUtcMs = Date.UTC(y, m - 1, d, peakEndLocal - tzOffsetH, 0, 0)
  return { startUtcMs, endUtcMs }
}

function quadrantLabel(direction: 'cold' | 'warm', marketType: 'high' | 'low'): string {
  if (direction === 'cold' && marketType === 'high') return 'cold-side high'
  if (direction === 'warm' && marketType === 'high') return 'hot-side high'
  if (direction === 'warm' && marketType === 'low') return 'warm-tail low'
  return 'cold-tail low'
}

function emoji(level: RiskLevel): string {
  if (level === 'CRITICAL') return '🚨'
  if (level === 'WARN') return '⚠️'
  return '✅'
}

// ============================================================================
// Per-position evaluation
// ============================================================================

interface EvalResult {
  signal: TailSellRecord
  snapshot: Omit<PositionRiskSnapshot, 'id' | 'expiresAt'> | null
  error: string | null
}

async function evaluatePosition(signal: TailSellRecord, atmosphereCache: Map<string, ReturnType<typeof extractPerSourcePeakHourAtmosphere>>, obsCache: Map<string, number | null>): Promise<EvalResult> {
  const cityInfo = CITY_COORDS[signal.cityCode]
  if (!cityInfo) {
    return { signal, snapshot: null, error: `unknown city: ${signal.cityCode}` }
  }
  const parsed = parseEventTicker(signal.eventTicker)
  if (!parsed) {
    return { signal, snapshot: null, error: `bad eventTicker: ${signal.eventTicker}` }
  }

  // 1. Fresh forecast — full multi-day ensemble
  const forecastResult = await getForecastsForCity(signal.cityCode)
  if (!forecastResult.success || !forecastResult.data) {
    return { signal, snapshot: null, error: forecastResult.error || 'no forecast data' }
  }
  const fullEnsemble = forecastResult.data.ensemble

  // 1.5. Filter to the resolution day. CRITICAL — without this, buildForecastDistribution
  // averages forecasts across ALL captured days (today + 4 future), producing meaningless
  // point forecasts. Signal generation does this same filter via computeOpportunities;
  // we must mirror it here. failClosed: true to avoid wrong-day data.
  const resolutionTimeISO = `${parsed.resolutionDate}T18:00:00Z`
  const ensemble = filterEnsembleByDate(fullEnsemble, resolutionTimeISO, {
    failClosed: true,
    marketType: signal.temperatureType ?? 'high',
  })
  if (!ensemble) {
    return { signal, snapshot: null, error: `no forecasts for resolution date ${parsed.resolutionDate}` }
  }

  // 2. BMA point forecast — use the SAME bracketRegime the signal was generated
  // with so μ corrections match. Threshold tickers (T-/B-suffix with one
  // bracket boundary) use 'threshold'; inner brackets (both floor + cap, not
  // equal) use 'inner'. Mismatch causes 1-3°F bias from differing μ tables.
  const isThresholdTicker = /-([BT])\d+(\.\d+)?$/.test(signal.ticker)
  const bracketRegime: 'inner' | 'threshold' = isThresholdTicker
    ? 'threshold'
    : (signal.bracketFloorF != null && signal.bracketCapF != null && signal.bracketFloorF !== signal.bracketCapF)
      ? 'inner'
      : 'threshold'

  const dist = buildForecastDistribution({
    ensemble,
    temperatureType: signal.temperatureType ?? 'high',
    biasCorrection: 0,
    cityCode: signal.cityCode,
    date: parsed.resolutionDate,
    bracketRegime,
  })
  if (!dist) {
    return { signal, snapshot: null, error: 'forecast distribution null (insufficient sources)' }
  }

  // Source-coverage gate: skip classification when fewer than 3 sources are
  // contributing — BMA is degenerate and forecasts can swing wildly. Common
  // when AccuWeather/Tomorrow.io/Google-Weather hit transient rate-limits.
  // Position is logged but classified OK with a triggers note so the cron
  // doesn't fire spurious alerts.
  if (dist.sourceCount < 3) {
    console.log(`[monitor] ${signal.ticker}: insufficient sources (${dist.sourceCount}/5), skipping classification`)
  }

  const refreshedForecastF = dist.pointForecastF
  const refreshedSpreadF = dist.spreadC * 9 / 5

  // 3. Atmospheric features for the resolution date (peak window per market type)
  const targetDateKey = getDateKey(`${parsed.resolutionDate}T12:00:00`, cityInfo.timezone!)
  const atmCacheKey = `${signal.cityCode}:${targetDateKey}:${signal.temperatureType}`
  let atm = atmosphereCache.get(atmCacheKey)
  if (atm === undefined) {
    atm = extractPerSourcePeakHourAtmosphere(
      ensemble.forecasts,
      cityInfo.timezone!,
      targetDateKey,
      signal.temperatureType ?? 'high',
    )
    atmosphereCache.set(atmCacheKey, atm)
  }
  // Mean across populated sources for context columns
  const atmSrc = Object.values(atm)
  const meanField = (key: 'cloudCover' | 'humidity' | 'windGust' | 'prePeakPrecip24h'): number | null => {
    const vals = atmSrc.map(s => s[key]).filter((v): v is number => typeof v === 'number')
    if (vals.length === 0) return null
    return vals.reduce((s, v) => s + v, 0) / vals.length
  }

  // 4. Peak window + observations (only if window has started)
  const window = peakWindow({
    cityTimezone: cityInfo.timezone!,
    resolutionDate: parsed.resolutionDate,
    marketType: signal.temperatureType ?? 'high',
  })
  const now = Date.now()
  let observedExtremeSoFarF: number | null = null
  let observedAtTs: number | null = null
  let observationCount = 0
  let hoursIntoPeakWindow: number | null = null

  if (now > window.startUtcMs && cityInfo.resolutionStation) {
    hoursIntoPeakWindow = (Math.min(now, window.endUtcMs) - window.startUtcMs) / 3600_000
    const obsKey = `${cityInfo.resolutionStation}:${window.startUtcMs}`
    let obsList = obsCache.has(obsKey) ? null : null
    if (!obsCache.has(obsKey)) {
      try {
        const obs = await fetchIowaAsosObservations(
          cityInfo.resolutionStation,
          window.startUtcMs,
          Math.min(now, window.endUtcMs),
        )
        observationCount = obs.length
        if (obs.length > 0) {
          if (signal.temperatureType === 'low') {
            const min = obs.reduce((acc, o) => o.temperatureF < acc.temperatureF ? o : acc, obs[0])
            observedExtremeSoFarF = min.temperatureF
            observedAtTs = min.timestampMs
          } else {
            const max = obs.reduce((acc, o) => o.temperatureF > acc.temperatureF ? o : acc, obs[0])
            observedExtremeSoFarF = max.temperatureF
            observedAtTs = max.timestampMs
          }
        }
        obsCache.set(obsKey, observedExtremeSoFarF)
      } catch (err) {
        // Iowa rate-limit or other failure — non-fatal
        console.warn(`[monitor] iowa fetch failed for ${cityInfo.resolutionStation}: ${(err as Error).message}`)
        obsCache.set(obsKey, null)
      }
    }
  }

  // 5. Classify (or short-circuit to OK if source coverage is degraded)
  const direction = signal.direction ?? 'cold'
  const marketType = signal.temperatureType ?? 'high'
  const cls = dist.sourceCount < 3
    ? {
        riskLevel: 'OK' as const,
        triggers: [`INSUFFICIENT_DATA: only ${dist.sourceCount}/5 sources available — classification skipped`],
        forecastDriftF: refreshedForecastF - signal.forecastF,
        bracketDistanceCurrentF: 0,
      }
    : classifyPositionRisk({
        direction,
        marketType,
        bracketCapF: signal.bracketCapF ?? null,
        bracketFloorF: signal.bracketFloorF ?? null,
        signalForecastF: signal.forecastF,
        signalSpreadF: signal.spreadF,
        refreshedForecastF,
        refreshedSpreadF,
      })

  // 6. Build snapshot
  const refreshedTimestamp = Date.now()
  const snapshot: Omit<PositionRiskSnapshot, 'id' | 'expiresAt'> = {
    signalId: signal.id,
    ticker: signal.ticker,
    cityCode: signal.cityCode,
    marketType,
    direction,
    mode: signal.mode ?? null,
    bracketCapF: signal.bracketCapF ?? null,
    bracketFloorF: signal.bracketFloorF ?? null,
    bracketDistanceAtSignal: signal.bracketDistance,
    signalTimestamp: signal.timestamp,
    signalForecastF: signal.forecastF,
    signalSpreadF: signal.spreadF,
    signalLeadHours: signal.leadHours,
    refreshedTimestamp,
    refreshedForecastF,
    refreshedSpreadF,
    forecastDriftF: cls.forecastDriftF,
    bracketDistanceCurrentF: cls.bracketDistanceCurrentF,
    peakCloudCover: meanField('cloudCover'),
    peakHumidity: meanField('humidity'),
    peakWindGust: meanField('windGust'),
    prePeakPrecip24h: meanField('prePeakPrecip24h'),
    observedExtremeSoFarF,
    observedAtTs,
    observationCount,
    peakWindowStartUtcMs: window.startUtcMs,
    peakWindowEndUtcMs: window.endUtcMs,
    hoursIntoPeakWindow,
    riskLevel: cls.riskLevel,
    riskTriggers: cls.triggers,
  }

  return { signal, snapshot, error: null }
}

// ============================================================================
// Telegram alert formatting
// ============================================================================

/** Render the bracket as a human-readable label. Handles three cases:
 *  - Inner brackets (floor < cap): "65-66°F"
 *  - Cold-direction threshold (sold "≤cap"): "≤74°F"
 *  - Warm-direction threshold (sold "≥floor"): "≥65°F"
 *  Note: warm-tail signals encode floor === cap === threshold; we infer from direction. */
function bracketLabelFor(direction: 'cold' | 'warm', floor: number | null, cap: number | null): string {
  if (floor != null && cap != null && floor !== cap) {
    return `${floor}-${cap}°F`
  }
  if (direction === 'cold' && cap != null) return `≤${cap}°F`
  if (direction === 'warm' && floor != null) return `≥${floor}°F`
  return cap != null ? `≤${cap}°F` : floor != null ? `≥${floor}°F` : '?'
}

/** Plain-English explanation of what we sold and what wins. */
function positionExplanation(direction: 'cold' | 'warm', marketType: 'high' | 'low', floor: number | null, cap: number | null): string {
  const tempType = marketType === 'high' ? 'high' : 'low'
  const isInner = floor != null && cap != null && floor !== cap

  if (isInner) {
    return `Sold YES on "${tempType} between ${floor}-${cap}°F" — wins if actual ${tempType} lands OUTSIDE this range`
  }
  if (direction === 'cold' && cap != null) {
    return `Sold YES on "${tempType} ≤${cap}°F" — wins if ${tempType} reaches ${cap + 1}°F or above`
  }
  if (direction === 'warm' && floor != null) {
    return `Sold YES on "${tempType} ≥${floor}°F" — wins if ${tempType} stays below ${floor}°F`
  }
  return `Bracket ${bracketLabelFor(direction, floor, cap)}`
}

/** Plain-English statement of bracket-boundary status. */
function adverseExplanation(snap: Omit<PositionRiskSnapshot, 'id' | 'expiresAt'>): string {
  const buf = snap.bracketDistanceCurrentF
  const target = snap.direction === 'cold' ? snap.bracketCapF : snap.bracketFloorF
  if (target == null) return `Bracket distance: ${buf.toFixed(1)}°F`

  if (buf <= 0) {
    return `🚫 Refreshed forecast is now ${Math.abs(buf).toFixed(1)}°F into the losing region (past the ${target}°F bracket line).`
  }
  if (buf < 1) {
    return `⚠️ Refreshed forecast is only ${buf.toFixed(1)}°F from the ${target}°F bracket line — borderline.`
  }
  return `Refreshed forecast is ${buf.toFixed(1)}°F clear of the ${target}°F bracket line.`
}

function formatAlert(snap: Omit<PositionRiskSnapshot, 'id' | 'expiresAt'>): string {
  const e = emoji(snap.riskLevel)
  const tempLabel = snap.marketType === 'high' ? 'high' : 'low'
  const modeBadge = snap.mode === 'paper'
    ? '<i>(paper — no real money)</i>'
    : '<b>(LIVE — real money)</b>'

  const driftAbs = Math.abs(snap.forecastDriftF)
  const driftDir = snap.forecastDriftF < 0 ? 'cooled' : 'warmed'
  const driftLine = driftAbs < 0.05
    ? `Forecast: ${snap.signalForecastF.toFixed(1)}°F → ${snap.refreshedForecastF.toFixed(1)}°F (unchanged)`
    : `Forecast: ${snap.signalForecastF.toFixed(1)}°F → ${snap.refreshedForecastF.toFixed(1)}°F (${driftDir} ${driftAbs.toFixed(1)}°F)`

  const lines = [
    `${e} <b>${snap.cityCode} ${tempLabel} — ${snap.riskLevel}</b> ${modeBadge}`,
    ``,
    positionExplanation(snap.direction, snap.marketType, snap.bracketFloorF, snap.bracketCapF),
    ``,
    driftLine,
    adverseExplanation(snap),
  ]

  if (snap.observedExtremeSoFarF != null) {
    const observedLabel = snap.marketType === 'high' ? 'high so far today' : 'low so far'
    lines.push(`Observed ${observedLabel}: ${snap.observedExtremeSoFarF.toFixed(1)}°F`)
  }

  // Surface cloud only when notably anomalous (>70% on high market = potential Tmax suppressor)
  if (snap.marketType === 'high' && snap.peakCloudCover != null && snap.peakCloudCover > 70) {
    lines.push(`Cloud at peak: ${snap.peakCloudCover.toFixed(0)}% (anomaly — typical clear-sky baseline is &lt;50%)`)
  }

  lines.push('')
  lines.push(`<code>${snap.ticker}</code>`)
  return lines.join('\n')
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run')
  console.log(`[monitor] starting${dryRun ? ' (dry-run)' : ''} at ${new Date().toISOString()}`)

  const db = getDb()
  const pendingSignals = await db.collection<TailSellRecord>('tail_sell_signals')
    .find({ result: 'pending' })
    .toArray()

  console.log(`[monitor] ${pendingSignals.length} pending positions`)
  if (pendingSignals.length === 0) {
    await closeClient()
    return
  }

  // Pull prior snapshots for transition detection (all in one query)
  const priorSnapshots = await getLatestSnapshotsBySignal(pendingSignals.map(s => s.id))

  // Per-run caches
  const atmosphereCache = new Map<string, ReturnType<typeof extractPerSourcePeakHourAtmosphere>>()
  const obsCache = new Map<string, number | null>()

  const tally = { OK: 0, WARN: 0, CRITICAL: 0, errors: 0 }
  const transitions: Array<{ snapshot: Omit<PositionRiskSnapshot, 'id' | 'expiresAt'>; prior: RiskLevel | null }> = []

  for (const signal of pendingSignals) {
    const { snapshot, error } = await evaluatePosition(signal, atmosphereCache, obsCache)
    if (!snapshot) {
      console.warn(`[monitor] skip ${signal.ticker}: ${error}`)
      tally.errors++
      continue
    }

    tally[snapshot.riskLevel]++

    const prior = priorSnapshots.get(signal.id)
    const priorLevel = prior?.riskLevel ?? null

    // Console line per position
    const e = emoji(snapshot.riskLevel)
    const quadrant = quadrantLabel(snapshot.direction, snapshot.marketType)
    console.log(
      `${e} ${snapshot.riskLevel.padEnd(8)} ${signal.ticker} (${snapshot.cityCode} ${quadrant}, ${snapshot.mode ?? 'live'}) ` +
      `forecast ${snapshot.signalForecastF.toFixed(1)}→${snapshot.refreshedForecastF.toFixed(1)}°F ` +
      `(Δ${snapshot.forecastDriftF >= 0 ? '+' : ''}${snapshot.forecastDriftF.toFixed(1)}) ` +
      `buf=${snapshot.bracketDistanceCurrentF.toFixed(1)}°F` +
      (snapshot.peakCloudCover != null ? ` cloud=${snapshot.peakCloudCover.toFixed(0)}%` : '') +
      (snapshot.observedExtremeSoFarF != null ? ` obs=${snapshot.observedExtremeSoFarF.toFixed(1)}°F` : '')
    )
    if (snapshot.riskTriggers.length > 0) {
      for (const t of snapshot.riskTriggers) console.log(`    ↳ ${t}`)
    }

    // Detect transition
    const isUpgrade =
      (priorLevel === null && snapshot.riskLevel !== 'OK') ||
      (priorLevel === 'OK' && snapshot.riskLevel !== 'OK') ||
      (priorLevel === 'WARN' && snapshot.riskLevel === 'CRITICAL')

    // Throttle: skip if last snapshot for this signal was within ALERT_THROTTLE_MS
    const lastAlertWasRecent = prior &&
      (Date.now() - prior.refreshedTimestamp) < ALERT_THROTTLE_MS &&
      prior.riskLevel === snapshot.riskLevel  // same level + recent = throttle

    if (isUpgrade && !lastAlertWasRecent) {
      transitions.push({ snapshot, prior: priorLevel })
    }

    if (!dryRun) {
      await recordPositionRiskSnapshot(snapshot)
    }
  }

  // Send Telegram alerts for transitions (after main loop so we have full picture)
  if (!dryRun && transitions.length > 0) {
    console.log(`[monitor] ${transitions.length} risk-level transition(s) — sending alerts`)
    for (const { snapshot, prior } of transitions) {
      const transitionLine = prior == null
        ? `<i>New: classified as ${snapshot.riskLevel}</i>`
        : `<i>Risk level changed: ${prior} → ${snapshot.riskLevel}</i>`
      const text = `${transitionLine}\n\n${formatAlert(snapshot)}`
      const ok = await sendTelegramAlert(text)
      if (ok) console.log(`[monitor] alert sent: ${snapshot.ticker} (${prior ?? 'new'} → ${snapshot.riskLevel})`)
    }
  }

  // Summary
  console.log()
  console.log(`=== SUMMARY ===`)
  console.log(`OK: ${tally.OK} | WARN: ${tally.WARN} | CRITICAL: ${tally.CRITICAL} | errors: ${tally.errors}`)
  console.log(`Transitions alerted: ${transitions.length}`)

  await closeClient()
}

main().catch(err => {
  console.error('[monitor] fatal:', err)
  process.exit(1)
})
