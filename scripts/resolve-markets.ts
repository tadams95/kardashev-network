// Standalone market resolution script
// Replaces the Vercel cron at /api/weather/resolve-markets
// Run: npm run resolve-markets

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config() // fallback to .env if it exists
import { CITY_COORDS } from '../src/lib/utils/cityCoordinates'
import { extractCityCode } from '../src/lib/utils/tickerParsing'
import { resolveWithTemperature, getSignalHistory, getUnresolvedSignals } from '../src/lib/models/performanceTracker'
import { recordSourceAccuracy, writeSourceAccuracyFromServerSnapshot } from '../src/lib/models/sourceAccuracy'
import { fetchMETAR } from '../src/lib/api/metar'
import { closeClient } from '../src/lib/db/mongodb'

// Hard 5-minute safety timeout
const HARD_TIMEOUT = 5 * 60 * 1000
setTimeout(() => {
  console.error('[resolve-markets] Hard timeout reached (5 min) — aborting')
  process.exit(1)
}, HARD_TIMEOUT).unref()

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
const WEATHER_SERIES_PREFIXES = ['KXHIGH', 'KXHIGHT']
const FETCH_TIMEOUT = 30_000
const REQUEST_DELAY_MS = 150          // Stay under Kalshi's ~10 req/s limit
const MAX_RETRY_ROUNDS = 3
const BACKOFF_DELAYS = [2_000, 5_000, 10_000]

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

function extractMarketType(eventTicker: string): 'high' | 'low' {
  return eventTicker.toUpperCase().includes('KXLOW') ? 'low' : 'high'
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

      const url = new URL(`${KALSHI_API_BASE}/markets`)
      url.searchParams.set('series_ticker', seriesTicker)
      url.searchParams.set('status', 'settled')
      url.searchParams.set('limit', '200')

      try {
        const response = await fetchWithTimeout(url.toString())

        if (!response.ok) {
          if (response.status === 429) {
            retryQueue.push({ prefix, cityCode })
          } else {
            console.warn(`[resolve-markets] ${seriesTicker}: HTTP ${response.status}`)
          }
          continue
        }

        const data = await response.json()
        const markets: KalshiMarketRaw[] = data.markets || []
        allMarkets.push(...markets)
      } catch (err) {
        console.warn(`[resolve-markets] ${seriesTicker}: ${err instanceof Error ? err.message : 'fetch failed'}`)
      }

      await delay(REQUEST_DELAY_MS)
    }
  }

  // Exponential backoff retries for 429'd requests
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

function processSettledEvents(markets: KalshiMarketRaw[]): Array<{
  eventTicker: string
  actualTemp: number
  winningTicker: string
  winningBracket: string
  cityCode: string
  marketTickers: string[]
}> {
  // Group by event_ticker
  const events = new Map<string, KalshiMarketRaw[]>()
  for (const market of markets) {
    if (!market.event_ticker) continue
    const group = events.get(market.event_ticker) || []
    group.push(market)
    events.set(market.event_ticker, group)
  }

  const results: Array<{
    eventTicker: string
    actualTemp: number
    winningTicker: string
    winningBracket: string
    cityCode: string
    marketTickers: string[]
  }> = []

  for (const [eventTicker, eventMarkets] of events) {
    // Log canceled/voided markets for observability
    const canceled = eventMarkets.filter(m => m.result === 'canceled' || m.result === 'voided')
    if (canceled.length > 0) {
      console.log(`[resolve-markets] ${eventTicker}: ${canceled.length} canceled/voided markets, skipping`)
    }

    const winner = eventMarkets.find(m => m.result === 'yes')
    if (!winner) continue

    if (winner.floor_strike == null || winner.cap_strike == null) continue

    const actualTemp = (winner.floor_strike + winner.cap_strike) / 2

    const cityCode = extractCityCode(eventTicker)
    if (!cityCode) {
      console.warn(`[resolve-markets] Could not parse city code from event ticker: ${eventTicker}`)
      continue
    }

    const winningBracket = `${winner.floor_strike}–${winner.cap_strike}°F`

    results.push({
      eventTicker,
      actualTemp,
      winningTicker: winner.ticker,
      winningBracket,
      cityCode,
      marketTickers: eventMarkets.map(m => m.ticker),
    })
  }

  return results
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
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
  console.log(`[resolve-markets] Found ${settledEvents.length} settled events with winners`)

  // 3. Get all unresolved signals to match against
  const allSignals = await getSignalHistory()
  const unresolvedSignals = await getUnresolvedSignals()
  const unresolvedMarketIds = new Set(unresolvedSignals.map(s => s.marketId))
  console.log(`[resolve-markets] ${unresolvedMarketIds.size} unresolved signals in DB (${unresolvedSignals.length} total unresolved)`)

  // 4. Resolve signals for each settled event
  let totalResolved = 0
  let biasObservations = 0
  const details: Array<{
    eventTicker: string
    actualTemp: number
    winningBracket: string
    signalsResolved: number
  }> = []

  for (const event of settledEvents) {
    let eventResolved = 0

    for (const marketTicker of event.marketTickers) {
      if (!unresolvedMarketIds.has(marketTicker)) continue

      const isWinner = marketTicker === event.winningTicker
      const result = await resolveWithTemperature(
        marketTicker,
        isWinner,
        event.actualTemp
      )

      eventResolved += result.resolved
      totalResolved += result.resolved
      biasObservations += result.biasRecorded
    }

    if (eventResolved > 0) {
      details.push({
        eventTicker: event.eventTicker,
        actualTemp: event.actualTemp,
        winningBracket: event.winningBracket,
        signalsResolved: eventResolved,
      })
    }
  }

  // 5. Attempt METAR ground truth for higher-precision source accuracy
  const metarWrittenEvents = new Set<string>()
  let metarObservations = 0
  for (const event of settledEvents) {
    const station = CITY_COORDS[event.cityCode]?.resolutionStation
    if (!station) continue

    try {
      const metarResult = await fetchMETAR(station)
      if (metarResult?.data?.temperature?.maxTAvailable) {
        // METAR returns °C — convert to °F
        const metarTempF = metarResult.data.temperature.max * 9 / 5 + 32

        // Find signals for this event that have per-source forecasts
        const eventSignals = allSignals.filter(s =>
          event.marketTickers.includes(s.marketId) && s.perSourceForecasts
        )

        for (const signal of eventSignals) {
          if (!signal.perSourceForecasts) continue
          const signalCity = extractCityCode(signal.marketId) ?? signal.cityCode
          if (!signalCity) continue
          if (signal.cityCode && signalCity !== signal.cityCode) {
            console.warn(`[resolve-markets] Cross-city mismatch: signal.cityCode=${signal.cityCode} but marketId=${signal.marketId} → ${signalCity}`)
          }
          for (const [source, srcForecastTemp] of Object.entries(signal.perSourceForecasts)) {
            await recordSourceAccuracy(source, signalCity, srcForecastTemp, metarTempF, {
              signalId: signal.id,
              marketId: signal.marketId,
              leadHours: signal.hoursToResolution,
              temperatureType: signal.temperatureType || 'high',
              groundTruthSource: 'metar',
              policyVersion: signal.decisionPolicyVersion,
            })
            metarObservations++
          }
        }

        if (eventSignals.length === 0) {
          // No client signals — use server-side snapshot for METAR accuracy
          const eventDate = extractEventDate(event.eventTicker)
          if (eventDate) {
            const marketType = extractMarketType(event.eventTicker)
            await writeSourceAccuracyFromServerSnapshot({
              cityCode: event.cityCode,
              date: eventDate,
              marketType,
              actualTemp: metarTempF,
              groundTruthSource: 'metar',
              marketId: event.winningTicker,
            })
            metarWrittenEvents.add(event.eventTicker)
          }
        } else {
          // Client signals already wrote METAR accuracy — mark as covered
          metarWrittenEvents.add(event.eventTicker)
        }
      }
    } catch {
      // METAR unavailable — bracket midpoint already recorded via resolveWithTemperature
    }
  }

  // 6. Write source accuracy from server-side snapshots (Kalshi bracket midpoint)
  // Covers events where no client-side signals existed (no browser traffic).
  // Skip events already written with METAR ground truth in Step 5.
  let serverSnapshotAccuracy = 0
  for (const event of settledEvents) {
    if (metarWrittenEvents.has(event.eventTicker)) continue
    const eventDate = extractEventDate(event.eventTicker)
    if (!eventDate) continue
    const marketType = extractMarketType(event.eventTicker)

    const written = await writeSourceAccuracyFromServerSnapshot({
      cityCode: event.cityCode,
      date: eventDate,
      marketType,
      actualTemp: event.actualTemp,
      groundTruthSource: 'kalshi_midpoint',
      marketId: event.winningTicker,
    })
    serverSnapshotAccuracy += written
  }

  // 7. Recompute dynamic weight rollups with fresh accuracy data
  console.log('[resolve-markets] Computing weight rollups...')
  try {
    const { recomputeAndPublishWeightRollups } = await import('../src/lib/models/sourceAccuracy')
    const rollup = await recomputeAndPublishWeightRollups()
    console.log(`[resolve-markets]   Weight rollup: ${rollup.keysWritten} keys (${rollup.durationMs}ms)`)
  } catch (err) {
    console.warn('[resolve-markets]   Weight rollup failed:', err instanceof Error ? err.message : err)
  }

  // 8. Print summary
  console.log(`[resolve-markets] Done:`)
  console.log(`  Signals resolved: ${totalResolved}`)
  console.log(`  Bias observations: ${biasObservations}`)
  console.log(`  METAR observations: ${metarObservations}`)
  console.log(`  Server snapshot accuracy: ${serverSnapshotAccuracy}`)
  console.log(`  Events with resolutions: ${details.length}`)

  if (details.length > 0) {
    console.log(`  Details:`)
    for (const d of details) {
      console.log(`    ${d.eventTicker}: ${d.winningBracket} (actual ${d.actualTemp}°F) — ${d.signalsResolved} signals`)
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
