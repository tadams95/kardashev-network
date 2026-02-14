// Per-city temperature bias tracking and correction
// Tracks forecast-vs-actual errors and applies additive corrections
// Persists to MongoDB for cross-invocation durability

import { getDb } from '@/lib/db/mongodb'

// ============================================================================
// Configuration
// ============================================================================

const MIN_SAMPLES = 10          // Minimum observations before activating correction
const DECAY_HALFLIFE_DAYS = 14  // Exponential decay half-life in days
const MAX_CORRECTION_F = 5      // Cap correction magnitude at ±5°F

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
  } catch {
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

/**
 * Apply per-city bias correction to a raw forecast temperature.
 * Subtracts the mean error (negative error = cool bias → adds warmth).
 * Returns the raw forecast unchanged if insufficient data.
 */
export async function applyCityBiasCorrection(
  rawForecastF: number,
  cityCode: string
): Promise<number> {
  const bias = await getCityBias(cityCode)
  if (!bias || bias.sampleCount < MIN_SAMPLES) return rawForecastF

  // Clamp correction to prevent runaway adjustments
  const correction = Math.max(-MAX_CORRECTION_F, Math.min(MAX_CORRECTION_F, -bias.meanError))
  const corrected = rawForecastF + correction

  console.debug(
    `[TempBias] ${cityCode}: raw=${rawForecastF.toFixed(1)}°F, ` +
    `meanError=${bias.meanError.toFixed(2)}°F (n=${bias.sampleCount}), ` +
    `correction=${correction > 0 ? '+' : ''}${correction.toFixed(2)}°F, ` +
    `corrected=${corrected.toFixed(1)}°F`
  )

  return corrected
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
  } catch {
    // Best-effort: don't crash if DB write fails
  }
}

// ============================================================================
// Diagnostics
// ============================================================================

/**
 * Get bias summaries for all cities with observations.
 */
export async function getAllCityBiases(): Promise<CityBias[]> {
  const allObs = await tempBias().find().toArray()

  const cities = new Set(allObs.map(o => o.cityCode))
  const biases: CityBias[] = []

  for (const city of cities) {
    const bias = await getCityBias(city)
    if (bias) biases.push(bias)
  }

  return biases.sort((a, b) => a.cityCode.localeCompare(b.cityCode))
}

/**
 * Get raw observation history for a city (for debugging).
 */
export async function getCityObservations(cityCode: string): Promise<TemperatureObservation[]> {
  return await tempBias().find({ cityCode }).toArray() as TemperatureObservation[]
}

/**
 * Clear all bias data (for testing).
 */
export async function clearBiasData(): Promise<void> {
  await tempBias().deleteMany({})
}
