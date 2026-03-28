// Tail Sell Signal tracking — logging, dedup, position limits, circuit breaker, resolution.
// Separate collection from the main signals pipeline for clean auditing.

import { getDb } from '@/lib/db/mongodb'
import type { TailSellSignal } from '@/lib/computeOpportunities'
import { DEFAULT_FEE_RATE } from './weatherProbability'

// ============================================================================
// Constants
// ============================================================================

/** NE corridor cities — weather-correlated, limited to 5 simultaneous positions */
const NE_CORRIDOR_CITIES = new Set(['BOS', 'NY', 'NYC', 'PHI', 'PHIL', 'DC'])

/** Position limits */
const MAX_PER_CITY = 3
const MAX_NE_CORRIDOR = 5
const MAX_TOTAL = 30

/** Daily loss circuit breaker (at $10 position size) */
const DAILY_LOSS_LIMIT = 50  // $50

/** Default position size per signal */
const POSITION_SIZE = 10  // $10

// ============================================================================
// Types
// ============================================================================

export interface TailSellRecord {
  id: string
  signalType: 'TAIL_SELL_NO'
  ticker: string                    // Kalshi market ticker
  eventTicker: string
  cityCode: string
  forecastF: number
  actualF: number | null            // filled on resolution
  bracketFloorF: number
  bracketCapF: number
  bracketDistance: number
  direction: 'cold'
  yesPrice: number
  noSellPrice: number
  expectedProfit: number
  leadHours: number
  spreadF: number
  confidence: 'high' | 'medium'
  sourceCount: number
  temperatureType: 'high'
  result: 'pending' | 'win' | 'loss' | null
  pnl: number | null               // filled on resolution
  positionSize: number
  timestamp: number
  resolvedAt: number | null
  expiresAt: Date                   // TTL: 400 days
}

// ============================================================================
// Collection & Indexes
// ============================================================================

function tailSellSignals() {
  return getDb().collection<TailSellRecord>('tail_sell_signals')
}

let _indexesCreated = false
async function ensureIndexes(): Promise<void> {
  if (_indexesCreated) return
  _indexesCreated = true
  try {
    const col = tailSellSignals()
    await col.createIndex({ id: 1 }, { unique: true })
    await col.createIndex({ ticker: 1, result: 1 })         // dedup query
    await col.createIndex({ cityCode: 1, result: 1 })       // position limit query
    await col.createIndex({ result: 1, timestamp: -1 })     // resolution query
    await col.createIndex({ timestamp: -1 })                 // audit queries
    await col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }) // TTL
  } catch {
    _indexesCreated = false
  }
}

// ============================================================================
// Position State (queried once per computation cycle, not per bracket)
// ============================================================================

export interface PositionState {
  byCity: Map<string, number>    // cityCode → unresolved count
  neCorridorTotal: number
  total: number
  dailyLoss: number              // total loss $ today (UTC)
  circuitBreakerTripped: boolean
}

export async function getPositionState(): Promise<PositionState> {
  await ensureIndexes()
  const col = tailSellSignals()

  // Count unresolved positions by city
  const unresolvedCursor = col.aggregate<{ _id: string; count: number }>([
    { $match: { result: 'pending' } },
    { $group: { _id: '$cityCode', count: { $sum: 1 } } },
  ])
  const unresolvedByCity = await unresolvedCursor.toArray()

  const byCity = new Map<string, number>()
  let neCorridorTotal = 0
  let total = 0
  for (const row of unresolvedByCity) {
    byCity.set(row._id, row.count)
    total += row.count
    if (NE_CORRIDOR_CITIES.has(row._id)) {
      neCorridorTotal += row.count
    }
  }

  // Daily loss: sum of negative PnL today (UTC)
  const todayStart = new Date()
  todayStart.setUTCHours(0, 0, 0, 0)
  const lossResult = await col.aggregate<{ totalLoss: number }>([
    {
      $match: {
        result: 'loss',
        resolvedAt: { $gte: todayStart.getTime() },
      },
    },
    {
      $group: {
        _id: null,
        totalLoss: { $sum: { $multiply: ['$pnl', '$positionSize'] } },
      },
    },
  ]).toArray()

  // pnl is negative for losses, so totalLoss will be negative
  const dailyLoss = lossResult.length > 0 ? Math.abs(lossResult[0].totalLoss) : 0
  const circuitBreakerTripped = dailyLoss >= DAILY_LOSS_LIMIT

  return { byCity, neCorridorTotal, total, dailyLoss, circuitBreakerTripped }
}

// ============================================================================
// Signal Logging (with dedup + position limits)
// ============================================================================

/**
 * Log tail sell signals, enforcing:
 * - Dedup: one signal per market ticker (no duplicates for same bracket)
 * - Position limits: max per city, NE corridor, total
 * - Circuit breaker: suppress if daily loss exceeds limit
 *
 * Returns the number of signals actually logged.
 */
export async function logTailSellSignals(
  signals: TailSellSignal[],
): Promise<number> {
  if (signals.length === 0) return 0
  await ensureIndexes()

  // 1. Get current position state (one query, not per-signal)
  const state = await getPositionState()

  if (state.circuitBreakerTripped) {
    console.log(`[tail-sell] circuit breaker tripped — daily loss $${state.dailyLoss.toFixed(2)} ≥ $${DAILY_LOSS_LIMIT}`)
    return 0
  }

  if (state.total >= MAX_TOTAL) {
    console.log(`[tail-sell] at max total positions (${state.total}/${MAX_TOTAL})`)
    return 0
  }

  // 2. Batch-check which tickers already have unresolved signals (dedup)
  const tickers = signals.map(s => s.ticker)
  const existing = await tailSellSignals()
    .find({ ticker: { $in: tickers }, result: 'pending' })
    .project({ ticker: 1 })
    .toArray()
  const existingTickers = new Set(existing.map(d => d.ticker))

  // 3. Log signals respecting limits
  let logged = 0
  // Track mutable position counts
  const cityCount = new Map(state.byCity)
  let neCount = state.neCorridorTotal
  let totalCount = state.total

  for (const signal of signals) {
    // Dedup: skip if already have unresolved signal for this bracket
    if (existingTickers.has(signal.ticker)) continue

    // Total limit
    if (totalCount >= MAX_TOTAL) break

    // Per-city limit
    const currentCityCount = cityCount.get(signal.cityCode) || 0
    if (currentCityCount >= MAX_PER_CITY) continue

    // NE corridor limit
    if (NE_CORRIDOR_CITIES.has(signal.cityCode) && neCount >= MAX_NE_CORRIDOR) continue

    const id = `ts_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const record: TailSellRecord = {
      id,
      signalType: 'TAIL_SELL_NO',
      ticker: signal.ticker,
      eventTicker: signal.eventTicker,
      cityCode: signal.cityCode,
      forecastF: signal.forecastF,
      actualF: null,
      bracketFloorF: signal.bracketFloorF,
      bracketCapF: signal.bracketCapF,
      bracketDistance: signal.bracketDistance,
      direction: 'cold',
      yesPrice: signal.yesPrice,
      noSellPrice: signal.noSellPrice,
      expectedProfit: signal.expectedProfit,
      leadHours: signal.leadHours,
      spreadF: signal.spreadF,
      confidence: signal.confidence,
      sourceCount: signal.sourceCount,
      temperatureType: 'high',
      result: 'pending',
      pnl: null,
      positionSize: POSITION_SIZE,
      timestamp: signal.timestamp,
      resolvedAt: null,
      expiresAt: new Date(signal.timestamp + 400 * 24 * 60 * 60 * 1000),
    }

    try {
      await tailSellSignals().insertOne(record as any)
      logged++
      totalCount++
      cityCount.set(signal.cityCode, currentCityCount + 1)
      if (NE_CORRIDOR_CITIES.has(signal.cityCode)) neCount++
      // Add to existing set to prevent within-batch duplicates
      existingTickers.add(signal.ticker)
    } catch (err: any) {
      // Duplicate key = race condition dedup, expected and safe
      if (err?.code === 11000) continue
      console.warn(`[tail-sell] failed to log signal for ${signal.ticker}:`, err)
    }
  }

  if (logged > 0) {
    console.log(`[tail-sell] logged ${logged} signal(s) (total open: ${totalCount}, NE: ${neCount})`)
  }

  return logged
}

// ============================================================================
// Resolution
// ============================================================================

/**
 * Resolve tail sell signals for a settled event.
 * Called from resolve-markets alongside existing signal resolution.
 *
 * @param marketOutcomes - map of ticker → boolean (true = bracket was the winner)
 * @param actualTemp - winning bracket midpoint °F
 * @returns number of tail sell signals resolved
 */
export async function resolveTailSellSignals(
  marketOutcomes: Record<string, boolean>,
  actualTemp: number,
): Promise<number> {
  await ensureIndexes()
  const col = tailSellSignals()

  const tickers = Object.keys(marketOutcomes)
  if (tickers.length === 0) return 0

  // Find unresolved tail sell signals matching these market tickers
  const pending = await col
    .find({ ticker: { $in: tickers }, result: 'pending' })
    .toArray()

  if (pending.length === 0) return 0

  let resolved = 0
  for (const record of pending) {
    const bracketHit = marketOutcomes[record.ticker] === true

    // Win = bracket didn't hit (we sold YES, it resolved to $0)
    // Loss = bracket hit (we sold YES, it resolved to $1)
    const result: 'win' | 'loss' = bracketHit ? 'loss' : 'win'
    const pnl = bracketHit
      ? -(1 - record.yesPrice)                           // loss: owe $1, collected yesPrice
      : record.yesPrice * (1 - DEFAULT_FEE_RATE)         // win: keep yesPrice minus fees

    await col.updateOne(
      { id: record.id },
      {
        $set: {
          result,
          pnl,
          actualF: actualTemp,
          resolvedAt: Date.now(),
        },
      },
    )
    resolved++

    if (result === 'loss') {
      console.warn(
        `[tail-sell] LOSS: ${record.ticker} ${record.cityCode} ±${record.bracketDistance} — ` +
        `forecast=${record.forecastF.toFixed(1)}°F actual=${actualTemp.toFixed(1)}°F ` +
        `pnl=$${(pnl * record.positionSize).toFixed(2)}`
      )
    }
  }

  if (resolved > 0) {
    const wins = pending.filter(r => marketOutcomes[r.ticker] !== true).length
    const losses = resolved - wins
    console.log(`[tail-sell] resolved ${resolved} signal(s): ${wins}W ${losses}L`)
  }

  return resolved
}

// ============================================================================
// Audit Queries
// ============================================================================

export async function getTailSellSummary(): Promise<{
  total: number
  pending: number
  resolved: number
  wins: number
  losses: number
  winRate: number
  totalPnl: number
  avgPnl: number
  byDistance: Array<{ distance: number; count: number; wins: number; losses: number; pnl: number }>
  byCity: Array<{ city: string; count: number; wins: number; losses: number; pnl: number }>
}> {
  await ensureIndexes()
  const col = tailSellSignals()

  const all = await col.find().toArray()
  const pending = all.filter(r => r.result === 'pending')
  const resolved = all.filter(r => r.result === 'win' || r.result === 'loss')
  const wins = resolved.filter(r => r.result === 'win')
  const losses = resolved.filter(r => r.result === 'loss')

  const totalPnl = resolved.reduce((sum, r) => sum + (r.pnl ?? 0) * r.positionSize, 0)
  const avgPnl = resolved.length > 0 ? totalPnl / resolved.length : 0

  // By distance
  const distMap = new Map<number, { count: number; wins: number; losses: number; pnl: number }>()
  for (const r of resolved) {
    const d = r.bracketDistance
    const entry = distMap.get(d) || { count: 0, wins: 0, losses: 0, pnl: 0 }
    entry.count++
    if (r.result === 'win') entry.wins++
    if (r.result === 'loss') entry.losses++
    entry.pnl += (r.pnl ?? 0) * r.positionSize
    distMap.set(d, entry)
  }
  const byDistance = Array.from(distMap.entries())
    .map(([distance, stats]) => ({ distance, ...stats }))
    .sort((a, b) => a.distance - b.distance)

  // By city
  const cityMap = new Map<string, { count: number; wins: number; losses: number; pnl: number }>()
  for (const r of resolved) {
    const entry = cityMap.get(r.cityCode) || { count: 0, wins: 0, losses: 0, pnl: 0 }
    entry.count++
    if (r.result === 'win') entry.wins++
    if (r.result === 'loss') entry.losses++
    entry.pnl += (r.pnl ?? 0) * r.positionSize
    cityMap.set(r.cityCode, entry)
  }
  const byCity = Array.from(cityMap.entries())
    .map(([city, stats]) => ({ city, ...stats }))
    .sort((a, b) => b.pnl - a.pnl)

  return {
    total: all.length,
    pending: pending.length,
    resolved: resolved.length,
    wins: wins.length,
    losses: losses.length,
    winRate: resolved.length > 0 ? wins.length / resolved.length : 0,
    totalPnl,
    avgPnl,
    byDistance,
    byCity,
  }
}
