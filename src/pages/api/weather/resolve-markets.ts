// Auto-resolve settled Kalshi weather markets
// Finds winning brackets, computes actual temperature, and feeds the bias tracker
// Designed to run as a Vercel cron job (every 4 hours)

import type { NextApiRequest, NextApiResponse } from 'next'
import { CITY_COORDS } from '@/lib/utils/cityCoordinates'
import { resolveWithTemperature, getSignalHistory } from '@/lib/models/performanceTracker'

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

interface ResolveResponse {
  success: boolean
  resolved: number
  events: number
  biasObservations: number
  details?: Array<{
    eventTicker: string
    actualTemp: number
    winningBracket: string
    signalsResolved: number
  }>
  error?: string
}

// ============================================================================
// Constants
// ============================================================================

const KALSHI_API_BASE = 'https://api.elections.kalshi.com/trade-api/v2'
const WEATHER_SERIES_PREFIXES = ['KXHIGH', 'KXHIGHT', 'KXLOW']

// ============================================================================
// Ticker Parsing (lightweight — only needs city code extraction)
// ============================================================================

function extractCityCode(ticker: string): string | null {
  const upper = ticker.toUpperCase()
  // Sort by length descending to prevent short codes (e.g. "LA") from
  // matching before longer ones (e.g. "DAL")
  const sortedCodes = Object.keys(CITY_COORDS).sort((a, b) => b.length - a.length)
  for (const code of sortedCodes) {
    if (upper.includes(code)) return code
  }
  return null
}

// ============================================================================
// Core Resolution Logic
// ============================================================================

interface SettledEvent {
  eventTicker: string
  markets: KalshiMarketRaw[]
}

/**
 * Group settled markets by event_ticker and find the winning bracket.
 * Returns the actual temperature (midpoint of the winning bracket).
 */
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
    // Find the winning bracket (result === 'yes')
    const winner = eventMarkets.find(m => m.result === 'yes')
    if (!winner) continue

    // Need both floor and cap strike to compute midpoint
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
// Fetch with Timeout
// ============================================================================

async function fetchWithTimeout(url: string, timeoutMs = 10000): Promise<Response> {
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
// Auth
// ============================================================================

function isAuthorized(req: NextApiRequest): boolean {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return false // Fail closed

  const authHeader = req.headers.authorization
  if (!authHeader) return false

  return authHeader === `Bearer ${cronSecret}`
}

// ============================================================================
// API Handler
// ============================================================================

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ResolveResponse>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      resolved: 0,
      events: 0,
      biasObservations: 0,
      error: 'Method not allowed. Use POST.',
    })
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({
      success: false,
      resolved: 0,
      events: 0,
      biasObservations: 0,
      error: 'Unauthorized',
    })
  }

  try {
    // 1. Fetch settled weather markets from Kalshi
    const settledMarkets = await fetchSettledMarkets()

    if (settledMarkets.length === 0) {
      return res.status(200).json({
        success: true,
        resolved: 0,
        events: 0,
        biasObservations: 0,
      })
    }

    // 2. Process settled events to find winning brackets
    const settledEvents = processSettledEvents(settledMarkets)

    // 3. Get all unresolved signals to match against
    const allSignals = await getSignalHistory()
    const unresolvedMarketIds = new Set(
      allSignals
        .filter(s => s.outcome === undefined)
        .map(s => s.marketId)
    )

    // 4. Resolve signals for each settled event
    let totalResolved = 0
    let biasObservations = 0
    const details: ResolveResponse['details'] = []

    for (const event of settledEvents) {
      let eventResolved = 0

      for (const marketTicker of event.marketTickers) {
        // Only attempt resolution if we have unresolved signals for this market
        if (!unresolvedMarketIds.has(marketTicker)) continue

        // The winning market resolves as true (YES wins), all others as false
        const isWinner = marketTicker === event.winningTicker
        const { resolved, biasRecorded } = await resolveWithTemperature(
          marketTicker,
          isWinner,
          event.actualTemp
        )

        eventResolved += resolved
        totalResolved += resolved
        biasObservations += biasRecorded
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

    console.log(`[resolve-markets] ${totalResolved} signals resolved, ${biasObservations} bias observations, ${details.length} events`)

    return res.status(200).json({
      success: true,
      resolved: totalResolved,
      events: details.length,
      biasObservations,
      details: details.length > 0 ? details : undefined,
    })
  } catch (error) {
    console.error('Market resolution error:', error)
    return res.status(500).json({
      success: false,
      resolved: 0,
      events: 0,
      biasObservations: 0,
      error: error instanceof Error ? error.message : 'Resolution failed',
    })
  }
}
