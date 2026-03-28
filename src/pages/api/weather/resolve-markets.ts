// Auto-resolve settled Kalshi weather markets
// Finds winning brackets, computes actual temperature, and feeds the bias tracker
// Designed to run as a Vercel cron job (every 4 hours)

import type { NextApiRequest, NextApiResponse } from 'next'
import { CITY_COORDS } from '@/lib/utils/cityCoordinates'
import { extractCityCode, extractMarketType } from '@/lib/utils/tickerParsing'
import { resolveWithTemperature, getSignalHistory, getUnresolvedSignals } from '@/lib/models/performanceTracker'
import { writeSourceAccuracyFromServerSnapshot } from '@/lib/models/sourceAccuracy'
import { resolveTailSellSignals } from '@/lib/models/tailSellTracker'

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
const REQUEST_DELAY_MS = 150          // Stay under Kalshi's ~10 req/s limit
const MAX_RETRY_ROUNDS = 3
const BACKOFF_DELAYS = [2_000, 5_000, 10_000]

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ============================================================================
// Ticker Parsing (lightweight — only needs city code extraction)
// ============================================================================

// extractCityCode is now imported from @/lib/utils/tickerParsing

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
  marketOutcomes: Record<string, boolean>
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
    marketOutcomes: Record<string, boolean>
  }> = []

  for (const [eventTicker, eventMarkets] of events) {
    // Log canceled/voided markets for observability
    const canceled = eventMarkets.filter(m => m.result === 'canceled' || m.result === 'voided')
    if (canceled.length > 0) {
      console.log(`[resolve-markets] ${eventTicker}: ${canceled.length} canceled/voided markets, skipping`)
    }

    // Find the winning bracket (result === 'yes' with both floor/cap strikes).
    // Threshold ladders can have multiple YES markets, so the first YES market
    // is not necessarily the bracket we need for midpoint-based ground truth.
    const winner = eventMarkets.find(
      (m) => m.result === 'yes' && m.floor_strike != null && m.cap_strike != null
    )
    if (!winner) continue

    const actualTemp = (winner.floor_strike! + winner.cap_strike!) / 2

    const cityCode = extractCityCode(eventTicker)
    if (!cityCode) {
      console.warn(`[resolve-markets] Could not parse city code from event ticker: ${eventTicker}`)
      continue
    }

    const winningBracket = `${winner.floor_strike}–${winner.cap_strike}°F`
    const marketOutcomes = Object.fromEntries(
      eventMarkets
        .filter((m) => m.result === 'yes' || m.result === 'no')
        .map((m) => [m.ticker, m.result === 'yes'])
    )

    results.push({
      eventTicker,
      actualTemp,
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
    const unresolvedSignals = await getUnresolvedSignals()
    const unresolvedMarketIds = new Set(unresolvedSignals.map(s => s.marketId))

    // 4. Resolve signals for each settled event
    let totalResolved = 0
    let biasObservations = 0
    const details: ResolveResponse['details'] = []

    for (const event of settledEvents) {
      let eventResolved = 0

      for (const marketTicker of event.marketTickers) {
        // Only attempt resolution if we have unresolved signals for this market
        if (!unresolvedMarketIds.has(marketTicker)) continue

        const outcome = event.marketOutcomes[marketTicker]
        if (typeof outcome !== 'boolean') continue
        const { resolved, biasRecorded } = await resolveWithTemperature(
          marketTicker,
          outcome,
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

    // 5. Write source accuracy from server-side snapshots (Kalshi bracket midpoint)
    // Kalshi midpoint is the ground truth — METAR 6-hour maxT was unreliable
    // (partial-day window, no high/low distinction, produced corrupted training data)
    let serverSnapshotAccuracy = 0
    for (const event of settledEvents) {
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

    // 6. Resolve tail sell signals
    // Each settled event has marketOutcomes mapping ticker → boolean (true = bracket won).
    // Tail sell signals are resolved separately from the main pipeline.
    let tailSellResolved = 0
    for (const event of settledEvents) {
      const resolved = await resolveTailSellSignals(
        event.marketOutcomes,
        event.actualTemp,
      )
      tailSellResolved += resolved
    }

    console.log(`[resolve-markets] ${totalResolved} signals resolved, ${biasObservations} bias observations, ${serverSnapshotAccuracy} server snapshot accuracy, ${tailSellResolved} tail sells resolved, ${details.length} events`)

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
