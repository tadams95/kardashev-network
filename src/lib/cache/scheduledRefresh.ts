// Scheduled opportunity refresh — periodically re-computes opportunities for
// every tracked city so that signal logging (gated on cache-miss in the
// opportunities endpoint) fires on a predictable cadence regardless of
// browser traffic. Without this, low traffic periods produce 0-5 writes/day
// instead of the expected 30-50.
//
// ── Interval choice ──────────────────────────────────────────────────────
// 60 minutes, driven by the AccuWeather daily quota.
//
//   14 unique cities × (1440 min/day ÷ 60 min/cycle) = 336 AccuWeather calls/day
//   AccuWeather hard limit:                                               500/day
//   Headroom:                                                      164 calls (33%)
//
// Headroom absorbs warmup on deploy, on-demand browser traffic, and any
// manual refreshes. A 30-minute interval would need 672 calls/day and blow
// past the 500 limit. A 45-minute interval (448/day) would work but leave
// only 10% headroom — too tight for safe operation. Tomorrow.io has the
// same 500/day limit and is also satisfied at 60 min.
//
// Kalshi has a 300s (5-min) cache TTL, so every cycle refreshes market data;
// 14 × 24 cycles/day = 336 refreshes, batched 5-at-a-time with 300ms stagger
// (see getMarketsForCity). Well below observed 429 threshold.
//
// If you change this value, update the AccuWeather quota math above and the
// freshness-check thresholds in the calibration health report (which
// express WARN/STALE as multiples of this constant).
// ─────────────────────────────────────────────────────────────────────────

import { CITY_COORDS } from '@/lib/utils/cityCoordinates'
import { getDb } from '@/lib/db/mongodb'

export const OPPORTUNITY_REFRESH_INTERVAL_MS = 60 * 60 * 1000 // 60 minutes

/**
 * Deduplicate cities by coordinates (aliases like NY/NYC share coordinates).
 * Mirrors getUniqueCities() in warmup.ts — kept inline to avoid coupling the
 * scheduled refresh to the warmup module's internals.
 */
function getUniqueCitiesForRefresh(): Array<{ code: string; lat: number; lng: number }> {
  const seen = new Set<string>()
  const unique: Array<{ code: string; lat: number; lng: number }> = []

  for (const [code, info] of Object.entries(CITY_COORDS)) {
    const coordKey = `${info.lat.toFixed(4)},${info.lng.toFixed(4)}`
    if (seen.has(coordKey)) continue
    seen.add(coordKey)
    unique.push({ code, lat: info.lat, lng: info.lng })
  }

  return unique
}

interface CycleResult {
  durationMs: number
  citiesProcessed: number
  citiesTotal: number
  signalsCount: number
  cacheMisses: number
  errorsCount: number
  failures: string[]
  lastWriteIso: string | null
}

/**
 * Run one refresh cycle: force-recompute opportunities for every tracked
 * city, triggering server-side signal logging as a side effect.
 *
 * Per-city errors are isolated via try/catch — a single city failure never
 * aborts the cycle. Subsequent cycles get a fresh chance for every city.
 */
async function runRefreshCycle(): Promise<CycleResult> {
  const cycleStart = Date.now()
  const cities = getUniqueCitiesForRefresh()
  let signalsCount = 0
  let citiesProcessed = 0
  let errorsCount = 0
  const failures: string[] = []

  // Lazy import to avoid circular module init during startup
  const { getOpportunitiesForCity } = await import('@/pages/api/weather/opportunities')

  for (const city of cities) {
    try {
      const result = await getOpportunitiesForCity(city.code, { bypassCache: true })
      if (result.success) {
        citiesProcessed++
        if (result.data?.opportunities) {
          // Count mirrors logOpportunitySignals filter (opportunities.ts:148)
          for (const opp of result.data.opportunities) {
            if (opp.signal !== 'HOLD') signalsCount++
          }
        }
      } else {
        errorsCount++
        const msg = result.error || 'unknown error'
        failures.push(`${city.code}: ${msg.slice(0, 200)}`)
      }
    } catch (err) {
      errorsCount++
      const msg = err instanceof Error ? err.message : String(err)
      failures.push(`${city.code}: ${msg.slice(0, 200)}`)
    }
  }

  // last_write sanity check — independent of in-memory signalsCount.
  // Queries market_predictions for the most recent document (sort by _id
  // uses the default ObjectId index, which is fast). Note: fire-and-forget
  // writes from this cycle may not have landed yet, so this value reflects
  // the most recent previously-landed write. That's still the right signal:
  // if writes aren't landing across multiple cycles, this value will stay
  // stale cycle over cycle and we'll notice in the log stream.
  let lastWriteIso: string | null = null
  try {
    const db = getDb()
    const latest = await db
      .collection('market_predictions')
      .find({}, { projection: { timestamp: 1 } })
      .sort({ _id: -1 })
      .limit(1)
      .toArray()
    if (latest[0]?.timestamp) {
      lastWriteIso = new Date(latest[0].timestamp).toISOString()
    }
  } catch (err) {
    // Best-effort: don't let the freshness query kill the cycle log
    console.warn(
      '[scheduled-refresh] last_write lookup failed:',
      err instanceof Error ? err.message : err
    )
  }

  return {
    durationMs: Date.now() - cycleStart,
    citiesProcessed,
    citiesTotal: cities.length,
    signalsCount,
    cacheMisses: cities.length, // all cities bypass cache, so = processed + errored
    errorsCount,
    failures,
    lastWriteIso,
  }
}

function formatCycleLog(cycleStart: Date, result: CycleResult, prefix = 'cycle'): string {
  const base =
    `[scheduled-refresh] ${prefix}=${cycleStart.toISOString()} ` +
    `duration=${result.durationMs}ms ` +
    `cities=${result.citiesProcessed}/${result.citiesTotal} ` +
    `signals=${result.signalsCount} ` +
    `cache_misses=${result.cacheMisses} ` +
    `errors=${result.errorsCount} ` +
    `last_write=${result.lastWriteIso ?? 'none'}`
  if (result.failures.length > 0) {
    return `${base} failed=[${result.failures.join('; ')}]`
  }
  return base
}

let firstCycleComplete = false

/**
 * Run one refresh cycle and log a single structured line to stdout.
 * The first successful run additionally emits a FIRST_CYCLE_COMPLETE marker
 * so post-deploy verification has a single grep target.
 */
export async function refreshOpportunitiesAndLog(): Promise<void> {
  const cycleStart = new Date()
  try {
    const result = await runRefreshCycle()
    console.log(formatCycleLog(cycleStart, result))
    if (!firstCycleComplete) {
      firstCycleComplete = true
      console.log(
        `[scheduled-refresh] FIRST_CYCLE_COMPLETE ` +
          `duration=${result.durationMs}ms ` +
          `signals=${result.signalsCount} ` +
          `last_write=${result.lastWriteIso ?? 'none'} ` +
          `— scheduled refresh is now active`
      )
    }
  } catch (err) {
    console.error(
      '[scheduled-refresh] cycle-level error:',
      err instanceof Error ? err.message : err
    )
  }
}

let schedulerStarted = false

/**
 * Start the scheduled refresh loop. Aligns the first cycle to the next
 * round hour so cycle timestamps stay consistent across deploys and the
 * operational log stream is easy to scan. Subsequent cycles fire on the
 * OPPORTUNITY_REFRESH_INTERVAL_MS cadence.
 *
 * Idempotent: calling this more than once in the same process is a no-op.
 */
export function startScheduledOpportunityRefresh(): void {
  if (schedulerStarted) return
  schedulerStarted = true

  const now = Date.now()
  const nextHour =
    Math.ceil(now / (60 * 60 * 1000)) * (60 * 60 * 1000)
  const initialDelay = nextHour - now

  console.log(
    `[scheduled-refresh] scheduler armed: first cycle in ${Math.round(initialDelay / 1000)}s ` +
      `(${new Date(nextHour).toISOString()}), interval=${OPPORTUNITY_REFRESH_INTERVAL_MS / 60000}min`
  )

  setTimeout(() => {
    refreshOpportunitiesAndLog().catch(err =>
      console.error('[scheduled-refresh] cycle-level error:', err instanceof Error ? err.message : err)
    )
    setInterval(() => {
      refreshOpportunitiesAndLog().catch(err =>
        console.error('[scheduled-refresh] cycle-level error:', err instanceof Error ? err.message : err)
      )
    }, OPPORTUNITY_REFRESH_INTERVAL_MS)
  }, initialDelay)
}
