// Per-city temperature bias tracking and correction
// Tracks forecast-vs-actual errors and applies additive corrections
// Uses JSONL persistence (same pattern as performanceTracker.ts)

import fs from 'fs'
import path from 'path'

// ============================================================================
// Configuration
// ============================================================================

const BIAS_LOG_PATH = path.join(process.cwd(), 'data', 'weather', 'temp_bias.jsonl')
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
// File Persistence
// ============================================================================

function ensureDir(): void {
  const dir = path.dirname(BIAS_LOG_PATH)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function appendObservationToDisk(obs: TemperatureObservation): void {
  try {
    ensureDir()
    fs.appendFileSync(BIAS_LOG_PATH, JSON.stringify(obs) + '\n')
  } catch {
    // Best-effort: don't crash if disk write fails
  }
}

// ============================================================================
// In-Memory Store
// ============================================================================

const observationStore: TemperatureObservation[] = []
let loadedFromDisk = false

function loadObservationsFromDisk(): void {
  if (loadedFromDisk) return
  loadedFromDisk = true
  try {
    if (!fs.existsSync(BIAS_LOG_PATH)) return
    const content = fs.readFileSync(BIAS_LOG_PATH, 'utf-8').trim()
    if (!content) return
    for (const line of content.split('\n')) {
      if (!line.trim()) continue
      const obs = JSON.parse(line) as TemperatureObservation
      observationStore.push(obs)
    }
  } catch {
    // Best-effort: if file is corrupt, start fresh
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
export function getCityBias(cityCode: string): CityBias | null {
  loadObservationsFromDisk()

  const cityObs = observationStore.filter(o => o.cityCode === cityCode)
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
    lastUpdated: cityObs[cityObs.length - 1].timestamp,
  }
}

/**
 * Apply per-city bias correction to a raw forecast temperature.
 * Subtracts the mean error (negative error = cool bias → adds warmth).
 * Returns the raw forecast unchanged if insufficient data.
 */
export function applyCityBiasCorrection(
  rawForecastF: number,
  cityCode: string
): number {
  const bias = getCityBias(cityCode)
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
export function recordTemperatureObservation(
  cityCode: string,
  forecastTemp: number,
  actualTemp: number,
  sources?: string[]
): void {
  loadObservationsFromDisk()

  const obs: TemperatureObservation = {
    cityCode,
    forecastTemp,
    actualTemp,
    error: forecastTemp - actualTemp,
    timestamp: Date.now(),
    sources,
  }

  observationStore.push(obs)
  appendObservationToDisk(obs)
}

// ============================================================================
// Diagnostics
// ============================================================================

/**
 * Get bias summaries for all cities with observations.
 */
export function getAllCityBiases(): CityBias[] {
  loadObservationsFromDisk()

  const cities = new Set(observationStore.map(o => o.cityCode))
  const biases: CityBias[] = []

  for (const city of cities) {
    const bias = getCityBias(city)
    if (bias) biases.push(bias)
  }

  return biases.sort((a, b) => a.cityCode.localeCompare(b.cityCode))
}

/**
 * Get raw observation history for a city (for debugging).
 */
export function getCityObservations(cityCode: string): TemperatureObservation[] {
  loadObservationsFromDisk()
  return observationStore.filter(o => o.cityCode === cityCode)
}

/**
 * Clear all bias data (for testing).
 */
export function clearBiasData(): void {
  observationStore.length = 0
  loadedFromDisk = false
  try {
    if (fs.existsSync(BIAS_LOG_PATH)) {
      fs.unlinkSync(BIAS_LOG_PATH)
    }
  } catch {
    // Best-effort
  }
}
