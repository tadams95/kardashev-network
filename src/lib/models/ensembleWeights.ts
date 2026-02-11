// Dynamic ensemble weights using inverse-Brier-score weighting
// Replaces fixed 40/40/20 weights with performance-based weights per source, city, and market type

import type { EnsembleWeights } from '@/types/weather'

// ============================================================================
// Types
// ============================================================================

export interface SourcePerformance {
  source: string
  brierScore: number      // Lower is better (0 = perfect)
  sampleSize: number      // Number of predictions evaluated
  lastUpdated: number     // Timestamp
}

export interface WeightConfig {
  minWeight: number       // No source drops below this (default: 0.05)
  maxWeight: number       // No source exceeds this (default: 0.60)
  decayFactor: number     // Exponential decay for staleness (default: 0.95)
  minSamples: number      // Minimum samples before dynamic weights kick in (default: 20)
}

interface PerformanceRecord {
  predictions: Array<{
    predicted: number
    actual: number
    timestamp: number
  }>
  brierScore: number
  lastUpdated: number
}

const DEFAULT_WEIGHT_CONFIG: WeightConfig = {
  minWeight: 0.05,
  maxWeight: 0.60,
  decayFactor: 0.95,
  minSamples: 20,
}

// ============================================================================
// Performance Tracking Store (in-memory, per-session)
// ============================================================================

// Key: "source:city:marketType" (e.g., "Open-Meteo:NY:temperature")
const performanceStore = new Map<string, PerformanceRecord>()

function getStoreKey(source: string, city?: string, marketType?: string): string {
  return `${source}:${city || 'all'}:${marketType || 'all'}`
}

/**
 * Record a prediction outcome for a source.
 * Used to update dynamic weights over time.
 */
export function recordPrediction(
  source: string,
  predicted: number,
  actual: number,
  city?: string,
  marketType?: string
): void {
  const key = getStoreKey(source, city, marketType)

  let record = performanceStore.get(key)
  if (!record) {
    record = { predictions: [], brierScore: 0.25, lastUpdated: Date.now() }
    performanceStore.set(key, record)
  }

  record.predictions.push({ predicted, actual, timestamp: Date.now() })

  // Keep only last 500 predictions to bound memory
  if (record.predictions.length > 500) {
    record.predictions = record.predictions.slice(-500)
  }

  // Recalculate Brier score
  record.brierScore = record.predictions.reduce(
    (sum, p) => sum + (p.predicted - p.actual) ** 2, 0
  ) / record.predictions.length

  record.lastUpdated = Date.now()
}

/**
 * Get source performance for a specific context.
 */
export function getSourcePerformance(
  source: string,
  city?: string,
  marketType?: string
): SourcePerformance {
  const key = getStoreKey(source, city, marketType)
  const record = performanceStore.get(key)

  if (!record) {
    return {
      source,
      brierScore: 0.25, // Default (random guessing baseline)
      sampleSize: 0,
      lastUpdated: 0,
    }
  }

  return {
    source,
    brierScore: record.brierScore,
    sampleSize: record.predictions.length,
    lastUpdated: record.lastUpdated,
  }
}

// ============================================================================
// Dynamic Weight Calculation
// ============================================================================

/**
 * Calculate inverse-Brier-score weights for ensemble sources.
 * Sources with lower Brier scores (better calibration) get higher weights.
 *
 * Falls back to fixed weights when insufficient performance data exists.
 *
 * @param sources - List of active source names
 * @param city - Optional city for city-specific weights
 * @param marketType - Optional market type (temperature/precipitation)
 * @param config - Weight configuration
 * @returns Dynamic weights per source
 */
export function calculateDynamicWeights(
  sources: string[],
  city?: string,
  marketType?: string,
  config: WeightConfig = DEFAULT_WEIGHT_CONFIG
): Record<string, number> {
  if (sources.length === 0) return {}

  // Gather performance data for each source
  const performances = sources.map(source =>
    getSourcePerformance(source, city, marketType)
  )

  // Check if we have enough data for dynamic weighting
  const totalSamples = performances.reduce((s, p) => s + p.sampleSize, 0)
  if (totalSamples < config.minSamples * sources.length) {
    // Not enough data: fall back to fixed weights
    return getDefaultWeights(sources)
  }

  // Calculate inverse Brier scores
  // Add small epsilon to prevent division by zero
  const epsilon = 0.001
  const inverseBrier = performances.map(p => 1 / (p.brierScore + epsilon))
  const totalInverse = inverseBrier.reduce((s, v) => s + v, 0)

  // Normalize to weights
  const rawWeights = inverseBrier.map(ib => ib / totalInverse)

  // Apply staleness decay: reduce weight for sources with old data
  const now = Date.now()
  const decayedWeights = rawWeights.map((w, i) => {
    const perf = performances[i]
    if (perf.lastUpdated === 0) return w

    const ageHours = (now - perf.lastUpdated) / (1000 * 3600)
    const decay = Math.pow(config.decayFactor, ageHours)
    return w * decay
  })

  // Clamp to [minWeight, maxWeight] and renormalize
  const clampedWeights = decayedWeights.map(w =>
    Math.max(config.minWeight, Math.min(config.maxWeight, w))
  )

  const totalClamped = clampedWeights.reduce((s, v) => s + v, 0)
  const normalizedWeights = clampedWeights.map(w => w / totalClamped)

  // Build result map
  const result: Record<string, number> = {}
  sources.forEach((source, i) => {
    result[source] = normalizedWeights[i]
  })

  return result
}

/**
 * Get fixed default weights for known sources.
 * Used as fallback when insufficient performance data exists.
 */
function getDefaultWeights(sources: string[]): Record<string, number> {
  const knownWeights: Record<string, number> = {
    'Open-Meteo': 0.35,
    'Google-Weather': 0.35,
    'NWS': 0.15,
    'METAR': 0.15,
  }

  const result: Record<string, number> = {}
  let total = 0

  for (const source of sources) {
    const w = knownWeights[source] || 0.10
    result[source] = w
    total += w
  }

  // Normalize
  for (const source of sources) {
    result[source] /= total
  }

  return result
}

/**
 * Convert dynamic weights to the EnsembleWeights type for backward compatibility.
 * If a source is missing, its weight is set to 0.
 */
export function toEnsembleWeights(
  dynamicWeights: Record<string, number>
): EnsembleWeights {
  return {
    'Open-Meteo': dynamicWeights['Open-Meteo'] || 0,
    'Google-Weather': dynamicWeights['Google-Weather'] || 0,
    'METAR': dynamicWeights['METAR'] || 0,
    'NWS': dynamicWeights['NWS'] || 0,
  }
}

/**
 * Reset all stored performance data (for testing).
 */
export function resetPerformanceStore(): void {
  performanceStore.clear()
}
