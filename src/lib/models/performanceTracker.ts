// Live performance tracking for weather trading signals
// Logs every signal, computes rolling Brier/win-rate, detects model decay
// Auto-widens edge thresholds when performance degrades
// Persists signal history to disk as JSONL for cross-restart durability

import fs from 'fs'
import path from 'path'

// ============================================================================
// File Persistence
// ============================================================================

const SIGNAL_LOG_PATH = path.join(process.cwd(), 'data', 'weather', 'signal_log.jsonl')

function ensureDir(): void {
  const dir = path.dirname(SIGNAL_LOG_PATH)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function appendSignalToDisk(record: SignalRecord): void {
  try {
    ensureDir()
    fs.appendFileSync(SIGNAL_LOG_PATH, JSON.stringify(record) + '\n')
  } catch {
    // Best-effort: don't crash if disk write fails
  }
}

function writeAllSignalsToDisk(records: SignalRecord[]): void {
  try {
    ensureDir()
    const lines = records.map(r => JSON.stringify(r)).join('\n')
    fs.writeFileSync(SIGNAL_LOG_PATH, lines ? lines + '\n' : '')
  } catch {
    // Best-effort
  }
}

let loadedFromDisk = false

function loadSignalsFromDisk(): void {
  if (loadedFromDisk) return
  loadedFromDisk = true
  try {
    if (!fs.existsSync(SIGNAL_LOG_PATH)) return
    const content = fs.readFileSync(SIGNAL_LOG_PATH, 'utf-8').trim()
    if (!content) return
    for (const line of content.split('\n')) {
      if (!line.trim()) continue
      const record = JSON.parse(line) as SignalRecord
      // Avoid duplicates if module is reloaded but store already has data
      if (!signalStore.some(s => s.id === record.id)) {
        signalStore.push(record)
      }
    }
    // Trim to max size after loading
    if (signalStore.length > MAX_SIGNALS) {
      signalStore.splice(0, signalStore.length - MAX_SIGNALS)
    }
  } catch {
    // Best-effort: if file is corrupt, start fresh
  }
}

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
  // Filled in after resolution
  outcome?: boolean
  resolvedAt?: number
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
// In-Memory Signal Store
// ============================================================================

const signalStore: SignalRecord[] = []
const MAX_SIGNALS = 2000 // Keep last 2000 signals

/**
 * Log a new signal for performance tracking.
 * Persists to disk as JSONL so signals survive server restarts.
 */
export function logSignal(signal: Omit<SignalRecord, 'id'>): string {
  loadSignalsFromDisk()

  const id = `sig_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const record: SignalRecord = { id, ...signal }

  signalStore.push(record)

  // Trim to max size
  if (signalStore.length > MAX_SIGNALS) {
    signalStore.splice(0, signalStore.length - MAX_SIGNALS)
  }

  appendSignalToDisk(record)
  return id
}

/**
 * Record the outcome of a previously logged signal.
 * Rewrites the JSONL file with the updated outcome.
 */
export function resolveSignal(signalId: string, outcome: boolean): boolean {
  loadSignalsFromDisk()

  const record = signalStore.find(s => s.id === signalId)
  if (!record) return false

  record.outcome = outcome
  record.resolvedAt = Date.now()
  writeAllSignalsToDisk(signalStore)
  return true
}

/**
 * Resolve a signal by market ID (for batch resolution).
 * Rewrites the JSONL file with updated outcomes.
 */
export function resolveByMarketId(marketId: string, outcome: boolean): number {
  loadSignalsFromDisk()

  let resolved = 0
  for (const record of signalStore) {
    if (record.marketId === marketId && record.outcome === undefined) {
      record.outcome = outcome
      record.resolvedAt = Date.now()
      resolved++
    }
  }

  if (resolved > 0) {
    writeAllSignalsToDisk(signalStore)
  }
  return resolved
}

// ============================================================================
// Performance Analysis
// ============================================================================

/**
 * Calculate rolling Brier score for resolved signals.
 */
function calculateBrierScore(signals: SignalRecord[]): number {
  const resolved = signals.filter(s => s.outcome !== undefined)
  if (resolved.length === 0) return 0.25 // Random baseline

  return resolved.reduce((sum, s) => {
    const actual = s.outcome ? 1 : 0
    return sum + (s.modelProbability - actual) ** 2
  }, 0) / resolved.length
}

/**
 * Calculate calibration error across probability bins.
 */
function calculateCalibrationError(signals: SignalRecord[]): number {
  const resolved = signals.filter(s => s.outcome !== undefined)
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
export function getPerformanceSnapshot(
  config: PerformanceConfig = DEFAULT_PERFORMANCE_CONFIG
): PerformanceSnapshot {
  loadSignalsFromDisk()
  const recentSignals = signalStore.slice(-config.rollingWindow)
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
 * Get all signal records (for export/analysis).
 */
export function getSignalHistory(limit?: number): SignalRecord[] {
  loadSignalsFromDisk()
  if (limit) return signalStore.slice(-limit)
  return [...signalStore]
}

/**
 * Clear all signal history (for testing).
 * Also removes the on-disk JSONL file.
 */
export function clearSignalHistory(): void {
  signalStore.length = 0
  loadedFromDisk = false
  try {
    if (fs.existsSync(SIGNAL_LOG_PATH)) {
      fs.unlinkSync(SIGNAL_LOG_PATH)
    }
  } catch {
    // Best-effort
  }
}
