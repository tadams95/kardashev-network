// Per-city temperature bias tracking and correction
// Tracks forecast-vs-actual errors and applies additive corrections
// Persists to MongoDB for cross-invocation durability

import { getDb } from '@/lib/db/mongodb'

// ============================================================================
// Configuration
// ============================================================================

const DECAY_HALFLIFE_DAYS = 14  // Exponential decay half-life in days

// ============================================================================
// Types
// ============================================================================

export interface TemperatureObservation {
  cityCode: string
  forecastTemp: number   // Weighted ensemble forecast in °F
  actualTemp: number     // Resolved actual temperature in °F
  error: number          // forecast - actual (negative = cool bias)
  timestamp: number      // When this observation was recorded
  sources?: string[]     // Which forecast sources contributed
}

export interface CityBias {
  cityCode: string
  meanError: number      // Weighted mean of (forecast - actual) in °F
  sampleCount: number
  lastUpdated: number
}

// ============================================================================
// MongoDB helpers
// ============================================================================

function tempBias() {
  return getDb().collection<TemperatureObservation>('temp_bias')
}

let _biasIndexesCreated = false
async function ensureBiasIndexes(): Promise<void> {
  if (_biasIndexesCreated) return
  _biasIndexesCreated = true
  try {
    await tempBias().createIndex({ cityCode: 1, timestamp: -1 })
  } catch (err) {
    console.error('[TempBias] index creation failed:', err)
    _biasIndexesCreated = false
  }
}

// ============================================================================
// Bias Computation
// ============================================================================

/**
 * Compute exponential decay weight for an observation.
 * More recent observations count more heavily.
 */
function decayWeight(observationTimestamp: number, now: number): number {
  const ageMs = now - observationTimestamp
  const ageDays = ageMs / (1000 * 60 * 60 * 24)
  // w = 2^(-age/halflife) — halves every DECAY_HALFLIFE_DAYS
  return Math.pow(2, -ageDays / DECAY_HALFLIFE_DAYS)
}

/**
 * Get the computed bias for a specific city.
 * Returns null if insufficient data.
 */
export async function getCityBias(cityCode: string): Promise<CityBias | null> {
  await ensureBiasIndexes()
  const cityObs = await tempBias().find({ cityCode }).toArray()
  if (cityObs.length === 0) return null

  const now = Date.now()
  let weightedSum = 0
  let weightSum = 0

  for (const obs of cityObs) {
    const w = decayWeight(obs.timestamp, now)
    weightedSum += obs.error * w
    weightSum += w
  }

  const meanError = weightSum > 0 ? weightedSum / weightSum : 0

  return {
    cityCode,
    meanError,
    sampleCount: cityObs.length,
    lastUpdated: Math.max(...cityObs.map(o => o.timestamp)),
  }
}

// ============================================================================
// Recording Observations
// ============================================================================

/**
 * Record a forecast verification observation.
 * Call this when a market resolves and the actual temperature is known.
 */
export async function recordTemperatureObservation(
  cityCode: string,
  forecastTemp: number,
  actualTemp: number,
  sources?: string[]
): Promise<void> {
  await ensureBiasIndexes()
  const obs: TemperatureObservation = {
    cityCode,
    forecastTemp,
    actualTemp,
    error: forecastTemp - actualTemp,
    timestamp: Date.now(),
    sources,
  }

  try {
    await tempBias().insertOne(obs as any)
  } catch (err) {
    console.error('[TempBias] write failed:', err)
  }
}

