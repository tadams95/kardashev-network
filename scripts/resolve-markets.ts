// Standalone market resolution script
// Replaces the Vercel cron at /api/weather/resolve-markets
// Run: npm run resolve-markets

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config() // fallback to .env if it exists
import { CITY_COORDS } from '../src/lib/utils/cityCoordinates'
import { extractCityCode, extractMarketType } from '../src/lib/utils/tickerParsing'
import { resolveWithTemperature, getSignalHistory, getUnresolvedSignals } from '../src/lib/models/performanceTracker'
import { writeSourceAccuracyFromServerSnapshot } from '../src/lib/models/sourceAccuracy'
import { resolveTailSellSignals } from '../src/lib/models/tailSellTracker'
import { closeClient } from '../src/lib/db/mongodb'

// Hard 10-minute safety timeout (first run after adding KXLOWT backfills historical events)
const HARD_TIMEOUT = 10 * 60 * 1000
setTimeout(() => {
  console.error('[resolve-markets] Hard timeout reached (10 min) — aborting')
  process.exit(1)
}, HARD_TIMEOUT).unref()

// Dry-run mode: resolve logic runs but no DB writes
const DRY_RUN = process.argv.includes('--dry-run')

// ============================================================================
// Types
// ============================================================================

interface KalshiMarketRaw {
  ticker: string
  title: string
  status: string
  result?: string
  close_time: string
  strike_type: string
  floor_strike?: number | null
  cap_strike?: number | null
  yes_sub_title: string
  no_sub_title: string
  event_ticker?: string
}

// ============================================================================
// Constants
// ============================================================================

const KALSHI_API_BASE = 'https://api.elections.kalshi.com/trade-api/v2'
const WEATHER_SERIES_PREFIXES = ['KXHIGH', 'KXHIGHT', 'KXLOWT']
const FETCH_TIMEOUT = 30_000
const REQUEST_DELAY_MS = 150          // Stay under Kalshi's ~10 req/s limit
const MAX_RETRY_ROUNDS = 3
const BACKOFF_DELAYS = [2_000, 5_000, 10_000]
const MAX_PAGES_PER_SERIES = 10       // Upper bound: 10 pages × 200 = 2000 markets max per series+city

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ============================================================================
// Ticker Parsing
// ============================================================================

// extractCityCode is now imported from ../src/lib/utils/tickerParsing

function extractEventDate(eventTicker: string): string | null {
  const match = eventTicker.match(/-(\d{2})([A-Z]{3})(\d{2})$/)
  if (!match) return null
  const [, yy, mmm, dd] = match
  const months: Record<string, string> = {
    JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
    JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12',
  }
  const mm = months[mmm]
  if (!mm) return null
  return `20${yy}${mm}${dd}`
}

// ============================================================================
// Fetch with Timeout
// ============================================================================

async function fetchWithTimeout(url: string, timeoutMs = FETCH_TIMEOUT): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

// ============================================================================
// Kalshi Fetch (settled markets only)
// ============================================================================

async function fetchSettledMarkets(): Promise<KalshiMarketRaw[]> {
  const allMarkets: KalshiMarketRaw[] = []
  const cityCodes = Object.keys(CITY_COORDS)
  let retryQueue: Array<{ prefix: string; cityCode: string }> = []

  for (const prefix of WEATHER_SERIES_PREFIXES) {
    for (const cityCode of cityCodes) {
      const seriesTicker = `${prefix}${cityCode}`

      try {
        let cursor: string | undefined
        let pages = 0

        while (pages < MAX_PAGES_PER_SERIES) {
          const url = new URL(`${KALSHI_API_BASE}/markets`)
          url.searchParams.set('series_ticker', seriesTicker)
          url.searchParams.set('status', 'settled')
          url.searchParams.set('limit', '200')
          if (cursor) url.searchParams.set('cursor', cursor)

          const response = await fetchWithTimeout(url.toString())

          if (!response.ok) {
            if (response.status === 429) {
              retryQueue.push({ prefix, cityCode })
            } else {
              console.warn(`[resolve-markets] ${seriesTicker}: HTTP ${response.status}`)
            }
            break
          }

          const data = await response.json()
          const markets: KalshiMarketRaw[] = data.markets || []
          allMarkets.push(...markets)
          pages++

          // Continue if full page returned and cursor available
          if (markets.length === 200 && data.cursor) {
            cursor = data.cursor
            await delay(REQUEST_DELAY_MS)
          } else {
            break
          }
        }

        if (pages > 1) {
          console.log(`[resolve-markets] ${seriesTicker}: fetched ${pages} pages`)
        }
      } catch (err) {
        console.warn(`[resolve-markets] ${seriesTicker}: ${err instanceof Error ? err.message : 'fetch failed'}`)
      }

      await delay(REQUEST_DELAY_MS)
    }
  }

  // Exponential backoff retries for 429'd requests (single page only — recovery path)
  for (let round = 0; round < MAX_RETRY_ROUNDS && retryQueue.length > 0; round++) {
    const backoff = BACKOFF_DELAYS[round]
    console.log(`[resolve-markets] Retry round ${round + 1}: ${retryQueue.length} rate-limited requests (waiting ${backoff / 1000}s)...`)
    await delay(backoff)

    const nextRetry: typeof retryQueue = []
    for (const { prefix, cityCode } of retryQueue) {
      const seriesTicker = `${prefix}${cityCode}`
      const url = new URL(`${KALSHI_API_BASE}/markets`)
      url.searchParams.set('series_ticker', seriesTicker)
      url.searchParams.set('status', 'settled')
      url.searchParams.set('limit', '200')

      try {
        const response = await fetchWithTimeout(url.toString())
        if (response.status === 429) {
          nextRetry.push({ prefix, cityCode })
          continue
        }
        if (!response.ok) {
          console.warn(`[resolve-markets] ${seriesTicker}: HTTP ${response.status} on retry`)
          continue
        }
        const data = await response.json()
        const markets: KalshiMarketRaw[] = data.markets || []
        allMarkets.push(...markets)
      } catch (err) {
        console.warn(`[resolve-markets] ${seriesTicker}: ${err instanceof Error ? err.message : 'fetch failed'} on retry`)
      }

      await delay(REQUEST_DELAY_MS)
    }

    retryQueue = nextRetry
  }

  if (retryQueue.length > 0) {
    console.warn(`[resolve-markets] ${retryQueue.length} requests still rate-limited after ${MAX_RETRY_ROUNDS} retry rounds:`)
    for (const { prefix, cityCode } of retryQueue) {
      console.warn(`  ${prefix}${cityCode}`)
    }
  }

  return allMarkets
}

// ============================================================================
// Core Resolution Logic
// ============================================================================

interface SettledEventResult {
  eventTicker: string
  actualTemp: number | null  // null for threshold-winner events (no precise midpoint)
  isThresholdWinner: boolean
  winningTicker: string
  winningBracket: string
  cityCode: string
  marketTickers: string[]
  marketOutcomes: Record<string, boolean>
}

function processSettledEvents(markets: KalshiMarketRaw[]): SettledEventResult[] {
  // Group by event_ticker
  const events = new Map<string, KalshiMarketRaw[]>()
  for (const market of markets) {
    if (!market.event_ticker) continue
    const group = events.get(market.event_ticker) || []
    group.push(market)
    events.set(market.event_ticker, group)
  }

  const results: SettledEventResult[] = []

  for (const [eventTicker, eventMarkets] of events) {
    // Log canceled/voided markets for observability
    const canceled = eventMarkets.filter(m => m.result === 'canceled' || m.result === 'voided')
    if (canceled.length > 0) {
      console.log(`[resolve-markets] ${eventTicker}: ${canceled.length} canceled/voided markets, skipping`)
    }

    // Prefer inner bracket winner (has both floor + cap → precise midpoint temp)
    const innerWinner = eventMarkets.find(
      (m) => m.result === 'yes' && m.floor_strike != null && m.cap_strike != null
    )
    // Fall back to threshold bracket winner (only one strike — no precise temp)
    const thresholdWinner = !innerWinner
      ? eventMarkets.find(
          (m) => m.result === 'yes' && (m.floor_strike != null || m.cap_strike != null)
        )
      : null
    const winner = innerWinner || thresholdWinner
    if (!winner) continue

    const isThresholdWinner = !innerWinner && thresholdWinner != null

    // actualTemp: midpoint for inner brackets, null for threshold brackets
    // Threshold boundaries are NOT used as actualTemp — they're not the true observed value
    // and would poison source accuracy / bias tracking with fake errors of 10-20°F
    const actualTemp = isThresholdWinner
      ? null
      : ((winner.floor_strike as number) + (winner.cap_strike as number)) / 2

    const cityCode = extractCityCode(eventTicker)
    if (!cityCode) {
      console.warn(`[resolve-markets] Could not parse city code from event ticker: ${eventTicker}`)
      continue
    }

    const winningBracket = isThresholdWinner
      ? (winner.floor_strike != null ? `≥${winner.floor_strike}°F` : `<${winner.cap_strike}°F`)
      : `${winner.floor_strike}–${winner.cap_strike}°F`

    const marketOutcomes = Object.fromEntries(
      eventMarkets
        .filter((m) => m.result === 'yes' || m.result === 'no')
        .map((m) => [m.ticker, m.result === 'yes'])
    )

    results.push({
      eventTicker,
      actualTemp,
      isThresholdWinner,
      winningTicker: winner.ticker,
      winningBracket,
      cityCode,
      marketTickers: Object.keys(marketOutcomes),
      marketOutcomes,
    })
  }

  return results
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  if (DRY_RUN) console.log('[resolve-markets] *** DRY RUN — no DB writes ***')
  console.log('[resolve-markets] Starting market resolution...')

  // 1. Fetch settled weather markets from Kalshi
  const settledMarkets = await fetchSettledMarkets()
  console.log(`[resolve-markets] Fetched ${settledMarkets.length} settled markets`)

  if (settledMarkets.length === 0) {
    console.log('[resolve-markets] No settled markets found — nothing to resolve')
    return
  }

  // 2. Process settled events to find winning brackets
  const settledEvents = processSettledEvents(settledMarkets)
  const innerWinnerEvents = settledEvents.filter(e => !e.isThresholdWinner)
  const thresholdWinnerEvents = settledEvents.filter(e => e.isThresholdWinner)
  console.log(`[resolve-markets] Found ${settledEvents.length} settled events (${innerWinnerEvents.length} inner-winner, ${thresholdWinnerEvents.length} threshold-winner)`)

  // 3. Get all unresolved signals to match against
  const allSignals = await getSignalHistory()
  const unresolvedSignals = await getUnresolvedSignals()
  const unresolvedMarketIds = new Set(unresolvedSignals.map(s => s.marketId))
  console.log(`[resolve-markets] ${unresolvedMarketIds.size} unresolved market IDs in DB (${unresolvedSignals.length} total unresolved signals)`)

  // 4. Resolve signals for each settled event
  let totalResolved = 0
  let biasObservations = 0
  let thresholdResolved = 0
  const details: Array<{
    eventTicker: string
    actualTemp: number | null
    winningBracket: string
    signalsResolved: number
    isThresholdWinner: boolean
  }> = []

  for (const event of settledEvents) {
    let eventResolved = 0

    for (const marketTicker of event.marketTickers) {
      if (!unresolvedMarketIds.has(marketTicker)) continue

      const outcome = event.marketOutcomes[marketTicker]
      if (typeof outcome !== 'boolean') continue

      if (DRY_RUN) {
        // Count signals that would be resolved without writing
        const matchingSignals = unresolvedSignals.filter(s => s.marketId === marketTicker)
        eventResolved += matchingSignals.length
        totalResolved += matchingSignals.length
        if (event.isThresholdWinner) thresholdResolved += matchingSignals.length
      } else {
        // Threshold-winner events: resolve outcome only, skip bias/accuracy recording
        // Inner-winner events: full resolution with temperature tracking
        const result = await resolveWithTemperature(
          marketTicker,
          outcome,
          event.actualTemp  // null for threshold winners — gated inside resolveWithTemperature
        )

        eventResolved += result.resolved
        totalResolved += result.resolved
        biasObservations += result.biasRecorded
        if (event.isThresholdWinner) thresholdResolved += result.resolved
      }
    }

    if (eventResolved > 0) {
      details.push({
        eventTicker: event.eventTicker,
        actualTemp: event.actualTemp,
        winningBracket: event.winningBracket,
        signalsResolved: eventResolved,
        isThresholdWinner: event.isThresholdWinner,
      })
    }
  }

  // 5. Write source accuracy from server-side snapshots (Kalshi bracket midpoint)
  // ONLY for inner-winner events — threshold winners lack a precise actual temperature
  let serverSnapshotAccuracy = 0
  let thresholdAccuracySkipped = 0
  for (const event of settledEvents) {
    if (event.isThresholdWinner) {
      thresholdAccuracySkipped++
      continue
    }

    const eventDate = extractEventDate(event.eventTicker)
    if (!eventDate) continue
    const marketType = extractMarketType(event.eventTicker)

    if (DRY_RUN) continue

    const written = await writeSourceAccuracyFromServerSnapshot({
      cityCode: event.cityCode,
      date: eventDate,
      marketType,
      actualTemp: event.actualTemp as number,
      groundTruthSource: 'kalshi_midpoint',
      marketId: event.winningTicker,
    })
    serverSnapshotAccuracy += written
  }

  // 6. Resolve tail sell signals
  let tailSellResolved = 0
  if (!DRY_RUN) {
    for (const event of settledEvents) {
      const resolved = await resolveTailSellSignals(
        event.marketOutcomes,
        event.actualTemp,
      )
      tailSellResolved += resolved
    }
  }

  // 7. Recompute dynamic weight rollups with fresh accuracy data
  if (!DRY_RUN) {
    console.log('[resolve-markets] Computing weight rollups...')
    try {
      const { recomputeAndPublishWeightRollups } = await import('../src/lib/models/sourceAccuracy')
      const rollup = await recomputeAndPublishWeightRollups()
      console.log(`[resolve-markets]   Weight rollup: ${rollup.keysWritten} keys (${rollup.durationMs}ms)`)
    } catch (err) {
      console.warn('[resolve-markets]   Weight rollup failed:', err instanceof Error ? err.message : err)
    }
  }

  // 8. Print summary
  console.log(`[resolve-markets] ${DRY_RUN ? 'DRY RUN ' : ''}Done:`)
  console.log(`  Signals resolved: ${totalResolved} (${thresholdResolved} from threshold-winner events)`)
  console.log(`  Tail sells resolved: ${tailSellResolved}`)
  console.log(`  Bias observations: ${biasObservations}`)
  console.log(`  Server snapshot accuracy: ${serverSnapshotAccuracy} (${thresholdAccuracySkipped} threshold events skipped)`)
  console.log(`  Events with resolutions: ${details.length}`)

  if (details.length > 0) {
    console.log(`  Details:`)
    for (const d of details) {
      const tempStr = d.actualTemp != null ? `actual ${d.actualTemp}°F` : 'threshold (no temp)'
      const tag = d.isThresholdWinner ? ' [THRESHOLD]' : ''
      console.log(`    ${d.eventTicker}: ${d.winningBracket} (${tempStr}) — ${d.signalsResolved} signals${tag}`)
    }
  }
}

// ============================================================================
// Entry Point
// ============================================================================

main()
  .then(() => closeClient())
  .then(() => {
    process.exit(0)
  })
  .catch((error) => {
    console.error('[resolve-markets] Fatal error:', error)
    closeClient().finally(() => process.exit(1))
  })
