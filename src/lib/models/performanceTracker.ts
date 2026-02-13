// Live performance tracking for weather trading signals
// Logs every signal, computes rolling Brier/win-rate, detects model decay
// Auto-widens edge thresholds when performance degrades
// Persists signal history to MongoDB for cross-invocation durability

import { getDb } from '@/lib/db/mongodb'
import { recordTemperatureObservation } from './temperatureBias'

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
  // Filled in after resolution
  outcome?: boolean
  resolvedAt?: number
  actualTemp?: number     // Resolved actual temperature in °F
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

// ============================================================================
// Signal CRUD
// ============================================================================

const MAX_SIGNALS = 2000

/**
 * Log a new signal for performance tracking.
 * Persists to MongoDB so signals survive across serverless invocations.
 */
export async function logSignal(signal: Omit<SignalRecord, 'id'>): Promise<string> {
  const id = `sig_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const record: SignalRecord = { id, ...signal }

  try {
    await signals().insertOne(record as any)
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
): Promise<number> {
  // First, fetch matching unresolved signals so we can feed the bias tracker
  const unresolved = await signals()
    .find({ marketId, outcome: { $exists: false } })
    .toArray()

  if (unresolved.length === 0) return 0

  // Feed the temperature bias tracker for signals that have forecast data
  for (const record of unresolved) {
    if (record.cityCode && record.forecastTemp != null) {
      await recordTemperatureObservation(
        record.cityCode,
        record.forecastTemp,
        actualTemp
      )
    }
  }

  // Now update all matching signals in one operation
  const result = await signals().updateMany(
    { marketId, outcome: { $exists: false } },
    { $set: { outcome, resolvedAt: Date.now(), actualTemp } }
  )

  return result.modifiedCount
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
