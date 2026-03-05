// Live performance tracking for weather trading signals
// Logs every signal, computes rolling Brier/win-rate, detects model decay
// Auto-widens edge thresholds when performance degrades
// Persists signal history to MongoDB for cross-invocation durability

import { getDb } from '@/lib/db/mongodb'
import { extractCityCode } from '@/lib/utils/tickerParsing'
import { recordTemperatureObservation } from './temperatureBias'
import { logSourcePredictionSnapshot, writeSourceAccuracyFromResolution } from './sourceAccuracy'

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
  shadowMeta?: {
    regime?: string
    contextKey?: string
    effectiveSampleSize?: number
  }
  perSourceForecasts?: Record<string, number>  // source → forecast temp °F
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
  expiresAt: Date
}

export interface PerformanceSnapshot {
  windowSize: number
  totalSignals: number
  resolvedSignals: number
  winRate: number
  brierScore: number
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
        marketType: record.temperatureType || 'high',
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
    })
  } catch {
    // Best-effort: don't crash if DB write fails
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
  actualTemp: number
): Promise<{ resolved: number; biasRecorded: number }> {
  // First, fetch matching unresolved signals so we can feed the bias tracker
  const unresolved = await signals()
    .find({ marketId, outcome: { $exists: false } })
    .toArray()

  if (unresolved.length === 0) return { resolved: 0, biasRecorded: 0 }

  // Feed the temperature bias tracker for signals that have forecast data
  // Derive cityCode from marketId to prevent cross-city contamination
  const derivedCity = extractCityCode(marketId)
  let biasRecorded = 0
  for (const record of unresolved) {
    const effectiveCity = derivedCity ?? record.cityCode
    if (effectiveCity && record.forecastTemp != null) {
      if (derivedCity && record.cityCode && derivedCity !== record.cityCode) {
        console.warn(`[performanceTracker] Cross-city mismatch in resolveWithTemperature: record.cityCode=${record.cityCode} but marketId=${marketId} → ${derivedCity}`)
      }
      await recordTemperatureObservation(
        effectiveCity,
        record.forecastTemp,
        actualTemp,
        undefined,
        {
          signalId: record.id,
          marketId: record.marketId,
          leadHours: record.hoursToResolution,
          policyVersion: record.decisionPolicyVersion ?? DEFAULT_POLICY_VERSION,
        }
      )
      biasRecorded++
    }

    // Feed per-source accuracy tracker from server-side snapshot mapping
    await writeSourceAccuracyFromResolution({
      marketId: record.marketId,
      signalId: record.id,
      actualTemp,
      groundTruthSource: 'kalshi_midpoint',
    })
  }

  // Now update all matching signals in one operation
  await marketPredictions().updateMany(
    { marketId, resolvedOutcome: { $exists: false } },
    { $set: { resolvedOutcome: outcome ? 1 : 0, resolvedAt: Date.now() } }
  )

  const result = await signals().updateMany(
    { marketId, outcome: { $exists: false } },
    { $set: { outcome, resolvedAt: Date.now(), actualTemp } }
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

  // Win rate
  const wins = resolvedSignals.filter(s => s.outcome).length
  const winRate = resolvedCount > 0 ? wins / resolvedCount : 0.5

  // Brier score
  const brierScore = calculateBrierScore(recentSignals)

  // Average edge
  const averageEdge = totalSignals > 0
    ? recentSignals.reduce((s, sig) => s + sig.edge, 0) / totalSignals
    : 0

  // Average return (simplified: win = +edge, loss = -price)
  const avgReturn = resolvedCount > 0
    ? resolvedSignals.reduce((sum, s) => {
        if (s.outcome) return sum + s.edge
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

/**
 * Clear all signal history (for testing).
 */
export async function clearSignalHistory(): Promise<void> {
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
    resolvedOutcome: input.resolvedOutcome,
    resolvedAt: input.resolvedAt,
    policyVersion: input.policyVersion ?? DEFAULT_POLICY_VERSION,
    biasStateId: input.biasStateId,
    calibrationModelId: input.calibrationModelId,
    expiresAt,
  }

  try {
    await marketPredictions().insertOne(doc as any)
  } catch {
    // Best-effort logging: do not throw
  }

  return id
}
