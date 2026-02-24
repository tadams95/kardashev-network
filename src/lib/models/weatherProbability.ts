// Weather probability calculator
// Consensus aggregation and market probability calculations for weather trading

import type { WeatherForecast, WeatherEnsemble, WeatherProbability, EnsembleWeights } from '@/types/weather'
import { calibrateProbability, getCalibrationConfidence } from './calibration'
import type { CalibrationModel } from './calibration'
import { kdeTemperatureProbability, kdeBracketProbability } from './distributions'
import { calculateDynamicWeights, toEnsembleWeights, getSourcePerformance } from './ensembleWeights'

/** All-in fee rate (entry + exit + slippage). Kalshi actual: ~7-12%. */
export const DEFAULT_FEE_RATE = 0.10

// Default ensemble weights (updated for 4-source ensemble)
export const DEFAULT_WEIGHTS: EnsembleWeights = {
  'Open-Meteo': 0.25,      // ECMWF-based, good multi-day skill
  'Google-Weather': 0.20,  // MetNet AI model
  'NWS': 0.35,             // Resolution-aligned: Kalshi resolves on NWS observations
  'METAR': 0.20,           // Ground-truth observations for current conditions
}

/** Sources that produce forward-looking forecasts (excludes ground-truth observations). */
export const FORECAST_SOURCES: ReadonlySet<string> = new Set([
  'Open-Meteo',
  'Google-Weather',
  'NWS',
])

// ============================================================================
// Calibration Model (loaded from historical data)
// ============================================================================

let activeCalibrationModel: CalibrationModel | null = null

/**
 * Set the active calibration model for probability adjustment.
 * Called during initialization with a model trained on historical data.
 */
export function setCalibrationModel(model: CalibrationModel | null): void {
  activeCalibrationModel = model
}

/**
 * Get the current calibration model (for inspection/export).
 */
export function getCalibrationModel(): CalibrationModel | null {
  return activeCalibrationModel
}

/**
 * Apply calibration to a raw probability if a model is available.
 * Falls through to raw probability when no model is loaded.
 */
function applyCalibration(rawProbability: number): number {
  return calibrateProbability(rawProbability, activeCalibrationModel)
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Calculate weighted average of values
 */
function weightedAverage(values: Array<{ value: number; weight: number }>): number {
  const totalWeight = values.reduce((sum, v) => sum + v.weight, 0)
  if (totalWeight === 0) return 0
  return values.reduce((sum, v) => sum + v.value * v.weight, 0) / totalWeight
}

/**
 * Calculate simple average
 */
function average(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

/**
 * Calculate standard deviation
 */
function standardDeviation(values: number[]): number {
  if (values.length === 0) return 0
  const avg = average(values)
  const squareDiffs = values.map(v => Math.pow(v - avg, 2))
  return Math.sqrt(average(squareDiffs))
}

/**
 * Clamp value between min and max
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/**
 * Get normalized forecast weights for an array of forecasts based on DEFAULT_WEIGHTS.
 * Returns an array of weights (summing to 1) aligned with the input forecasts.
 */
function getForecastWeights(forecasts: WeatherForecast[]): number[] {
  const raw = forecasts.map(f => DEFAULT_WEIGHTS[f.source] ?? 0.10)
  const total = raw.reduce((s, w) => s + w, 0)
  if (total === 0) return forecasts.map(() => 1 / forecasts.length)
  return raw.map(w => w / total)
}

/**
 * Natural log of the gamma function using Lanczos approximation
 */
function lnGamma(z: number): number {
  const g = 7
  const c = [
    0.99999999999980993,
    676.5203681218851,
    -1259.1392167224028,
    771.32342877765313,
    -176.61502916214059,
    12.507343278686905,
    -0.13857109526572012,
    9.9843695780195716e-6,
    1.5056327351493116e-7,
  ]

  if (z < 0.5) {
    // Reflection formula
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z)
  }

  z -= 1
  let x = c[0]
  for (let i = 1; i < g + 2; i++) {
    x += c[i] / (z + i)
  }
  const t = z + g + 0.5
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x)
}

/**
 * Lower incomplete gamma function ratio P(a, x) = γ(a,x) / Γ(a)
 * Uses series expansion for small x, continued fraction for large x
 */
function gammaCDF(x: number, shape: number, scale: number): number {
  if (x <= 0) return 0
  const z = x / scale
  return regularizedGammaP(shape, z)
}

function regularizedGammaP(a: number, x: number): number {
  if (x < 0) return 0
  if (x === 0) return 0
  if (x < a + 1) {
    // Series expansion
    let sum = 1 / a
    let term = 1 / a
    for (let n = 1; n < 200; n++) {
      term *= x / (a + n)
      sum += term
      if (Math.abs(term) < 1e-10 * Math.abs(sum)) break
    }
    return sum * Math.exp(-x + a * Math.log(x) - lnGamma(a))
  } else {
    // Continued fraction (Lentz's method)
    return 1 - regularizedGammaQ(a, x)
  }
}

function regularizedGammaQ(a: number, x: number): number {
  // Continued fraction representation
  const maxIter = 200
  const eps = 1e-10

  let f = 1e-30
  let c = 1e-30
  let d = 1 / (x + 1 - a)
  let h = d

  for (let i = 1; i <= maxIter; i++) {
    const an = -i * (i - a)
    const bn = x + 2 * i + 1 - a
    d = bn + an * d
    if (Math.abs(d) < 1e-30) d = 1e-30
    c = bn + an / c
    if (Math.abs(c) < 1e-30) c = 1e-30
    d = 1 / d
    const delta = c * d
    h *= delta
    if (Math.abs(delta - 1) < eps) break
  }

  return Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h
}

/**
 * Error function (erf) using Abramowitz and Stegun approximation
 * Accurate to 1.5e-7
 */
function erf(x: number): number {
  const sign = x >= 0 ? 1 : -1
  x = Math.abs(x)

  // Constants for approximation
  const a1 = 0.254829592
  const a2 = -0.284496736
  const a3 = 1.421413741
  const a4 = -1.453152027
  const a5 = 1.061405429
  const p = 0.3275911

  const t = 1.0 / (1.0 + p * x)
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x)

  return sign * y
}

/**
 * Normal cumulative distribution function (CDF)
 * Returns probability that a normally distributed random variable is less than x
 */
function normalCDF(x: number, mean: number, stdDev: number): number {
  if (stdDev === 0) {
    // Degenerate case: all values are the same
    return x >= mean ? 1 : 0
  }

  const z = (x - mean) / (stdDev * Math.sqrt(2))
  return 0.5 * (1 + erf(z))
}

/**
 * Calculate model agreement based on standard deviation of the relevant variable.
 * Computes between-source disagreement for max temps (HIGH markets),
 * min temps (LOW markets), or precipitation.
 *
 * @param forecasts - Forecasts from different sources
 * @param marketType - Optional: 'high', 'low', or 'precipitation' to select relevant variable
 * @returns Agreement score 0-100
 */
function calculateAgreement(
  forecasts: WeatherForecast[],
  marketType?: 'high' | 'low' | 'precipitation'
): number {
  // Use only forecast sources (exclude ground-truth observations like METAR)
  const forecastsOnly = forecasts.filter(f => FORECAST_SOURCES.has(f.source))

  if (forecastsOnly.length === 0) return 0
  if (forecastsOnly.length === 1) return 100 // Perfect agreement with itself

  // Extract the relevant temperature variable per source (not mixing min/max/current)
  let temps: number[]
  if (marketType === 'low') {
    // For LOW temperature markets, compare min temps across sources
    temps = forecastsOnly
      .map(f => f.temperature.min)
      .filter(t => typeof t === 'number' && !isNaN(t))
  } else {
    // For HIGH temperature markets (default), compare max temps across sources
    temps = forecastsOnly
      .map(f => f.temperature.max)
      .filter(t => typeof t === 'number' && !isNaN(t))
  }

  const tempStdDev = standardDeviation(temps)

  // Precipitation agreement
  const precips = forecastsOnly.map(f => f.precipitation.probability * 100)
  const precipStdDev = standardDeviation(precips)

  // Gentler scaling: 5x instead of 10x (more realistic for multi-source variance)
  // stdDev of 0 = 100% agreement, stdDev of 20°C = 0% agreement
  const tempAgreement = Math.max(0, 100 - tempStdDev * 5)
  const precipAgreement = Math.max(0, 100 - precipStdDev * 2)

  if (marketType === 'precipitation') {
    // For precipitation markets, weight precip agreement more
    const precipAgreementScore = Math.round(tempAgreement * 0.3 + precipAgreement * 0.7)
    // Penalize low source count: fewer sources = less reliable agreement
    if (forecastsOnly.length < 3) {
      return Math.min(precipAgreementScore, 75)
    }
    return precipAgreementScore
  }

  // Temperature markets: weight temperature agreement more
  const agreement = tempAgreement * 0.7 + precipAgreement * 0.3
  // Penalize low source count: fewer sources = less reliable agreement
  if (forecastsOnly.length < 3) {
    return Math.min(Math.round(agreement), 75)
  }
  return Math.round(agreement)
}

// ============================================================================
// Consensus Aggregation
// ============================================================================

/**
 * Build consensus from multiple weather forecasts
 * Aggregates predictions using fixed weights
 *
 * @param forecasts - Array of forecasts from different sources
 * @param weights - Optional custom weights (defaults to spec weights)
 * @returns Consensus predictions with agreement metrics
 */
export function buildConsensus(
  forecasts: WeatherForecast[],
  weights: EnsembleWeights = DEFAULT_WEIGHTS
): WeatherEnsemble['consensus'] {
  if (forecasts.length === 0) {
    throw new Error('Cannot build consensus from empty forecast array')
  }

  // Try dynamic weights — only override if performance data actually exists
  const sources = Array.from(new Set(forecasts.map(f => f.source)))
  const dynamicRaw = calculateDynamicWeights(sources)
  // Check if any source has recorded predictions (not just default weights)
  const hasRealData = sources.some(s => {
    const perf = getSourcePerformance(s)
    return perf.sampleSize > 0
  })
  if (hasRealData) {
    const dynamicWeights = toEnsembleWeights(dynamicRaw)
    const totalDynamic = Object.values(dynamicWeights).reduce<number>((s, v) => s + (v || 0), 0)
    if (totalDynamic > 0) {
      weights = dynamicWeights
      console.log('Using dynamic ensemble weights:', weights)
    }
  }

  console.log(`📊 Building consensus from ${forecasts.length} forecasts`)
  console.log('  Sources:', sources)
  console.log('  Weights:', weights)

  // Calculate weighted precipitation probability
  const precipValues = forecasts.map(f => ({
    value: f.precipitation.probability,
    weight: weights[f.source] || 0,
  }))
  console.log('  Precip values sample:', precipValues.slice(0, 3))
  const precipProbability = weightedAverage(precipValues)
  console.log('  Precip probability:', precipProbability)

  // Calculate temperature range from all sources
  const allTemps = forecasts.flatMap(f => [f.temperature.min, f.temperature.max])
    .filter(t => typeof t === 'number' && !isNaN(t) && t !== null && t !== undefined)

  console.log('  All temps:', allTemps)

  const temperatureRange: [number, number] = allTemps.length > 0 ? [
    Math.min(...allTemps),
    Math.max(...allTemps),
  ] : [0, 0]

  // Calculate weighted mean temperature
  const tempValues = forecasts.map(f => ({
    value: (f.temperature.min + f.temperature.max) / 2,
    weight: weights[f.source] || 0,
  })).filter(v => typeof v.value === 'number' && !isNaN(v.value))

  const temperatureMean = weightedAverage(tempValues)

  // Calculate model agreement
  const modelAgreement = calculateAgreement(forecasts)
  console.log('  Model agreement:', modelAgreement)

  // Calculate data quality (freshness + confidence)
  const avgDataAge = average(forecasts.map(f => f.dataAge))
  const avgConfidence = average(forecasts.map(f => f.confidence))

  // Data quality: penalize stale data (>6h) and low confidence (<70)
  let dataQuality = 100
  if (avgDataAge > 6 * 3600000) dataQuality *= 0.90 // >6 hours old
  if (avgConfidence < 70) dataQuality *= 0.85      // Low confidence sources
  if (forecasts.length < 3) dataQuality *= 0.90    // Fewer than 3 sources

  const result = {
    temperatureRange,
    temperatureMean,
    precipProbability,
    modelAgreement,
    dataQuality: Math.round(dataQuality),
  }
  console.log('  Consensus result:', result)

  return result
}

// ============================================================================
// Temperature Probability Calculation
// ============================================================================

/**
 * Calculate dynamic standard deviation floor based on forecast quality.
 *
 * Predictive RMSE for max temperature (from GFS/ECMWF verification):
 *   Day 0 (<24h):  0.6-0.8°C single-model + representativity → ~1.0°C predictive
 *   Day 1 (24-48h): 1.1-1.7°C single-model → ~1.4°C predictive
 *   Day 1.5 (36-48h): ~1.8°C predictive
 *   Day 2+ (48h+): 2.2-3.0°C → ~2.2°C predictive
 *
 * Multi-source agreement reduces conditional mean error ~30%, but the predictive
 * distribution must also include within-model variance, representativity error
 * (~0.3°C), and observation error (~0.2°C). Correlated NWP sources (GFS/ECMWF
 * shared inputs) understate true uncertainty when they agree tightly.
 * Hard minimum 0.7°C = irreducible predictive uncertainty floor.
 */
export function calculateDynamicStdDevFloor(
  forecastSourceCount: number,
  agreementScore: number,
  hoursToResolution: number
): number {
  // Lead-time based floor from NWP predictive RMSE (not just mean-estimation RMSE)
  let baseFloor: number
  if (hoursToResolution <= 18) baseFloor = 1.0        // Same-day: 0.6-0.8 model + representativity
  else if (hoursToResolution <= 30) baseFloor = 1.4   // Today→tomorrow: day-1 NWP RMSE
  else if (hoursToResolution <= 42) baseFloor = 1.8   // Tomorrow: day-1.5 NWP RMSE
  else baseFloor = 2.2                                 // Day 2+: day-2 NWP RMSE

  // Source count: 3+ sources = 15% reduction, 1 source = 30% increase
  const sourceMultiplier = forecastSourceCount >= 3 ? 0.85
    : forecastSourceCount === 2 ? 1.0
    : 1.3

  // Agreement: >80% = sources in predictable regime → reduce up to 25%
  //            <50% = genuine uncertainty → increase up to 40%
  const af = agreementScore / 100
  const agreementMultiplier = af >= 0.8
    ? 0.75 + 0.25 * (1.0 - af) / 0.2    // 0.75 at 100%, 1.0 at 80%
    : af >= 0.5 ? 1.0
    : 1.0 + 0.4 * (0.5 - af) / 0.5      // 1.0 at 50%, 1.4 at 0%

  return Math.max(0.7, Math.min(3.0, baseFloor * sourceMultiplier * agreementMultiplier))
}

/**
 * Calculate probability of temperature exceeding/falling below threshold
 * Uses normal distribution assumption around consensus mean
 *
 * @param ensemble - Weather ensemble with multiple forecasts
 * @param threshold - Temperature threshold in same units as forecasts
 * @param direction - 'above' or 'below' threshold
 * @returns Probability calculation with confidence metrics
 */
export function calculateTemperatureProbability(
  ensemble: WeatherEnsemble,
  threshold: number,
  direction: 'above' | 'below',
  temperatureType: 'high' | 'low' = 'high',
  biasCorrection = 0
): WeatherProbability {
  if (ensemble.forecasts.length === 0) {
    throw new Error('Cannot calculate probability from empty ensemble')
  }

  // Extract temperatures from forecast sources only (exclude ground-truth observations)
  // Use min temperatures for LOW markets, max temperatures for HIGH markets
  const useMin = temperatureType === 'low'
  const forecastsOnly = ensemble.forecasts.filter(f => FORECAST_SOURCES.has(f.source))
  const filteredForecasts = forecastsOnly.filter(f => {
    const temp = useMin ? f.temperature.min : f.temperature.max
    return typeof temp === 'number' && !isNaN(temp)
  })
  const forecastWeights = getForecastWeights(filteredForecasts)
  const maxTemps = filteredForecasts.map(f => useMin ? f.temperature.min : f.temperature.max)

  // Apply bias correction to ensemble temperatures (shift in °C)
  const correctedTemps = maxTemps.map(t => t + biasCorrection)

  // Calculate weighted mean and standard deviation using bias-corrected temps
  const mean = correctedTemps.reduce((s, t, i) => s + t * forecastWeights[i], 0)
  const rawStdDev = Math.sqrt(correctedTemps.reduce((s, t, i) => s + forecastWeights[i] * (t - mean) ** 2, 0))

  // Dynamic stdDev floor based on lead time, source count, and agreement
  const hoursToRes = ensemble.hoursToResolution ?? 36
  const MIN_STD_DEV = calculateDynamicStdDevFloor(maxTemps.length, ensemble.consensus.modelAgreement, hoursToRes)
  const stdDev = Math.max(rawStdDev, MIN_STD_DEV)

  // Calculate raw probability
  // Use KDE when we have 3+ samples (handles bimodal/fat-tail distributions)
  // Fall back to normal CDF for fewer samples
  let probability: number
  if (correctedTemps.length >= 3) {
    probability = kdeTemperatureProbability(correctedTemps, threshold, direction, undefined, forecastWeights, MIN_STD_DEV)
  } else if (direction === 'above') {
    probability = 1 - normalCDF(threshold, mean, stdDev)
  } else {
    probability = normalCDF(threshold, mean, stdDev)
  }

  // Blend with base-rate prior to prevent extreme concentration
  // Climatological base rate for any single threshold is roughly 50% (symmetric)
  // MODEL_WEIGHT=0.95: the KDE with minBandwidth now carries proper NWP uncertainty,
  // so we need much less base-rate blending. This reduces the artificial floor from
  // ~7.5% to ~2.5%, consistent with bracket-style MODEL_WEIGHT=0.92.
  const BASE_RATE = 0.50
  const MODEL_WEIGHT = 0.95
  probability = MODEL_WEIGHT * probability + (1 - MODEL_WEIGHT) * BASE_RATE

  // Adjust probability based on model agreement — only when agreement is genuinely low
  const agreementFactor = ensemble.consensus.modelAgreement / 100
  let adjusted = probability
  if (agreementFactor < 0.6) {
    const shrinkage = 0.5 + 0.5 * (agreementFactor / 0.6)
    adjusted = 0.5 + (probability - 0.5) * shrinkage
  }

  // Apply isotonic calibration if model is available
  const calibrated = applyCalibration(adjusted)

  // FA-09: Safety clamp [0.02, 0.95] is an intentional tail bound.
  // This prevents the model from asserting near-certainty. Markets priced
  // at extremes (e.g. 0.01) would create artificial 1¢ edges after clamping,
  // but the minEdge filter (15%) already screens out those markets — so the
  // clamp has no practical impact on generated signals.
  const clampedProbability = clamp(calibrated, 0.02, 0.95)

  return {
    outcome: `temperature ${direction} ${threshold}°C`,
    probability: clampedProbability,
    confidence: ensemble.consensus.modelAgreement,
    sources: ensemble.forecasts,
    calculatedAt: Date.now(),
    reasoning: `Based on ${maxTemps.length} sources (mean: ${mean.toFixed(1)}°, stdDev: ${stdDev.toFixed(1)}° [floor: ${MIN_STD_DEV}°])`,
  }
}

// ============================================================================
// Between-Bracket Probability Calculation
// ============================================================================

/**
 * Calculate probability that temperature falls within a bracket [floorStrike, capStrike)
 * P(floor <= T < cap) = normalCDF(cap, mean, stdDev) - normalCDF(floor, mean, stdDev)
 *
 * @param ensemble - Weather ensemble with multiple forecasts
 * @param floorStrike - Lower bound of bracket (°C)
 * @param capStrike - Upper bound of bracket (°C)
 * @returns Probability calculation with confidence metrics
 */
export function calculateBracketProbability(
  ensemble: WeatherEnsemble,
  floorStrike: number,
  capStrike: number,
  temperatureType: 'high' | 'low' = 'high',
  biasCorrection = 0
): WeatherProbability {
  if (ensemble.forecasts.length === 0) {
    throw new Error('Cannot calculate probability from empty ensemble')
  }

  // Extract temperatures from forecast sources only (exclude ground-truth observations)
  // Use min temperatures for LOW markets, max temperatures for HIGH markets
  const useMin = temperatureType === 'low'
  const forecastsOnly = ensemble.forecasts.filter(f => FORECAST_SOURCES.has(f.source))
  const filteredForecasts = forecastsOnly.filter(f => {
    const temp = useMin ? f.temperature.min : f.temperature.max
    return typeof temp === 'number' && !isNaN(temp)
  })
  const forecastWeights = getForecastWeights(filteredForecasts)
  const maxTemps = filteredForecasts.map(f => useMin ? f.temperature.min : f.temperature.max)

  // Apply bias correction to ensemble temperatures (shift in °C)
  const correctedTemps = maxTemps.map(t => t + biasCorrection)

  const mean = correctedTemps.reduce((s, t, i) => s + t * forecastWeights[i], 0)
  const rawStdDev = Math.sqrt(correctedTemps.reduce((s, t, i) => s + forecastWeights[i] * (t - mean) ** 2, 0))

  // Dynamic stdDev floor based on lead time, source count, and agreement
  const hoursToRes = ensemble.hoursToResolution ?? 36
  const MIN_STD_DEV = calculateDynamicStdDevFloor(maxTemps.length, ensemble.consensus.modelAgreement, hoursToRes)
  const stdDev = Math.max(rawStdDev, MIN_STD_DEV)

  // P(floor <= T < cap)
  // Use KDE for 3+ samples, normal CDF otherwise
  let probability: number
  if (correctedTemps.length >= 3) {
    probability = kdeBracketProbability(correctedTemps, floorStrike, capStrike, undefined, forecastWeights, MIN_STD_DEV)
  } else {
    probability = normalCDF(capStrike, mean, stdDev) - normalCDF(floorStrike, mean, stdDev)
  }

  // Blend with uniform base rate for this bracket width
  const bracketWidth = capStrike - floorStrike
  // Uniform prior: bracket share of typical ~15°C forecast range
  const uniformPrior = clamp(bracketWidth / 15.0, 0.02, 0.30)
  // Dynamic stdDev floor is now the primary uncertainty mechanism;
  // lighter blending avoids double-counting
  const MODEL_WEIGHT = 0.92
  probability = MODEL_WEIGHT * probability + (1 - MODEL_WEIGHT) * uniformPrior

  // Adjust probability based on model agreement — only when agreement is genuinely low
  const agreementFactor = ensemble.consensus.modelAgreement / 100
  let adjusted = probability
  if (agreementFactor < 0.6) {
    // Low agreement: regress toward the uniform prior (not 0.5 — 50% is wrong for brackets)
    const shrinkage = 0.5 + 0.5 * (agreementFactor / 0.6)  // 0.5-1.0
    adjusted = uniformPrior + (probability - uniformPrior) * shrinkage
  }

  // Apply isotonic calibration if model is available
  const calibrated = applyCalibration(adjusted)

  // FA-09: Safety clamp — see comment in calculateTemperatureProbability
  const clampedProbability = clamp(calibrated, 0.02, 0.95)

  return {
    outcome: `temperature ${floorStrike}° to ${capStrike}°C`,
    probability: clampedProbability,
    confidence: ensemble.consensus.modelAgreement,
    sources: ensemble.forecasts,
    calculatedAt: Date.now(),
    reasoning: `Based on ${maxTemps.length} sources (mean: ${mean.toFixed(1)}°, stdDev: ${stdDev.toFixed(1)}° [floor: ${MIN_STD_DEV}°])`,
  }
}

// ============================================================================
// Precipitation Probability Calculation
// ============================================================================

/**
 * Estimate gamma distribution parameters from precipitation amount data.
 * Uses method of moments: shape = (mean/stdDev)^2, scale = variance/mean
 * Falls back to climatological prior when data is insufficient.
 */
function estimateGammaParams(amounts: number[]): { shape: number; scale: number } {
  // Filter to positive amounts (gamma distribution is defined for x > 0)
  const positive = amounts.filter(a => a > 0)

  if (positive.length < 2) {
    // Climatological prior: typical US rainfall distribution
    // Shape ~0.5-1.0 (highly skewed), scale ~0.2-0.5 inches
    return { shape: 0.7, scale: 0.3 }
  }

  const mean = positive.reduce((s, v) => s + v, 0) / positive.length
  const variance = positive.reduce((s, v) => s + (v - mean) ** 2, 0) / positive.length

  if (variance === 0 || mean === 0) {
    return { shape: 0.7, scale: 0.3 }
  }

  const shape = (mean * mean) / variance
  const scale = variance / mean

  // Clamp to reasonable ranges
  return {
    shape: clamp(shape, 0.1, 10),
    scale: clamp(scale, 0.01, 5),
  }
}

/**
 * Calculate probability of precipitation exceeding threshold
 * Uses precipitation amounts from forecasts and a gamma distribution model
 * (precipitation is right-skewed, not normally distributed)
 *
 * P(precip > threshold) is computed as:
 *   P(rain occurs) * P(amount > threshold | rain occurs)
 *
 * @param ensemble - Weather ensemble with multiple forecasts
 * @param threshold - Precipitation threshold in same units as forecasts (inches)
 * @returns Probability calculation with confidence metrics
 */
export function calculatePrecipitationProbability(
  ensemble: WeatherEnsemble,
  threshold: number
): WeatherProbability {
  if (ensemble.forecasts.length === 0) {
    throw new Error('Cannot calculate probability from empty ensemble')
  }

  // Extract precipitation amounts and occurrence probabilities from all forecasts
  const precipAmounts = ensemble.forecasts
    .map(f => f.precipitation.amount)
    .filter(a => typeof a === 'number' && !isNaN(a))

  const precipProbs = ensemble.forecasts
    .map(f => f.precipitation.probability)
    .filter(p => typeof p === 'number' && !isNaN(p))

  // P(rain occurs) — weighted consensus probability of any precipitation
  const pRainOccurs = ensemble.consensus.precipProbability

  let probability: number

  if (threshold <= 0.01) {
    // "Any rain" market — just use occurrence probability directly
    probability = pRainOccurs
  } else if (precipAmounts.length === 0) {
    // No amount data — fall back to heuristic based on occurrence probability and threshold
    // Higher thresholds are exponentially less likely
    const thresholdPenalty = Math.exp(-threshold * 2)
    probability = pRainOccurs * thresholdPenalty
  } else {
    // Fit gamma distribution to precipitation amounts
    const { shape, scale } = estimateGammaParams(precipAmounts)

    // P(amount > threshold | rain occurs) = 1 - GammaCDF(threshold, shape, scale)
    const pExceedsGivenRain = 1 - gammaCDF(threshold, shape, scale)

    // Joint probability: P(rain) * P(amount > threshold | rain)
    probability = pRainOccurs * pExceedsGivenRain
  }

  // Adjust for data quality
  const dataQualityFactor = ensemble.consensus.dataQuality / 100
  const adjusted = probability * dataQualityFactor

  // Apply isotonic calibration if model is available
  const calibrated = applyCalibration(adjusted)

  // Clamp to valid probability range
  const clampedProbability = clamp(calibrated, 0.02, 0.95)

  const meanAmount = precipAmounts.length > 0
    ? precipAmounts.reduce((s, v) => s + v, 0) / precipAmounts.length
    : 0

  return {
    outcome: `precipitation > ${threshold} inches`,
    probability: clampedProbability,
    confidence: ensemble.consensus.modelAgreement,
    sources: ensemble.forecasts,
    calculatedAt: Date.now(),
    reasoning: `Based on ${ensemble.forecasts.length} sources (P(rain)=${(pRainOccurs * 100).toFixed(0)}%, mean amount=${meanAmount.toFixed(2)}in, threshold=${threshold}in)`,
  }
}

/**
 * Calculate probability that precipitation falls within a bracket [floor, cap)
 * P(floor <= precip < cap) using the gamma distribution model
 */
export function calculatePrecipitationBracketProbability(
  ensemble: WeatherEnsemble,
  floorThreshold: number,
  capThreshold: number
): WeatherProbability {
  if (ensemble.forecasts.length === 0) {
    throw new Error('Cannot calculate probability from empty ensemble')
  }

  const precipAmounts = ensemble.forecasts
    .map(f => f.precipitation.amount)
    .filter(a => typeof a === 'number' && !isNaN(a))

  const pRainOccurs = ensemble.consensus.precipProbability

  let probability: number

  if (precipAmounts.length === 0) {
    // Heuristic fallback
    const pAboveFloor = floorThreshold <= 0.01 ? pRainOccurs : pRainOccurs * Math.exp(-floorThreshold * 2)
    const pAboveCap = pRainOccurs * Math.exp(-capThreshold * 2)
    probability = pAboveFloor - pAboveCap
  } else {
    const { shape, scale } = estimateGammaParams(precipAmounts)

    // P(floor <= amount < cap | rain) = GammaCDF(cap) - GammaCDF(floor)
    const pBelowCap = gammaCDF(capThreshold, shape, scale)
    const pBelowFloor = floorThreshold <= 0 ? 0 : gammaCDF(floorThreshold, shape, scale)
    const pInBracketGivenRain = pBelowCap - pBelowFloor

    // Handle the "no rain" case: if floor is 0, no-rain counts as "in bracket"
    if (floorThreshold <= 0.01) {
      probability = (1 - pRainOccurs) + pRainOccurs * pInBracketGivenRain
    } else {
      probability = pRainOccurs * pInBracketGivenRain
    }
  }

  const dataQualityFactor = ensemble.consensus.dataQuality / 100
  const adjusted = probability * dataQualityFactor

  // Apply isotonic calibration if model is available
  const calibrated = applyCalibration(adjusted)

  const clampedProbability = clamp(calibrated, 0.02, 0.95)

  return {
    outcome: `precipitation ${floorThreshold}" to ${capThreshold}"`,
    probability: clampedProbability,
    confidence: ensemble.consensus.modelAgreement,
    sources: ensemble.forecasts,
    calculatedAt: Date.now(),
    reasoning: `Based on ${ensemble.forecasts.length} sources (bracket ${floorThreshold}"-${capThreshold}")`,
  }
}

// ============================================================================
// Data Quality Discount
// ============================================================================

/**
 * Apply data quality discount to probability
 * Penalizes stale data, low confidence, and missing sources
 *
 * @param probability - Raw probability (0-1)
 * @param forecasts - Source forecasts
 * @returns Adjusted probability
 */
export function applyDataQualityDiscount(
  probability: number,
  forecasts: WeatherForecast[]
): number {
  let discount = 1.0

  // Stale data penalty (>6 hours old)
  const avgAge = average(forecasts.map(f => f.dataAge))
  if (avgAge > 6 * 3600000) {
    discount *= 0.95
  }

  // Very stale data penalty (>12 hours old)
  if (avgAge > 12 * 3600000) {
    discount *= 0.90
  }

  // Low source count penalty (<3 sources)
  if (forecasts.length < 3) {
    discount *= 0.92
  }

  // Only 1 source penalty
  if (forecasts.length === 1) {
    discount *= 0.85
  }

  // Low confidence penalty (<70 average)
  const avgConfidence = average(forecasts.map(f => f.confidence))
  if (avgConfidence < 70) {
    discount *= 0.90
  }

  return probability * discount
}

// ============================================================================
// 12-Hour Buffer Rule Enforcement
// ============================================================================

/**
 * Check if trading is allowed given time to market resolution
 * Per spec: Never trade within 12 hours of market resolution (data revision risk)
 *
 * @param hoursToResolution - Hours until market resolves
 * @returns Whether trading is allowed
 */
export function isTradingAllowed(hoursToResolution: number): boolean {
  const BUFFER_HOURS = 12
  return hoursToResolution > BUFFER_HOURS
}

/**
 * Calculate time-based confidence discount
 * Reflects NWP skill curve: 24-48h forecasts are nearly as good as 36h.
 * Plateau at 100% from 48h→18h, then linear decay 18h→12h.
 *
 * @param hoursToResolution - Hours until market resolves
 * @returns Confidence multiplier (0-1)
 */
export function getTimeBasedDiscount(hoursToResolution: number): number {
  if (hoursToResolution <= 12) return 0   // No trading allowed
  if (hoursToResolution >= 18) return 1   // Full confidence (18h-48h+ plateau)

  // Linear decay from 18h (100%) to 12h (0%)
  return (hoursToResolution - 12) / (18 - 12)
}

// ============================================================================
// Edge Detection
// ============================================================================

/**
 * Calculate trading edge (model probability vs market price)
 *
 * @param modelProbability - Our model's probability (0-1)
 * @param marketPrice - Market's current price (0-1)
 * @param minEdge - Minimum edge required for trade (default: 0.15 per spec)
 * @returns Whether edge meets threshold and edge value
 */
export function calculateEdge(
  modelProbability: number,
  marketPrice: number,
  minEdge = 0.15
): { hasEdge: boolean; edge: number; direction: 'YES' | 'NO' } {
  const edge = Math.abs(modelProbability - marketPrice)
  const direction = modelProbability > marketPrice ? 'YES' : 'NO'

  return {
    hasEdge: edge >= minEdge,
    edge,
    direction,
  }
}

/**
 * Calculate expected value of a trade
 * EV = (Win Probability × Win Amount) - (Loss Probability × Loss Amount)
 *
 * @param modelProbability - Our model's probability (0-1)
 * @param marketPrice - Market's current price (0-1)
 * @param positionSize - Dollar amount to bet
 * @param fees - Transaction fees as decimal (default: DEFAULT_FEE_RATE)
 * @returns Expected profit/loss
 */
export function calculateExpectedValue(
  modelProbability: number,
  marketPrice: number,
  positionSize: number,
  fees = DEFAULT_FEE_RATE
): number {
  // Bet YES if model thinks it's more likely than market
  if (modelProbability > marketPrice) {
    // Win: pay marketPrice, receive $1, keep (1 - marketPrice - fees)
    const winAmount = (1 - marketPrice) * (1 - fees)
    // Loss: lose marketPrice
    const lossAmount = marketPrice

    return (modelProbability * winAmount - (1 - modelProbability) * lossAmount) * positionSize
  } else {
    // Bet NO if model thinks it's less likely than market
    // Win: pay (1 - marketPrice), receive $1, keep (marketPrice - fees)
    const winAmount = marketPrice * (1 - fees)
    // Loss: lose (1 - marketPrice)
    const lossAmount = 1 - marketPrice

    return ((1 - modelProbability) * winAmount - modelProbability * lossAmount) * positionSize
  }
}

// ============================================================================
// Kelly Criterion Position Sizing
// ============================================================================

/**
 * Calculate optimal position size using Dynamic Kelly Criterion.
 * Scales Kelly fraction by:
 * - Calibration confidence (how well-calibrated the model is)
 * - Agreement factor (how much sources agree)
 *
 * fraction = baseFraction * calibrationConfidence * agreementFactor
 * Position capped at 10% of bankroll and 10% of market open interest.
 *
 * @param modelProbability - Our model's probability (0-1)
 * @param marketPrice - Market's current price (0-1)
 * @param bankroll - Total available bankroll
 * @param baseFraction - Base Kelly fraction (0.25 = 25% Kelly, default)
 * @param agreementScore - Model agreement (0-100, default: 75)
 * @param marketOpenInterest - Optional: market open interest to cap position
 * @returns Recommended position size in dollars
 */
export function calculateKellyPosition(
  modelProbability: number,
  marketPrice: number,
  bankroll: number,
  baseFraction = 0.25,
  agreementScore = 75,
  marketOpenInterest?: number
): number {
  // Guard against boundary prices that would cause division by zero
  if (marketPrice <= 0 || marketPrice >= 1 || modelProbability <= 0 || modelProbability >= 1) {
    return 0
  }

  // Dynamic Kelly: scale fraction by calibration confidence and agreement
  const calibrationConf = getCalibrationConfidence(activeCalibrationModel)
  const agreementFactor = Math.max(0.3, agreementScore / 100)
  const dynamicFraction = baseFraction * calibrationConf * agreementFactor

  // Determine if betting YES or NO
  const bettingYes = modelProbability > marketPrice

  let kellyFraction: number

  if (bettingYes) {
    // Fee-adjusted net odds for YES bet: win (1-price)*(1-fee), risk price
    const bEff = ((1 - marketPrice) * (1 - DEFAULT_FEE_RATE)) / marketPrice
    kellyFraction = (bEff * modelProbability - (1 - modelProbability)) / bEff
  } else {
    // Fee-adjusted net odds for NO bet: win price*(1-fee), risk (1-price)
    const bEff = (marketPrice * (1 - DEFAULT_FEE_RATE)) / (1 - marketPrice)
    kellyFraction = (bEff * (1 - modelProbability) - modelProbability) / bEff
  }

  // Never bet when Kelly is non-positive (no edge after fees)
  if (kellyFraction <= 0) return 0

  // Apply dynamic fractional Kelly
  const fractionalKelly = kellyFraction * dynamicFraction

  // Calculate position size (capped at 10% of bankroll per trade)
  let positionSize = Math.min(
    fractionalKelly * bankroll,
    bankroll * 0.10
  )

  // Cap at 10% of market open interest (if available)
  if (marketOpenInterest && marketOpenInterest > 0) {
    positionSize = Math.min(positionSize, marketOpenInterest * 0.10)
  }

  return positionSize
}

// ============================================================================
// Ensemble Builder Helper
// ============================================================================

/**
 * Build WeatherEnsemble from multiple forecast arrays
 * Convenience function to aggregate all sources
 *
 * @param openMeteo - Open-Meteo forecasts
 * @param googleWeather - Google Weather forecasts
 * @param metar - METAR observation
 * @param location - Location metadata
 * @param nws - Optional NWS forecasts (4th source)
 * @returns Complete WeatherEnsemble
 */
export function buildEnsemble(
  openMeteo: WeatherForecast[],
  googleWeather: WeatherForecast[],
  metar: WeatherForecast | null,
  location: { lat: number; lng: number; city?: string },
  nws: WeatherForecast[] = []
): WeatherEnsemble {
  // Combine all forecasts
  const forecasts: WeatherForecast[] = [
    ...openMeteo,
    ...googleWeather,
    ...(metar ? [metar] : []),
    ...nws,
  ]

  if (forecasts.length === 0) {
    throw new Error('Cannot build ensemble with no forecasts')
  }

  // Build consensus from CURRENT forecasts only (one per source)
  // FA-03: Instead of blindly taking [0] from each source (which mixes temporal
  // semantics — Open-Meteo [0] is a current obs, Google/NWS [0] may be a daily
  // aggregate), find the nearest hourly/current forecast per source.
  const currentForecasts: WeatherForecast[] = []
  const now = Date.now()

  function pickCurrentForecast(sourceForecasts: WeatherForecast[]): WeatherForecast | null {
    if (sourceForecasts.length === 0) return null
    // Prefer hourly/current entries (min === max) closest to now
    const hourly = sourceForecasts.filter(f => f.temperature.min === f.temperature.max)
    if (hourly.length > 0) {
      // Find the one closest to current time
      return hourly.reduce((best, f) => {
        const bestDist = Math.abs(new Date(best.timestamp).getTime() - now)
        const fDist = Math.abs(new Date(f.timestamp).getTime() - now)
        return fDist < bestDist ? f : best
      })
    }
    // No hourly data — fall back to first daily aggregate
    return sourceForecasts[0]
  }

  const omPick = pickCurrentForecast(openMeteo)
  if (omPick) currentForecasts.push(omPick)
  const gwPick = pickCurrentForecast(googleWeather)
  if (gwPick) currentForecasts.push(gwPick)
  if (metar) currentForecasts.push(metar)
  const nwsPick = pickCurrentForecast(nws)
  if (nwsPick) currentForecasts.push(nwsPick)

  console.log(`🔧 Building ensemble with ${forecasts.length} total forecasts, ${currentForecasts.length} current forecasts for consensus`)
  console.log('  Current forecasts:', currentForecasts.map(f => ({ source: f.source, temp: f.temperature.current, precip: f.precipitation.probability })))

  const consensus = buildConsensus(currentForecasts)

  // Extract unique sources
  const sources = Array.from(new Set(forecasts.map(f => f.source)))

  return {
    location,
    forecasts,
    consensus,
    sources,
    timestamp: Date.now(),
  }
}
