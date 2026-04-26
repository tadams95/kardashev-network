// Live performance tracking for weather trading signals
// Logs every signal, computes rolling Brier/win-rate, detects model decay
// Auto-widens edge thresholds when performance degrades
// Persists signal history to MongoDB for cross-invocation durability

import { getDb } from '@/lib/db/mongodb'
import { extractCityCode, extractMarketType } from '@/lib/utils/tickerParsing'
import { recordTemperatureObservation } from './temperatureBias'
import { logSourcePredictionSnapshot, writeSourceAccuracyFromResolution } from './sourceAccuracy'
import { generateReliabilityDiagram, toCalibrationLeadBucket } from './calibration'
import type { CalibrationPoint } from './calibration'
import { DEFAULT_FEE_RATE } from './weatherProbability'
import type { BacktestResult } from '@/types/weather'

const RETENTION_NON_TRADE_DAYS = 45
const RETENTION_TRADE_DAYS = 400
const DEFAULT_POLICY_VERSION = process.env.BIAS_POLICY_VERSION || 'v1'

// ============================================================================
// Types
// ============================================================================

export interface SignalRecord {
  id: string
  marketId: string
  timestamp: number
  modelProbability: number
  marketPrice: number
  edge: number
  direction: 'YES' | 'NO'
  signal: string
  // Optional temperature forecast data (for bias tracking)
  cityCode?: string
  forecastTemp?: number   // Model forecast in °F at signal time
  hoursToResolution?: number
  temperatureType?: 'high' | 'low'
  rawModelProbability?: number
  correctedModelProbability?: number
  probabilityDelta?: number
  correctionF?: number
  decisionPolicyVersion?: string
  biasStateId?: string
  calibrationModelId?: string
  biasSnapshot?: {
    meanErrorF: number
    correctionF: number
    isActive: boolean
    sampleCount: number
    effectiveSampleSize: number
  }
  perSourceForecasts?: Record<string, number>  // source → forecast temp °F
  forecastCityName?: string  // City name from forecast data (audit trail for cross-city contamination)
  // Filled in after resolution
  outcome?: boolean
  resolvedAt?: number
  actualTemp?: number     // Resolved actual temperature in °F
}

export interface MarketPredictionRecord {
  id: string
  marketId: string
  eventTicker?: string
  cityCode?: string
  marketType?: 'temperature-high' | 'temperature-low' | 'precipitation'
  timestamp: number
  marketPrice: number
  rawProbability: number
  correctedProbability: number
  correctionF: number
  isTrade: boolean
  tradeSignal?: string
  hoursToResolution?: number
  sources?: string[]
  modelAgreement?: number
  stdDevFloorC?: number
  resolvedOutcome?: 0 | 1
  resolvedAt?: number
  policyVersion?: string
  biasStateId?: string
  calibrationModelId?: string
  probabilityModel?: 'bma' | 'kde'
  expiresAt: Date
}

export interface PerformanceSnapshot {
  windowSize: number
  totalSignals: number
  resolvedSignals: number
  winRate: number
  brierScore: number
  marketBrierScore: number     // Brier score using market price as predictor
  brierSkillScore: number      // 1 - (modelBrier / marketBrier); positive = beats market
  averageEdge: number
  avgReturn: number
  calibrationError: number
  modelDecay: boolean        // True if performance is declining
  recommendedMinEdge: number // Dynamic edge threshold
  timestamp: number
}

export interface PerformanceConfig {
  rollingWindow: number      // Number of recent signals to evaluate (default: 50)
  decayThreshold: number     // Win rate below this triggers decay alert (default: 0.55)
  brierThreshold: number     // Brier score above this triggers decay (default: 0.25)
  baseMinEdge: number        // Normal minimum edge (default: 0.15)
  maxMinEdge: number         // Maximum edge threshold when decaying (default: 0.25)
}

const DEFAULT_PERFORMANCE_CONFIG: PerformanceConfig = {
  rollingWindow: 50,
  decayThreshold: 0.55,
  brierThreshold: 0.25,
  baseMinEdge: 0.15,
  maxMinEdge: 0.25,
}

// ============================================================================
// MongoDB helpers
// ============================================================================

function signals() {
  return getDb().collection<SignalRecord>('signals')
}

function marketPredictions() {
  return getDb().collection<MarketPredictionRecord>('market_predictions')
}

let _indexesCreated = false
async function ensureIndexes(): Promise<void> {
  if (_indexesCreated) return
  _indexesCreated = true
  try {
    const col = signals()
    await col.createIndex({ timestamp: -1 })
    await col.createIndex({ marketId: 1, outcome: 1 })
    await col.createIndex({ id: 1 }, { unique: true })
    await col.createIndex({ marketId: 1, timestamp: -1 })
    await col.createIndex({ cityCode: 1, timestamp: -1 })
    await col.createIndex({ outcome: 1, timestamp: -1 })

    const preds = marketPredictions()
    await preds.createIndex({ cityCode: 1, timestamp: -1 })
    await preds.createIndex({ marketId: 1, timestamp: -1 })
    await preds.createIndex({ isTrade: 1, timestamp: -1 })
    await preds.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
    await preds.createIndex({ id: 1 }, { unique: true })
  } catch {
    _indexesCreated = false
  }
}

// ============================================================================
// Signal CRUD
// ============================================================================

const MAX_SIGNALS = 2000

/**
 * Log a new signal for performance tracking.
 * Persists to MongoDB so signals survive across serverless invocations.
 */
export async function logSignal(signal: Omit<SignalRecord, 'id'>): Promise<string> {
  await ensureIndexes()
  const id = `sig_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

  // Derive cityCode from marketId to prevent cross-city contamination
  const derivedCity = extractCityCode(signal.marketId)
  if (derivedCity && signal.cityCode && derivedCity !== signal.cityCode) {
    console.warn(`[performanceTracker] Cross-city mismatch in logSignal: signal.cityCode=${signal.cityCode} but marketId=${signal.marketId} → ${derivedCity}`)
  }
  const record: SignalRecord = { id, ...signal, ...(derivedCity ? { cityCode: derivedCity } : {}) }

  try {
    await signals().insertOne(record as any)

    if (
      record.signal !== 'HOLD' &&
      record.cityCode &&
      record.perSourceForecasts &&
      Object.keys(record.perSourceForecasts).length > 0
    ) {
      await logSourcePredictionSnapshot({
        signalId: id,
        marketId: record.marketId,
        cityCode: record.cityCode,
        marketType: record.temperatureType ?? extractMarketType(record.marketId),
        leadHours: record.hoursToResolution,
        policyVersion: record.decisionPolicyVersion ?? DEFAULT_POLICY_VERSION,
        perSourceForecasts: record.perSourceForecasts,
        isTrade: true,
        timestamp: record.timestamp,
      })
    }

    await logMarketPrediction({
      marketId: record.marketId,
      cityCode: record.cityCode,
      marketType: record.temperatureType ? `temperature-${record.temperatureType}` : undefined,
      timestamp: record.timestamp,
      marketPrice: record.marketPrice,
      rawProbability: record.rawModelProbability ?? record.modelProbability,
      correctedProbability: record.correctedModelProbability ?? record.modelProbability,
      correctionF: record.correctionF ?? 0,
      isTrade: record.signal !== 'HOLD',
      tradeSignal: record.signal,
      hoursToResolution: record.hoursToResolution,
      policyVersion: record.decisionPolicyVersion ?? DEFAULT_POLICY_VERSION,
      biasStateId: record.biasStateId,
      calibrationModelId: record.calibrationModelId,
      probabilityModel: process.env.BMA_ENABLED !== 'false' ? 'bma' : 'kde',
    })
  } catch (err) {
    // Best-effort: don't crash if DB write fails, but surface the failure
    // loudly in logs so pipeline degradation is discoverable in PM2.
    console.error(
      `[performanceTracker.logSignal] DB write failed for ${record.cityCode ?? 'unknown'}/${record.marketId}:`,
      err instanceof Error ? err.message : err
    )
  }

  return id
}

/**
 * Record the outcome of a previously logged signal.
 */
export async function resolveSignal(signalId: string, outcome: boolean): Promise<boolean> {
  const result = await signals().updateOne(
    { id: signalId },
    { $set: { outcome, resolvedAt: Date.now() } }
  )
  return result.matchedCount > 0
}

/**
 * Resolve signals by market ID (for batch resolution).
 */
export async function resolveByMarketId(marketId: string, outcome: boolean): Promise<number> {
  const result = await signals().updateMany(
    { marketId, outcome: { $exists: false } },
    { $set: { outcome, resolvedAt: Date.now() } }
  )
  return result.modifiedCount
}

/**
 * Resolve signals by market ID with temperature verification data.
 * Records outcome AND feeds the temperature bias tracker.
 */
export async function resolveWithTemperature(
  marketId: string,
  outcome: boolean,
  actualTemp: number | null  // null for threshold-winner events — skips bias/accuracy recording
): Promise<{ resolved: number; biasRecorded: number }> {
  // First, fetch matching unresolved signals so we can feed the bias tracker
  const unresolved = await signals()
    .find({ marketId, outcome: { $exists: false } })
    .toArray()

  if (unresolved.length === 0) return { resolved: 0, biasRecorded: 0 }

  // Feed the temperature bias tracker for signals that have forecast data
  // ONLY when actualTemp is available (inner-bracket winners with precise midpoint)
  const derivedCity = extractCityCode(marketId)
  if (!derivedCity) {
    console.warn(`[performanceTracker] Could not parse city from marketId=${marketId}, skipping temp_bias writes`)
  }
  let biasRecorded = 0
  for (const record of unresolved) {
    if (actualTemp != null && derivedCity && record.forecastTemp != null) {
      if (record.cityCode && derivedCity !== record.cityCode) {
        console.warn(`[performanceTracker] Cross-city mismatch in resolveWithTemperature: record.cityCode=${record.cityCode} but marketId=${marketId} → ${derivedCity}`)
      }
      await recordTemperatureObservation(
        derivedCity,
        record.forecastTemp,
        actualTemp,
        undefined,
        {
          signalId: record.id,
          marketId: record.marketId,
          leadHours: record.hoursToResolution,
          policyVersion: record.decisionPolicyVersion ?? DEFAULT_POLICY_VERSION,
          marketType: record.temperatureType ?? extractMarketType(record.marketId),
        }
      )
      biasRecorded++
    }

    // Feed per-source accuracy tracker from server-side snapshot mapping
    // ONLY when actualTemp is available — threshold boundaries are not true observations
    if (actualTemp != null) {
      await writeSourceAccuracyFromResolution({
        marketId: record.marketId,
        signalId: record.id,
        actualTemp,
        groundTruthSource: 'kalshi_midpoint',
      })
    }
  }

  // Now update all matching market_predictions in one operation.
  // Match both missing and null: logMarketPrediction stores undefined as null,
  // so $exists:false never matches — use $in:[null] which covers both cases.
  await marketPredictions().updateMany(
    { marketId, resolvedOutcome: { $in: [null as any] } },
    { $set: { resolvedOutcome: outcome ? 1 : 0, resolvedAt: Date.now() } }
  )

  const result = await signals().updateMany(
    { marketId, outcome: { $exists: false } },
    { $set: { outcome, resolvedAt: Date.now(), ...(actualTemp != null ? { actualTemp } : {}) } }
  )

  return { resolved: result.modifiedCount, biasRecorded }
}

// ============================================================================
// Performance Analysis
// ============================================================================

/**
 * Calculate rolling Brier score for resolved signals.
 */
function calculateBrierScore(sigs: SignalRecord[]): number {
  const resolved = sigs.filter(s => s.outcome !== undefined)
  if (resolved.length === 0) return 0.25 // Random baseline

  return resolved.reduce((sum, s) => {
    const actual = s.outcome ? 1 : 0
    return sum + (s.modelProbability - actual) ** 2
  }, 0) / resolved.length
}

/**
 * Calculate calibration error across probability bins.
 */
function calculateCalibrationError(sigs: SignalRecord[]): number {
  const resolved = sigs.filter(s => s.outcome !== undefined)
  if (resolved.length < 10) return 0

  const numBins = 5
  const binWidth = 1.0 / numBins
  let totalError = 0
  let activeBins = 0

  for (let i = 0; i < numBins; i++) {
    const binLow = i * binWidth
    const binHigh = (i + 1) * binWidth
    const binSignals = resolved.filter(s =>
      s.modelProbability >= binLow && s.modelProbability < binHigh
    )

    if (binSignals.length === 0) continue

    const avgPredicted = binSignals.reduce((s, sig) => s + sig.modelProbability, 0) / binSignals.length
    const avgActual = binSignals.filter(s => s.outcome).length / binSignals.length

    totalError += Math.abs(avgPredicted - avgActual)
    activeBins++
  }

  return activeBins > 0 ? totalError / activeBins : 0
}

function didTradeWin(signal: SignalRecord): boolean {
  if (signal.outcome === undefined) return false
  return signal.direction === 'YES' ? signal.outcome === true : signal.outcome === false
}

/**
 * Get a performance snapshot for the current state of the model.
 * Uses the most recent signals within the rolling window.
 */
export async function getPerformanceSnapshot(
  config: PerformanceConfig = DEFAULT_PERFORMANCE_CONFIG
): Promise<PerformanceSnapshot> {
  await ensureIndexes()
  const recentSignals = await signals()
    .find()
    .sort({ timestamp: -1 })
    .limit(config.rollingWindow)
    .toArray()

  // Reverse so oldest is first (matches previous in-memory slice order)
  recentSignals.reverse()

  const resolvedSignals = recentSignals.filter(s => s.outcome !== undefined)

  const totalSignals = recentSignals.length
  const resolvedCount = resolvedSignals.length

  // Win rate is defined in trade space, not market-outcome space.
  const wins = resolvedSignals.filter(didTradeWin).length
  const winRate = resolvedCount > 0 ? wins / resolvedCount : 0.5

  // Brier score
  const brierScore = calculateBrierScore(recentSignals)

  // Market baseline Brier (using Kalshi price as predictor)
  const marketBrierScore = resolvedSignals.length > 0
    ? resolvedSignals.reduce((sum, s) => {
        const actual = s.outcome ? 1 : 0
        return sum + (s.marketPrice - actual) ** 2
      }, 0) / resolvedSignals.length
    : 0.25

  const brierSkillScore = marketBrierScore > 0
    ? 1 - (brierScore / marketBrierScore)
    : 0

  // Average edge
  const averageEdge = totalSignals > 0
    ? recentSignals.reduce((s, sig) => s + sig.edge, 0) / totalSignals
    : 0

  // Average return (simplified: win = +edge, loss = -price)
  const avgReturn = resolvedCount > 0
    ? resolvedSignals.reduce((sum, s) => {
        if (didTradeWin(s)) return sum + s.edge
        return sum - (s.direction === 'YES' ? s.marketPrice : (1 - s.marketPrice))
      }, 0) / resolvedCount
    : 0

  // Calibration error
  const calibrationError = calculateCalibrationError(recentSignals)

  // Detect model decay
  const modelDecay = resolvedCount >= 20 && (
    winRate < config.decayThreshold ||
    brierScore > config.brierThreshold
  )

  // Dynamic edge threshold: widen when decaying
  let recommendedMinEdge = config.baseMinEdge
  if (modelDecay) {
    // Increase min edge proportional to how bad performance is
    const decayFactor = Math.max(
      (config.decayThreshold - winRate) / config.decayThreshold,
      (brierScore - config.brierThreshold) / config.brierThreshold
    )
    recommendedMinEdge = Math.min(
      config.maxMinEdge,
      config.baseMinEdge + decayFactor * (config.maxMinEdge - config.baseMinEdge)
    )
  }

  return {
    windowSize: config.rollingWindow,
    totalSignals,
    resolvedSignals: resolvedCount,
    winRate,
    brierScore,
    marketBrierScore,
    brierSkillScore,
    averageEdge,
    avgReturn,
    calibrationError,
    modelDecay,
    recommendedMinEdge,
    timestamp: Date.now(),
  }
}

/**
 * Get signal records (for export/analysis).
 */
export async function getSignalHistory(limit?: number): Promise<SignalRecord[]> {
  await ensureIndexes()
  const query = signals().find().sort({ timestamp: -1 })
  const docs = await query.limit(limit || MAX_SIGNALS).toArray()
  docs.reverse()
  return docs as SignalRecord[]
}

const MAX_UNRESOLVED_LOOKBACK_DAYS = 90

/**
 * Get unresolved signals within a 90-day lookback window.
 * Used by resolve-markets to find signals needing resolution.
 */
export async function getUnresolvedSignals(): Promise<SignalRecord[]> {
  await ensureIndexes()
  const cutoff = Date.now() - MAX_UNRESOLVED_LOOKBACK_DAYS * 24 * 60 * 60 * 1000
  const docs = await signals()
    .find({ outcome: { $exists: false }, timestamp: { $gte: cutoff } })
    .sort({ timestamp: -1 })
    .toArray()
  if (docs.length > 1000) {
    console.warn(`[getUnresolvedSignals] high count: ${docs.length} unresolved signals in last ${MAX_UNRESOLVED_LOOKBACK_DAYS}d`)
  }
  return docs as SignalRecord[]
}

/**
 * Clear all signal history (for testing only).
 * Refuses to run against the production database as a safety guard.
 */
export async function clearSignalHistory(): Promise<void> {
  const dbName = process.env.MONGODB_DB_NAME || 'kardashev'
  if (dbName === 'kardashev') {
    throw new Error('clearSignalHistory refused: cannot wipe production database. Set MONGODB_DB_NAME to a test database.')
  }
  await signals().deleteMany({})
}

export async function logMarketPrediction(input: {
  marketId: string
  eventTicker?: string
  cityCode?: string
  marketType?: 'temperature-high' | 'temperature-low' | 'precipitation'
  timestamp: number
  marketPrice: number
  rawProbability: number
  correctedProbability: number
  correctionF: number
  isTrade: boolean
  tradeSignal?: string
  hoursToResolution?: number
  sources?: string[]
  modelAgreement?: number
  stdDevFloorC?: number
  resolvedOutcome?: 0 | 1
  resolvedAt?: number
  policyVersion?: string
  biasStateId?: string
  calibrationModelId?: string
  probabilityModel?: 'bma' | 'kde'
}): Promise<string> {
  await ensureIndexes()
  const id = `pred_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const retentionDays = input.isTrade ? RETENTION_TRADE_DAYS : RETENTION_NON_TRADE_DAYS
  const expiresAt = new Date(input.timestamp + retentionDays * 24 * 60 * 60 * 1000)

  const doc: MarketPredictionRecord = {
    id,
    marketId: input.marketId,
    eventTicker: input.eventTicker,
    cityCode: input.cityCode,
    marketType: input.marketType,
    timestamp: input.timestamp,
    marketPrice: input.marketPrice,
    rawProbability: input.rawProbability,
    correctedProbability: input.correctedProbability,
    correctionF: input.correctionF,
    isTrade: input.isTrade,
    tradeSignal: input.tradeSignal,
    hoursToResolution: input.hoursToResolution,
    sources: input.sources,
    modelAgreement: input.modelAgreement,
    stdDevFloorC: input.stdDevFloorC,
    // Only include resolvedOutcome/resolvedAt when actually provided —
    // storing undefined as null causes $exists:false to miss these documents.
    ...(input.resolvedOutcome != null ? { resolvedOutcome: input.resolvedOutcome } : {}),
    ...(input.resolvedAt != null ? { resolvedAt: input.resolvedAt } : {}),
    policyVersion: input.policyVersion ?? DEFAULT_POLICY_VERSION,
    biasStateId: input.biasStateId,
    calibrationModelId: input.calibrationModelId,
    probabilityModel: input.probabilityModel,
    expiresAt,
  }

  try {
    await marketPredictions().insertOne(doc as any)
  } catch (err) {
    // Best-effort: don't throw, but surface the failure loudly in logs so
    // pipeline degradation is discoverable in PM2.
    console.error(
      `[performanceTracker.logMarketPrediction] insert failed for ${doc.cityCode ?? 'unknown'}/${doc.marketId}:`,
      err instanceof Error ? err.message : err
    )
  }

  return id
}

// ============================================================================
// Analytics: Reliability Data
// ============================================================================

export interface ReliabilityData {
  bins: Array<{ binCenter: number; avgPredicted: number; avgActual: number; count: number }>
  sampleSize: number
  lookbackDays: number
}

/**
 * Generate reliability diagram data from resolved market predictions.
 * Uses correctedProbability vs resolvedOutcome from market_predictions.
 * NOTE: lookbackDays defaults to 180 — must stay in sync with calibration training default.
 */
export async function getReliabilityData(lookbackDays = 180, since?: number): Promise<ReliabilityData> {
  await ensureIndexes()
  const defaultCutoff = Date.now() - lookbackDays * 24 * 60 * 60 * 1000
  const cutoff = since ?? defaultCutoff

  const rows = await marketPredictions()
    .find({
      resolvedOutcome: { $in: [0, 1] },
      correctedProbability: { $exists: true, $gte: 0, $lte: 1 },
      timestamp: { $gte: cutoff },
    })
    .project({ correctedProbability: 1, resolvedOutcome: 1 })
    .toArray()

  const points: CalibrationPoint[] = rows.map(r => ({
    predicted: r.correctedProbability as number,
    actual: r.resolvedOutcome as number,
  }))

  const bins = generateReliabilityDiagram(points, 10)

  return {
    bins,
    sampleSize: points.length,
    lookbackDays,
  }
}

// ============================================================================
// Analytics: Calibration Readiness
// ============================================================================

/**
 * Check how many resolved predictions qualify for calibration retraining.
 * Mirrors the training filter from calibration.ts but adds marketType and
 * hoursToResolution existence checks (required for segmented training).
 */
export async function getCalibrationReadiness(lookbackDays = 180): Promise<{
  resolvedCount: number
  threshold: number
  ready: boolean
}> {
  await ensureIndexes()
  const cutoff = Date.now() - lookbackDays * 86_400_000
  const resolvedCount = await marketPredictions().countDocuments({
    correctedProbability: { $gte: 0, $lte: 1 },
    resolvedOutcome: { $in: [0, 1] },
    marketType: { $exists: true },
    hoursToResolution: { $exists: true },
    timestamp: { $gte: cutoff },
  })
  return { resolvedCount, threshold: 50, ready: resolvedCount >= 50 }
}

// ============================================================================
// Analytics: P&L Breakdown
// ============================================================================

export interface PnLGroupSummary {
  key: string
  trades: number
  wins: number
  winRate: number
  grossProfit: number
  totalFees: number
  netProfit: number
  avgReturn: number
}

export interface PnLBreakdown {
  byCity: PnLGroupSummary[]
  byMarketType: PnLGroupSummary[]
  byLeadBucket: PnLGroupSummary[]
  overall: PnLGroupSummary
  trades: BacktestResult[]
}

const LEAD_BUCKET_LABELS: Record<string, string> = {
  lt12h: '<12h',
  '12to24h': '12-24h',
  '24to48h': '24-48h',
  '48to72h': '48-72h',
  gt72h: '>72h',
}

/**
 * Compute per-signal P&L and group by city, market type, and lead bucket.
 * Sources data from market_predictions (which has resolved outcomes) rather
 * than signals (which may not have been resolved for older trades).
 * Fee model mirrors calculateExpectedValue() from weatherProbability.ts:
 *   - YES win:  net = (1 - marketPrice) * (1 - DEFAULT_FEE_RATE)
 *   - YES loss: net = -marketPrice
 *   - NO win:   net = marketPrice * (1 - DEFAULT_FEE_RATE)
 *   - NO loss:  net = -(1 - marketPrice)
 */
export async function getPnLBreakdown(limit = 500, since?: number): Promise<PnLBreakdown> {
  await ensureIndexes()
  const defaultCutoff = Date.now() - 180 * 24 * 60 * 60 * 1000
  const cutoff = since ?? defaultCutoff

  const docs = await marketPredictions()
    .find({
      resolvedOutcome: { $in: [0, 1] },
      isTrade: true,
      timestamp: { $gte: cutoff },
    })
    .sort({ timestamp: -1 })
    .limit(limit)
    .toArray()

  // Reverse to chronological order
  docs.reverse()

  const trades: BacktestResult[] = []

  for (const s of docs) {
    const modelProb = s.correctedProbability
    const direction = modelProb > s.marketPrice ? 'YES' : 'NO'
    // resolvedOutcome: 1 = YES resolved, 0 = NO resolved
    // A YES bet wins when resolvedOutcome=1, a NO bet wins when resolvedOutcome=0
    const won = direction === 'YES' ? s.resolvedOutcome === 1 : s.resolvedOutcome === 0
    let gross: number
    let fees: number
    let net: number

    if (direction === 'YES') {
      if (won) {
        gross = 1 - s.marketPrice
        fees = gross * DEFAULT_FEE_RATE
        net = gross - fees
      } else {
        gross = -s.marketPrice
        fees = 0
        net = gross
      }
    } else {
      if (won) {
        gross = s.marketPrice
        fees = gross * DEFAULT_FEE_RATE
        net = gross - fees
      } else {
        gross = -(1 - s.marketPrice)
        fees = 0
        net = gross
      }
    }

    trades.push({
      marketId: s.marketId,
      date: new Date(s.timestamp).toISOString().slice(0, 10),
      timestamp: s.timestamp,
      modelProbability: modelProb,
      marketPrice: s.marketPrice,
      direction,
      edge: Math.abs(modelProb - s.marketPrice),
      outcome: won,
      profit: gross,
      fees: Math.abs(fees),
      netProfit: net,
    })
  }

  // Group helper
  function groupBy(keyFn: (t: BacktestResult, i: number) => string): PnLGroupSummary[] {
    const map = new Map<string, BacktestResult[]>()
    trades.forEach((t, i) => {
      const k = keyFn(t, i)
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(t)
    })
    return Array.from(map.entries()).map(([key, group]) => summarize(key, group))
  }

  function summarize(key: string, group: BacktestResult[]): PnLGroupSummary {
    const wins = group.filter(t => t.outcome).length
    const grossProfit = group.reduce((s, t) => s + t.profit, 0)
    const totalFees = group.reduce((s, t) => s + t.fees, 0)
    const netProfit = group.reduce((s, t) => s + t.netProfit, 0)
    return {
      key,
      trades: group.length,
      wins,
      winRate: group.length > 0 ? wins / group.length : 0,
      grossProfit,
      totalFees,
      netProfit,
      avgReturn: group.length > 0 ? netProfit / group.length : 0,
    }
  }

  const byCity = groupBy((_, i) => docs[i].cityCode || 'unknown')
  const byMarketType = groupBy((_, i) => {
    // marketType is 'temperature-high' | 'temperature-low' | 'precipitation'
    // Extract just the sub-type for display
    const mt = docs[i].marketType
    if (mt === 'temperature-high') return 'high'
    if (mt === 'temperature-low') return 'low'
    return mt || 'unknown'
  })
  const byLeadBucket = groupBy((_, i) => {
    const h = docs[i].hoursToResolution
    const bucket = h != null ? toCalibrationLeadBucket(h) : 'unknown'
    return LEAD_BUCKET_LABELS[bucket] || bucket
  })
  const overall = summarize('all', trades)

  return { byCity, byMarketType, byLeadBucket, overall, trades }
}
