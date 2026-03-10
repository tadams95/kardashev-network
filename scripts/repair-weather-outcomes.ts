import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config()

import { closeClient, getDb } from '../src/lib/db/mongodb'
import { CITY_COORDS } from '../src/lib/utils/cityCoordinates'
import { generateReliabilityDiagram } from '../src/lib/models/calibration'

const APPLY = process.argv.includes('--apply')
const DRY_RUN = !APPLY
const FETCH_TIMEOUT = 30_000
const REQUEST_DELAY_MS = 150
const MAX_RETRY_ROUNDS = 3
const BACKOFF_DELAYS = [2_000, 5_000, 10_000]
const WEATHER_SERIES_PREFIXES = ['KXHIGH', 'KXHIGHT', 'KXLOW']
const QUERY_CHUNK_SIZE = 500
const BULK_CHUNK_SIZE = 500

interface KalshiMarketRaw {
  ticker: string
  status: string
  result?: string
  close_time: string
  strike_type: string
  floor_strike?: number | null
  cap_strike?: number | null
  event_ticker?: string
}

interface SettledEvent {
  eventTicker: string
  actualTemp: number
  winningTicker: string
  marketOutcomes: Record<string, boolean>
}

interface OutcomeResolution {
  marketId: string
  eventTicker: string
  actualTemp: number
  outcome: boolean
  winningTicker: string
}

interface MarketPredictionDoc {
  _id: unknown
  id?: string
  marketId: string
  correctedProbability?: number
  resolvedOutcome?: 0 | 1
  resolvedAt?: number
  timestamp?: number
}

interface SignalDoc {
  _id: unknown
  id?: string
  marketId: string
  outcome?: boolean
  resolvedAt?: number
  actualTemp?: number
  timestamp?: number
}

interface ReliabilityPoint {
  predicted: number
  actual: number
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchWithTimeout(url: string, timeoutMs = FETCH_TIMEOUT): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function fetchSettledMarkets(): Promise<KalshiMarketRaw[]> {
  const allMarkets: KalshiMarketRaw[] = []
  const cityCodes = Object.keys(CITY_COORDS)
  const retryQueue: Array<{ prefix: string; cityCode: string }> = []

  for (const prefix of WEATHER_SERIES_PREFIXES) {
    for (const cityCode of cityCodes) {
      const seriesTicker = `${prefix}${cityCode}`
      const url = new URL('https://api.elections.kalshi.com/trade-api/v2/markets')
      url.searchParams.set('series_ticker', seriesTicker)
      url.searchParams.set('status', 'settled')
      url.searchParams.set('limit', '200')

      try {
        const response = await fetchWithTimeout(url.toString())
        if (!response.ok) {
          if (response.status === 429) retryQueue.push({ prefix, cityCode })
          else console.warn(`[repair-weather-outcomes] ${seriesTicker}: HTTP ${response.status}`)
        } else {
          const data = await response.json()
          const markets: KalshiMarketRaw[] = data.markets || []
          allMarkets.push(...markets)
        }
      } catch (err) {
        console.warn(`[repair-weather-outcomes] ${seriesTicker}: ${err instanceof Error ? err.message : 'fetch failed'}`)
      }

      await delay(REQUEST_DELAY_MS)
    }
  }

  let pending = retryQueue
  for (let round = 0; round < MAX_RETRY_ROUNDS && pending.length > 0; round++) {
    await delay(BACKOFF_DELAYS[round])
    const nextRetry: typeof pending = []

    for (const { prefix, cityCode } of pending) {
      const seriesTicker = `${prefix}${cityCode}`
      const url = new URL('https://api.elections.kalshi.com/trade-api/v2/markets')
      url.searchParams.set('series_ticker', seriesTicker)
      url.searchParams.set('status', 'settled')
      url.searchParams.set('limit', '200')

      try {
        const response = await fetchWithTimeout(url.toString())
        if (response.status === 429) {
          nextRetry.push({ prefix, cityCode })
        } else if (!response.ok) {
          console.warn(`[repair-weather-outcomes] ${seriesTicker}: HTTP ${response.status} on retry`)
        } else {
          const data = await response.json()
          const markets: KalshiMarketRaw[] = data.markets || []
          allMarkets.push(...markets)
        }
      } catch (err) {
        console.warn(`[repair-weather-outcomes] ${seriesTicker}: ${err instanceof Error ? err.message : 'fetch failed'} on retry`)
      }

      await delay(REQUEST_DELAY_MS)
    }

    pending = nextRetry
  }

  if (pending.length > 0) {
    console.warn(`[repair-weather-outcomes] ${pending.length} series remained rate-limited after retries`)
  }

  return allMarkets
}

function buildSettledEvents(markets: KalshiMarketRaw[]): SettledEvent[] {
  const events = new Map<string, KalshiMarketRaw[]>()
  for (const market of markets) {
    if (!market.event_ticker) continue
    const group = events.get(market.event_ticker) || []
    group.push(market)
    events.set(market.event_ticker, group)
  }

  const settledEvents: SettledEvent[] = []
  for (const [eventTicker, eventMarkets] of events) {
    const winner = eventMarkets.find(
      (market) => market.result === 'yes' && market.floor_strike != null && market.cap_strike != null
    )
    if (!winner) continue

    const marketOutcomes = Object.fromEntries(
      eventMarkets
        .filter((market) => market.result === 'yes' || market.result === 'no')
        .map((market) => [market.ticker, market.result === 'yes'])
    )

    settledEvents.push({
      eventTicker,
      actualTemp: (winner.floor_strike! + winner.cap_strike!) / 2,
      winningTicker: winner.ticker,
      marketOutcomes,
    })
  }

  return settledEvents
}

function buildResolutionMap(events: SettledEvent[]): Map<string, OutcomeResolution> {
  const resolutions = new Map<string, OutcomeResolution>()
  for (const event of events) {
    for (const [marketId, outcome] of Object.entries(event.marketOutcomes)) {
      resolutions.set(marketId, {
        marketId,
        eventTicker: event.eventTicker,
        actualTemp: event.actualTemp,
        outcome,
        winningTicker: event.winningTicker,
      })
    }
  }
  return resolutions
}

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size))
  }
  return result
}

function brierScore(points: ReliabilityPoint[]): number {
  if (points.length === 0) return 0
  return points.reduce((sum, point) => sum + (point.predicted - point.actual) ** 2, 0) / points.length
}

function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

function printReliabilitySummary(label: string, points: ReliabilityPoint[]): void {
  const baseRate = points.length > 0
    ? points.reduce((sum, point) => sum + point.actual, 0) / points.length
    : 0
  console.log(`[repair-weather-outcomes] ${label}: sample=${points.length}, yesRate=${formatPct(baseRate)}, brier=${brierScore(points).toFixed(4)}`)

  const bins = generateReliabilityDiagram(points, 5)
  for (const bin of bins) {
    const low = Math.round((bin.binCenter - 0.1) * 100)
    const high = Math.round((bin.binCenter + 0.1) * 100)
    console.log(
      `  ${String(low).padStart(2, ' ')}-${String(high).padStart(3, ' ')}%: count=${String(bin.count).padStart(5, ' ')}, predicted=${formatPct(bin.avgPredicted)}, actual=${formatPct(bin.avgActual)}`
    )
  }
}

async function main(): Promise<void> {
  console.log(`[repair-weather-outcomes] ${DRY_RUN ? 'DRY RUN' : 'APPLY'} mode`)

  const settledMarkets = await fetchSettledMarkets()
  console.log(`[repair-weather-outcomes] fetched ${settledMarkets.length} settled Kalshi markets`)

  const settledEvents = buildSettledEvents(settledMarkets)
  const resolutionMap = buildResolutionMap(settledEvents)
  const marketIds = Array.from(resolutionMap.keys())

  console.log(`[repair-weather-outcomes] built ${settledEvents.length} settled events and ${marketIds.length} market outcomes`)
  if (marketIds.length === 0) {
    console.log('[repair-weather-outcomes] no repairable outcomes found')
    return
  }

  const db = getDb()
  const marketPredictions = db.collection<MarketPredictionDoc>('market_predictions')
  const signals = db.collection<SignalDoc>('signals')

  const storedPoints: ReliabilityPoint[] = []
  const correctedPoints: ReliabilityPoint[] = []
  const predictionOps: Array<{ updateOne: { filter: { _id: unknown }; update: Record<string, unknown> } }> = []
  const signalOps: Array<{ updateOne: { filter: { _id: unknown }; update: Record<string, unknown> } }> = []
  const mismatches: Array<{ kind: string; marketId: string; stored: string; corrected: string; probability?: number }> = []

  let predictionsScanned = 0
  let predictionsMatched = 0
  let predictionsMismatched = 0
  let predictionsMissingResolved = 0

  let signalsScanned = 0
  let signalsMatched = 0
  let signalsMismatched = 0
  let signalsMissingResolved = 0

  const now = Date.now()

  for (const marketIdChunk of chunk(marketIds, QUERY_CHUNK_SIZE)) {
    const predictionDocs = await marketPredictions
      .find({ marketId: { $in: marketIdChunk } })
      .project({ marketId: 1, correctedProbability: 1, resolvedOutcome: 1, resolvedAt: 1, timestamp: 1, id: 1 })
      .toArray()

    for (const doc of predictionDocs) {
      predictionsScanned++
      const resolution = resolutionMap.get(doc.marketId)
      if (!resolution) continue
      predictionsMatched++

      const correctedOutcome = resolution.outcome ? 1 : 0
      if (typeof doc.correctedProbability === 'number' && doc.correctedProbability >= 0 && doc.correctedProbability <= 1) {
        correctedPoints.push({ predicted: doc.correctedProbability, actual: correctedOutcome })
        if (doc.resolvedOutcome === 0 || doc.resolvedOutcome === 1) {
          storedPoints.push({ predicted: doc.correctedProbability, actual: doc.resolvedOutcome })
        }
      }

      if (doc.resolvedOutcome !== 0 && doc.resolvedOutcome !== 1) {
        predictionsMissingResolved++
      } else if (doc.resolvedOutcome !== correctedOutcome) {
        predictionsMismatched++
      }

      if (doc.resolvedOutcome !== correctedOutcome || (doc.resolvedOutcome !== 0 && doc.resolvedOutcome !== 1)) {
        if (mismatches.length < 20) {
          mismatches.push({
            kind: 'market_predictions',
            marketId: doc.marketId,
            stored: doc.resolvedOutcome == null ? 'missing' : String(doc.resolvedOutcome),
            corrected: String(correctedOutcome),
            probability: doc.correctedProbability,
          })
        }

        if (APPLY) {
          predictionOps.push({
            updateOne: {
              filter: { _id: doc._id },
              update: {
                $set: {
                  resolvedOutcome: correctedOutcome,
                  ...(doc.resolvedAt == null ? { resolvedAt: now } : {}),
                },
              },
            },
          })
        }
      }
    }

    const signalDocs = await signals
      .find({ marketId: { $in: marketIdChunk } })
      .project({ marketId: 1, outcome: 1, actualTemp: 1, resolvedAt: 1, timestamp: 1, id: 1 })
      .toArray()

    for (const doc of signalDocs) {
      signalsScanned++
      const resolution = resolutionMap.get(doc.marketId)
      if (!resolution) continue
      signalsMatched++

      const needsOutcomeRepair = typeof doc.outcome !== 'boolean' || doc.outcome !== resolution.outcome
      const needsTempRepair = typeof doc.actualTemp !== 'number' || Math.abs(doc.actualTemp - resolution.actualTemp) > 0.001

      if (typeof doc.outcome !== 'boolean') {
        signalsMissingResolved++
      } else if (doc.outcome !== resolution.outcome) {
        signalsMismatched++
      }

      if ((needsOutcomeRepair || needsTempRepair) && mismatches.length < 20) {
        mismatches.push({
          kind: 'signals',
          marketId: doc.marketId,
          stored: doc.outcome == null ? 'missing' : String(doc.outcome),
          corrected: String(resolution.outcome),
        })
      }

      if ((needsOutcomeRepair || needsTempRepair) && APPLY) {
        signalOps.push({
          updateOne: {
            filter: { _id: doc._id },
            update: {
              $set: {
                outcome: resolution.outcome,
                actualTemp: resolution.actualTemp,
                ...(doc.resolvedAt == null ? { resolvedAt: now } : {}),
              },
            },
          },
        })
      }
    }
  }

  console.log('[repair-weather-outcomes] market_predictions audit:')
  console.log(`  scanned=${predictionsScanned} matched=${predictionsMatched} mismatched=${predictionsMismatched} missingResolved=${predictionsMissingResolved}`)
  console.log('[repair-weather-outcomes] signals audit:')
  console.log(`  scanned=${signalsScanned} matched=${signalsMatched} mismatched=${signalsMismatched} missingResolved=${signalsMissingResolved}`)

  if (mismatches.length > 0) {
    console.log('[repair-weather-outcomes] sample mismatches:')
    for (const mismatch of mismatches) {
      const probabilitySuffix = typeof mismatch.probability === 'number'
        ? ` prob=${formatPct(mismatch.probability)}`
        : ''
      console.log(`  [${mismatch.kind}] ${mismatch.marketId} stored=${mismatch.stored} corrected=${mismatch.corrected}${probabilitySuffix}`)
    }
  }

  printReliabilitySummary('stored reliability (current DB)', storedPoints)
  printReliabilitySummary('corrected reliability (post-repair)', correctedPoints)

  if (DRY_RUN) {
    console.log('[repair-weather-outcomes] dry run complete - no documents updated')
    return
  }

  let predictionWrites = 0
  for (const ops of chunk(predictionOps, BULK_CHUNK_SIZE)) {
    if (ops.length === 0) continue
    const result = await marketPredictions.bulkWrite(ops, { ordered: false })
    predictionWrites += result.modifiedCount
  }

  let signalWrites = 0
  for (const ops of chunk(signalOps, BULK_CHUNK_SIZE)) {
    if (ops.length === 0) continue
    const result = await signals.bulkWrite(ops, { ordered: false })
    signalWrites += result.modifiedCount
  }

  console.log(`[repair-weather-outcomes] applied ${predictionWrites} market_predictions updates and ${signalWrites} signal updates`)
}

main()
  .then(() => closeClient())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[repair-weather-outcomes] Fatal:', err)
    closeClient().finally(() => process.exit(1))
  })