// Standalone market resolution script
// Replaces the Vercel cron at /api/weather/resolve-markets
// Run: npm run resolve-markets

import 'dotenv/config'
import { CITY_COORDS } from '../src/lib/utils/cityCoordinates'
import { resolveWithTemperature, getSignalHistory } from '../src/lib/models/performanceTracker'
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
const WEATHER_SERIES_PREFIXES = ['KXHIGH', 'KXHIGHT', 'KXLOW']
const FETCH_TIMEOUT = 30_000

// ============================================================================
// Ticker Parsing
// ============================================================================

function extractCityCode(ticker: string): string | null {
  const upper = ticker.toUpperCase()
  const sortedCodes = Object.keys(CITY_COORDS).sort((a, b) => b.length - a.length)
  for (const code of sortedCodes) {
    if (upper.includes(code)) return code
  }
  return null
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
  const retryQueue: Array<{ prefix: string; cityCode: string }> = []

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
          }
          continue
        }

        const data = await response.json()
        const markets: KalshiMarketRaw[] = data.markets || []
        allMarkets.push(...markets)
      } catch {
        // Timeout or network error — skip silently
      }
    }
  }

  // Single retry pass for 429'd requests
  if (retryQueue.length > 0) {
    console.log(`[resolve-markets] Retrying ${retryQueue.length} rate-limited requests...`)
    await new Promise(resolve => setTimeout(resolve, 2000))
    for (const { prefix, cityCode } of retryQueue) {
      const url = new URL(`${KALSHI_API_BASE}/markets`)
      url.searchParams.set('series_ticker', `${prefix}${cityCode}`)
      url.searchParams.set('status', 'settled')
      url.searchParams.set('limit', '200')
      try {
        const response = await fetchWithTimeout(url.toString())
        if (!response.ok) continue
        const data = await response.json()
        const markets: KalshiMarketRaw[] = data.markets || []
        allMarkets.push(...markets)
      } catch { /* skip */ }
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
    const winner = eventMarkets.find(m => m.result === 'yes')
    if (!winner) continue

    if (winner.floor_strike == null || winner.cap_strike == null) continue

    const actualTemp = (winner.floor_strike + winner.cap_strike) / 2

    const cityCode = extractCityCode(eventTicker)
    if (!cityCode) continue

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
  const unresolvedMarketIds = new Set(
    allSignals
      .filter(s => s.outcome === undefined)
      .map(s => s.marketId)
  )
  console.log(`[resolve-markets] ${unresolvedMarketIds.size} unresolved signals in DB`)

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

  // 5. Print summary
  console.log(`[resolve-markets] Done:`)
  console.log(`  Signals resolved: ${totalResolved}`)
  console.log(`  Bias observations: ${biasObservations}`)
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
