// Tail Sell Signal tracking — logging, dedup, position limits, circuit breaker, resolution.
// Separate collection from the main signals pipeline for clean auditing.

import { getDb } from '@/lib/db/mongodb'
import type { TailSellSignal } from '@/lib/computeOpportunities'
import { getWarmTailMode } from '@/lib/computeOpportunities'
import { DEFAULT_FEE_RATE } from './weatherProbability'

// ============================================================================
// Constants
// ============================================================================

/** NE corridor cities — weather-correlated, limited to 5 simultaneous positions */
const NE_CORRIDOR_CITIES = new Set(['BOS', 'NY', 'NYC', 'PHI', 'PHIL', 'DC'])

/** Position limits */
const MAX_PER_CITY = 3
const MAX_PER_CITY_TYPE = 2   // Sub-cap per (city, temperatureType): warm and cold each capped at 2,
                              // preventing low-temp from consuming all 3 city slots when both regimes
                              // generate signals on the same day. Total per-city remains ≤ 3.
const MAX_NE_CORRIDOR = 5
const MAX_TOTAL = 8           // live budget: ~$155 max exposure at $20 sizing — fits ~$200 Kalshi capital with $46 buffer
const MAX_TOTAL_PAPER = 30    // paper budget: higher than live to ensure continuous shadow capture
                              // across resolution-overlap windows. Paper has no capital exposure;
                              // the cap is purely a sanity bound. MAX_PER_CITY / MAX_PER_CITY_TYPE
                              // / MAX_NE_CORRIDOR still apply equally to paper.

/** Daily loss circuit breaker (at $20 position size) */
const DAILY_LOSS_LIMIT = 80  // $80 (~4 simultaneous losses; well past historical worst of 1/day)

/** Default position size per signal — high-temp cold-tail (current live) */
const POSITION_SIZE = 20  // $20

/** Position size for warm-tail (low-temp). Conservative start per Phase B design;
 *  raise to parity with POSITION_SIZE only after warm-tail proves out via shadow + limited rollout. */
const POSITION_SIZE_LOW = 5  // $5

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
  /** Semantic of actualF:
   *  'exact' = inner-winner-bracket midpoint, the true observed temp proxy.
   *  'le'    = upper bound (cold-tail loss; actual was at or below actualF).
   *  'ge'    = lower bound (warm-tail loss; actual was at or above actualF).
   *  null/undefined = unresolved or legacy record pre-fix.
   * UI uses this to render ≤/≥ prefix; downstream consumers should NOT treat
   * 'le'/'ge' values as exact temperatures (use only 'exact' for bias work). */
  actualFKind?: 'exact' | 'le' | 'ge' | null
  bracketFloorF: number | null       // null for threshold brackets (open-ended below)
  bracketCapF: number
  bracketDistance: number
  /** 'cold' = bracket below forecast (high-temp tail-sell, original strategy)
   *  'warm' = bracket above forecast (low-temp warm-tail, Deploy 3)
   *  Records written before Deploy 3 are 'cold' implicitly; new schema after
   *  deploy explicitly tags both. Reads should still tolerate undefined. */
  direction: 'cold' | 'warm'
  yesPrice: number
  noSellPrice: number
  expectedProfit: number
  leadHours: number
  spreadF: number
  confidence: 'high' | 'medium'
  sourceCount: number
  /** 'high' for cold-tail, 'low' for warm-tail. */
  temperatureType: 'high' | 'low'
  /** Execution mode:
   *  'live'  = real Kalshi order placed (or to be placed) by execute-tail-sells.ts.
   *  'paper' = signal logged + naturally resolved with computed P&L, but
   *            execute-tail-sells.ts skips it. Used for warm-tail shadow
   *            validation pre-go-live.
   *  Optional for backward compat — pre-existing records have no mode field
   *  and are treated as 'live' throughout the pipeline. */
  mode?: 'live' | 'paper'
  /** Per-source bias-corrected forecast °F at signal time. Optional because
   *  records written before this field was added (Apr 2026) will be undefined. */
  perSourceForecastsF?: Record<string, number>
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

export interface BudgetState {
  byCity: Map<string, number>           // cityCode → unresolved count (any type)
  byCityType: Map<string, number>       // `${cityCode}:${temperatureType}` → unresolved count
  neCorridorTotal: number
  total: number
}

export interface PositionState {
  /** Live (real-money) positions — used for cap enforcement on cold-tail
   *  and warm-tail-live, AND for the circuit-breaker reading. */
  live: BudgetState
  /** Paper (shadow) positions — used for cap enforcement on warm-tail-paper.
   *  Counted separately so paper signals do NOT displace live ones. */
  paper: BudgetState
  /** Daily loss + circuit breaker — LIVE-ONLY. Paper P&L doesn't trip the
   *  real-money circuit breaker; paper trades have no real exposure. */
  dailyLoss: number
  circuitBreakerTripped: boolean
}

function emptyBudget(): BudgetState {
  return {
    byCity: new Map(),
    byCityType: new Map(),
    neCorridorTotal: 0,
    total: 0,
  }
}

export async function getPositionState(): Promise<PositionState> {
  await ensureIndexes()
  const col = tailSellSignals()

  // Count unresolved positions split by mode + (city, type) in one aggregation.
  // Records pre-Deploy 3 don't have temperatureType — treat as 'high'.
  // Records without a mode field (cold-tail and pre-paper-mode warm-tail) are
  // treated as 'live'.
  const unresolvedCursor = col.aggregate<{
    _id: { mode: string; cityCode: string; type: string }
    count: number
  }>([
    { $match: { result: 'pending' } },
    {
      $group: {
        _id: {
          mode: { $ifNull: ['$mode', 'live'] },
          cityCode: '$cityCode',
          type: { $ifNull: ['$temperatureType', 'high'] },
        },
        count: { $sum: 1 },
      },
    },
  ])
  const unresolvedRows = await unresolvedCursor.toArray()

  const live = emptyBudget()
  const paper = emptyBudget()
  for (const row of unresolvedRows) {
    const { mode, cityCode, type } = row._id
    const target = mode === 'paper' ? paper : live
    target.byCity.set(cityCode, (target.byCity.get(cityCode) ?? 0) + row.count)
    target.byCityType.set(`${cityCode}:${type}`, row.count)
    target.total += row.count
    if (NE_CORRIDOR_CITIES.has(cityCode)) {
      target.neCorridorTotal += row.count
    }
  }

  // Daily loss: LIVE only. Circuit breaker protects real capital.
  const todayStart = new Date()
  todayStart.setUTCHours(0, 0, 0, 0)
  const lossResult = await col.aggregate<{ totalLoss: number }>([
    {
      $match: {
        result: 'loss',
        resolvedAt: { $gte: todayStart.getTime() },
        mode: { $ne: 'paper' },   // exclude paper losses from circuit breaker
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

  return { live, paper, dailyLoss, circuitBreakerTripped }
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

  // Circuit breaker affects LIVE signals only (paper has no real exposure;
  // suppressing it would defeat the purpose of capturing what would have
  // happened). Each signal's eligibility is checked individually below.
  if (state.circuitBreakerTripped) {
    console.log(`[tail-sell] circuit breaker tripped — daily loss $${state.dailyLoss.toFixed(2)} ≥ $${DAILY_LOSS_LIMIT}; live signals suppressed (paper still flowing)`)
  }

  // 2. Batch-check which tickers already have unresolved signals (dedup
  //    across both modes — one ticker = one record regardless of mode).
  const tickers = signals.map(s => s.ticker)
  const existing = await tailSellSignals()
    .find({ ticker: { $in: tickers }, result: 'pending' })
    .project({ ticker: 1 })
    .toArray()
  const existingTickers = new Set(existing.map(d => d.ticker))

  // 3. Log signals respecting limits — separate budgets for live vs paper.
  //    Cold-tail is always live. Warm-tail mode comes from env (off skips
  //    the function entirely upstream; paper or live tags the record).
  let logged = 0
  const liveCity = new Map(state.live.byCity)
  const liveCityType = new Map(state.live.byCityType)
  const paperCity = new Map(state.paper.byCity)
  const paperCityType = new Map(state.paper.byCityType)
  let liveNe = state.live.neCorridorTotal
  let paperNe = state.paper.neCorridorTotal
  let liveTotal = state.live.total
  let paperTotal = state.paper.total

  for (const signal of signals) {
    // Dedup: skip if already have unresolved signal for this bracket
    if (existingTickers.has(signal.ticker)) continue

    // Determine mode for this signal. Cold-tail is always live; warm-tail
    // inherits LOW_TEMP_WARM_TAIL_MODE (the generator only runs when 'paper'
    // or 'live' so getWarmTailMode() should return non-null here, but we
    // default to 'paper' as a safety fallback).
    const mode: 'live' | 'paper' =
      signal.temperatureType === 'low'
        ? (getWarmTailMode() ?? 'paper')
        : 'live'

    // Live circuit breaker: skip live signals when tripped, paper continues.
    if (mode === 'live' && state.circuitBreakerTripped) continue

    // Use the budget matching this signal's mode for cap enforcement.
    const cityCount = mode === 'paper' ? paperCity : liveCity
    const cityTypeCount = mode === 'paper' ? paperCityType : liveCityType
    const neCountRef = { value: mode === 'paper' ? paperNe : liveNe }
    const totalCountRef = { value: mode === 'paper' ? paperTotal : liveTotal }

    // Total limit (per budget — paper has a higher cap because it has no
    // real exposure; allows continuous shadow capture across resolution
    // overlap windows.)
    const totalCap = mode === 'paper' ? MAX_TOTAL_PAPER : MAX_TOTAL
    if (totalCountRef.value >= totalCap) continue

    // Per-city limit (any type, per budget)
    const currentCityCount = cityCount.get(signal.cityCode) || 0
    if (currentCityCount >= MAX_PER_CITY) continue

    // Per-(city, type) sub-cap — prevents low-temp from consuming all city slots
    const cityTypeKey = `${signal.cityCode}:${signal.temperatureType}`
    const currentCityTypeCount = cityTypeCount.get(cityTypeKey) || 0
    if (currentCityTypeCount >= MAX_PER_CITY_TYPE) continue

    // NE corridor limit (per budget)
    if (NE_CORRIDOR_CITIES.has(signal.cityCode) && neCountRef.value >= MAX_NE_CORRIDOR) continue

    const id = `ts_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const positionSize = signal.temperatureType === 'low' ? POSITION_SIZE_LOW : POSITION_SIZE
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
      direction: signal.direction,
      yesPrice: signal.yesPrice,
      noSellPrice: signal.noSellPrice,
      expectedProfit: signal.expectedProfit,
      leadHours: signal.leadHours,
      spreadF: signal.spreadF,
      confidence: signal.confidence,
      sourceCount: signal.sourceCount,
      temperatureType: signal.temperatureType,
      mode,
      perSourceForecastsF: signal.perSourceForecastsF,
      result: 'pending',
      pnl: null,
      positionSize,
      timestamp: signal.timestamp,
      resolvedAt: null,
      expiresAt: new Date(signal.timestamp + 400 * 24 * 60 * 60 * 1000),
    }

    try {
      await tailSellSignals().insertOne(record as any)
      logged++
      cityCount.set(signal.cityCode, currentCityCount + 1)
      cityTypeCount.set(cityTypeKey, currentCityTypeCount + 1)
      if (mode === 'paper') {
        paperTotal++
        if (NE_CORRIDOR_CITIES.has(signal.cityCode)) paperNe++
      } else {
        liveTotal++
        if (NE_CORRIDOR_CITIES.has(signal.cityCode)) liveNe++
      }
      // Add to existing set to prevent within-batch duplicates
      existingTickers.add(signal.ticker)
    } catch (err: any) {
      // Duplicate key = race condition dedup, expected and safe
      if (err?.code === 11000) continue
      console.warn(`[tail-sell] failed to log signal for ${signal.ticker}:`, err)
    }
  }

  if (logged > 0) {
    console.log(
      `[tail-sell] logged ${logged} signal(s) ` +
      `(live total: ${liveTotal}/${MAX_TOTAL}, paper total: ${paperTotal}/${MAX_TOTAL_PAPER}, ` +
      `live NE: ${liveNe}/${MAX_NE_CORRIDOR}, paper NE: ${paperNe}/${MAX_NE_CORRIDOR})`
    )
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
  actualTemp: number | null,
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

    // Compute PnL when the signal was actually executed on Kalshi (live)
    // OR when it's a paper signal (no Kalshi order, but we want the
    // would-have P&L for shadow validation).
    const isPaper = record.mode === 'paper'
    const wasTraded = isPaper
      || ((record as any).kalshiOrderId
          && (record as any).kalshiOrderId !== 'skipped_market_closed')
    const pnl = wasTraded
      ? (bracketHit
          ? -(1 - record.yesPrice)                       // loss: owe $1, collected yesPrice
          : record.yesPrice * (1 - DEFAULT_FEE_RATE))    // win: keep yesPrice minus fees
      : 0                                                 // skipped market or other no-trade — no P&L

    // Resolve actualF + qualifier kind. resolve-markets.ts deliberately passes
    // actualTemp=null for threshold-bracket winners (the boundary value isn't
    // a true observation — used by source_accuracy/temp_bias and would poison
    // them). For tail-sell LOSSES specifically, the bet resolved against the
    // bracket the signal targeted, so we can derive a one-sided bound from
    // the signal's own bracket fields. Wins with null actualTemp remain null
    // for now (would require winning-bracket plumbing from resolve-markets).
    let resolvedActualF: number | null = actualTemp
    let resolvedActualFKind: 'exact' | 'le' | 'ge' | null =
      actualTemp != null ? 'exact' : null
    if (actualTemp == null && result === 'loss') {
      if (record.direction === 'cold' && record.bracketCapF != null) {
        resolvedActualF = record.bracketCapF
        resolvedActualFKind = 'le'
      } else if (record.direction === 'warm' && record.bracketFloorF != null) {
        resolvedActualF = record.bracketFloorF
        resolvedActualFKind = 'ge'
      }
    }

    await col.updateOne(
      { id: record.id },
      {
        $set: {
          result,
          pnl,
          actualF: resolvedActualF,
          actualFKind: resolvedActualFKind,
          resolvedAt: Date.now(),
        },
      },
    )
    resolved++

    if (result === 'loss') {
      const actualStr =
        resolvedActualFKind === 'exact' ? `${resolvedActualF!.toFixed(1)}°F`
        : resolvedActualFKind === 'le'  ? `≤${resolvedActualF!.toFixed(0)}°F`
        : resolvedActualFKind === 'ge'  ? `≥${resolvedActualF!.toFixed(0)}°F`
        : 'unknown'
      console.warn(
        `[tail-sell] LOSS: ${record.ticker} ${record.cityCode} ±${record.bracketDistance} — ` +
        `forecast=${record.forecastF.toFixed(1)}°F actual=${actualStr} ` +
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

export async function getTailSellSummary(since?: number): Promise<{
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

  const query = since ? { timestamp: { $gte: since } } : {}
  const all = await col.find(query).toArray()
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
