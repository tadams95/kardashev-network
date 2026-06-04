// Weather probability calculator
// Consensus aggregation and market probability calculations for weather trading

import type { WeatherForecast, WeatherEnsemble, WeatherProbability, EnsembleWeights } from '@/types/weather'
import { calibrateProbability, getCalibrationConfidence } from './calibration'
import type { CalibrationModel } from './calibration'
import {
  selectCalibrationModel,
  toCalibrationLeadBucket,
  isCalibrationModelBundle,
} from './calibration'
import type {
  CalibrationModelBundle,
  CalibrationMarketType,
} from './calibration'

/** All-in fee rate (entry + exit + slippage). Kalshi actual: ~7-12%. */
export const DEFAULT_FEE_RATE = 0.10

// Default ensemble weights (5 forecast sources, normalized to 1.0)
// Tier 1 heavy: Brier audit (2026-03-13) showed Tier 2 sources (RMSE 4-6°F)
// drag ensemble mean worse than best individual source. Tier 1 emphasis
// narrows the KDE distribution in the competitive 20-50¢ price range.
export const DEFAULT_WEIGHTS: EnsembleWeights = {
  'NWS': 0.37,             // Tier 1: MAE 1.75°F (926 clean-era obs)
  'AccuWeather': 0.33,     // Tier 1: MAE 2.28°F (928 clean-era obs)
  'Open-Meteo': 0.13,      // Tier 2: MAE 2.21°F (897 clean-era obs)
  'Tomorrow.io': 0.13,     // Tier 2: MAE 2.35°F (820 clean-era obs)
  'Google-Weather': 0.04,  // Tier 3: MAE 3.19°F, worst 37% of time, bias -2.96°F
}

// Uniform weights for threshold brackets (Item B4: MAEs bunched 4.35-4.93°F, 13% spread)
// Source rankings reverse between inner and threshold regimes — NWS drops from best to worst,
// GW rises from worst to best. Uniform weights maximize diversity against correlated NWP errors.
export const THRESHOLD_WEIGHTS: EnsembleWeights = {
  'NWS': 0.20,
  'AccuWeather': 0.20,
  'Open-Meteo': 0.20,
  'Tomorrow.io': 0.20,
  'Google-Weather': 0.20,
}

// Low-temperature ensemble weights (Apr 23 corpus, 2,122 obs, decayed MAE-based).
// Source ranking REVERSES vs high-temp regime — GW best, NWS/AW worst.
// Distribution flattened to 1.7× top-to-bottom ratio (vs 9× for high-temp) because
// the n=2,122 sample showed less spread than the original n=790 Apr 5 estimate.
// Decayed MAE: GW 2.41°F, TI 2.89°F, OM 3.12°F, NWS 4.10°F, AW 4.36°F.
//
// Currently dormant: only consumed when LOW_TEMP_SIGNAL_GENERATION_ENABLED is true
// (Deploy 3 ships infrastructure with kill switch OFF). Per-bucket recomputation is
// the next refinement once shadow validation begins.
export const DEFAULT_WEIGHTS_LOW: EnsembleWeights = {
  'Google-Weather': 0.257,  // Best low-temp source: MAE 2.41°F
  'Tomorrow.io': 0.220,
  'Open-Meteo': 0.207,
  'NWS': 0.162,
  'AccuWeather': 0.154,     // Worst low-temp source: MAE 4.36°F (reversed from high-temp)
}

/** Bracket regime for σ and weight selection */
export type BracketRegime = 'inner' | 'threshold'

/** Sources that produce forward-looking forecasts (excludes ground-truth observations). */
export const FORECAST_SOURCES: ReadonlySet<string> = new Set([
  'Open-Meteo',
  'Google-Weather',
  'NWS',
  'AccuWeather',
  'Tomorrow.io',
])

/** Forecast-only weights: DEFAULT_WEIGHTS minus METAR (ground-truth obs excluded from consensus). */
export const FORECAST_WEIGHTS: Record<string, number> = Object.fromEntries(
  Object.entries(DEFAULT_WEIGHTS).filter(([source]) => FORECAST_SOURCES.has(source))
) as Record<string, number>

// ============================================================================
// Calibration Model (loaded from historical data)
// ============================================================================

let activeCalibrationModel: CalibrationModel | CalibrationModelBundle | null = null

/**
 * Set the active calibration model for probability adjustment.
 * Called during initialization with a model trained on historical data.
 */
export function setCalibrationModel(model: CalibrationModel | CalibrationModelBundle | null): void {
  activeCalibrationModel = model
}

/**
 * Get the current calibration model (for inspection/export).
 */
export function getCalibrationModel(): CalibrationModel | CalibrationModelBundle | null {
  return activeCalibrationModel
}

/** Returns true if a calibration model has been loaded into this module instance. */
export function isCalibrationModelLoaded(): boolean {
  return activeCalibrationModel !== null
}

/**
 * Apply calibration to a raw probability if a model is available.
 * Falls through to raw probability when no model is loaded.
 */
export function applyCalibration(
  rawProbability: number,
  context?: { marketType?: CalibrationMarketType; hoursToResolution?: number }
): { calibrated: number; modelId: string } {
  const leadBucket = context?.hoursToResolution != null
    ? toCalibrationLeadBucket(context.hoursToResolution)
    : undefined

  const routed = selectCalibrationModel(activeCalibrationModel, {
    marketType: context?.marketType,
    leadBucket,
  })

  const bundleVersion = activeCalibrationModel && isCalibrationModelBundle(activeCalibrationModel)
    ? (activeCalibrationModel as CalibrationModelBundle).version ?? 'unknown'
    : 'legacy'
  const modelId = routed.route === 'none' ? 'none' : `${bundleVersion}:${routed.modelId}`

  return {
    calibrated: calibrateProbability(rawProbability, routed.model),
    modelId,
  }
}


function getGlobalCalibrationModel(): CalibrationModel | null {
  if (!activeCalibrationModel) return null
  if (isCalibrationModelBundle(activeCalibrationModel)) {
    return activeCalibrationModel.global ?? null
  }
  return activeCalibrationModel
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
export function getForecastWeights(forecasts: WeatherForecast[], weights: EnsembleWeights = DEFAULT_WEIGHTS): number[] {
  const raw = forecasts.map(f => weights[f.source] ?? 0.10)
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
  weights: EnsembleWeights = DEFAULT_WEIGHTS,
  marketType?: 'high' | 'low' | 'precipitation'
): WeatherEnsemble['consensus'] {
  if (forecasts.length === 0) {
    throw new Error('Cannot build consensus from empty forecast array')
  }

  // Calculate weighted precipitation probability
  const precipValues = forecasts.map(f => ({
    value: f.precipitation.probability,
    weight: weights[f.source] || 0,
  }))
  const precipProbability = weightedAverage(precipValues)

  // Calculate temperature range from all sources
  const allTemps = forecasts.flatMap(f => [f.temperature.min, f.temperature.max])
    .filter(t => typeof t === 'number' && !isNaN(t) && t !== null && t !== undefined)

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

  // Calculate model agreement (uses marketType for correct temp variable when available)
  const modelAgreement = calculateAgreement(forecasts, marketType)

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
  return result
}

// ============================================================================
// Per-Source μ Correction Table (computed from source_accuracy, Item B2)
// ============================================================================

// Regime-aware per-source mean bias μ_i (°C), keyed by
// (source, leadBucket, temperatureType, regime). Values from Item B2
// analysis (corpus date 2026-04-14). See:
//   memory/item-b2-mu-correction-2026-04-14.md
//   docs/archive/phase-2-mu-correction-plan.md
//
// Sign convention: μ = mean(forecast - actual) in °C.
//   Positive = source forecasts too warm → subtract from forecast to correct.
//   Negative = source forecasts too cold → subtraction becomes addition.
//
// Threshold regime only has gt72h entries; shorter leads fall back to
// gt72h:threshold (same pattern as SIGMA_SOURCE_TABLE).
// Temperature-low inner has 24to48h and gt72h only (12to24h pools).
// Cells with n<20 in the source corpus are pooled from the nearest
// large-n cell (see memory doc for details).
//
// Values originally computed in °F and converted here (× 5/9, rounded to 2dp).
export const MU_CORRECTION_TABLE: Record<string, number> = {
  // Inner regime — temperature-high (°C)
  'NWS:12to24h:high:inner':             0.00,
  'NWS:24to48h:high:inner':            -0.39,
  'NWS:gt72h:high:inner':              -0.21,
  'AccuWeather:12to24h:high:inner':     0.00,
  'AccuWeather:24to48h:high:inner':    -0.75,
  'AccuWeather:gt72h:high:inner':      -0.57,
  'Open-Meteo:12to24h:high:inner':      0.00,
  'Open-Meteo:24to48h:high:inner':     -0.83,
  'Open-Meteo:gt72h:high:inner':       -1.16,
  'Google-Weather:12to24h:high:inner': -0.99,
  'Google-Weather:24to48h:high:inner': -1.86,
  'Google-Weather:gt72h:high:inner':   -1.83,
  'Tomorrow.io:12to24h:high:inner':     0.00,
  'Tomorrow.io:24to48h:high:inner':    -1.35,
  'Tomorrow.io:gt72h:high:inner':      -1.23,

  // Threshold regime — temperature-high (gt72h only; shorter leads fall back)
  'NWS:gt72h:high:threshold':           -0.47,
  'AccuWeather:gt72h:high:threshold':   -1.07,
  'Open-Meteo:gt72h:high:threshold':    -0.48,
  'Google-Weather:gt72h:high:threshold': -2.20,
  'Tomorrow.io:gt72h:high:threshold':   -1.47,

  // Inner regime — temperature-low (24to48h + gt72h only; 12to24h pools)
  'NWS:24to48h:low:inner':              2.52,
  'NWS:gt72h:low:inner':                0.88,
  'AccuWeather:24to48h:low:inner':      2.29,
  'AccuWeather:gt72h:low:inner':        1.26,
  'Open-Meteo:24to48h:low:inner':      -0.72,
  'Open-Meteo:gt72h:low:inner':         1.47,
  'Google-Weather:24to48h:low:inner':  -0.55,
  'Google-Weather:gt72h:low:inner':    -0.34,
  'Tomorrow.io:24to48h:low:inner':     -0.84,
  'Tomorrow.io:gt72h:low:inner':       -0.38,

  // Threshold regime — temperature-low (gt72h only)
  'NWS:gt72h:low:threshold':            -0.65,
  'AccuWeather:gt72h:low:threshold':    -0.30,
  'Open-Meteo:gt72h:low:threshold':      0.50,
  'Google-Weather:gt72h:low:threshold': -1.43,
  'Tomorrow.io:gt72h:low:threshold':    -1.30,
}

// μ correction feature flag — flip to 'false' to revert to legacy scalar
// biasCorrection path (PM2 reload, no code change).
export const MU_CORRECTION_ENABLED = process.env.MU_CORRECTION_ENABLED !== 'false'

/**
 * Per-source μ correction lookup (°C). Returns 0 when no table entry
 * matches, so missing values produce no correction (safe default).
 *
 * Fallback behavior: threshold at any lead falls back to gt72h:threshold.
 * Missing inner 12to24h:low falls back to 24to48h:low:inner because the
 * corpus pooled those cells.
 */
export function getMuCorrection(
  source: string,
  hoursToResolution: number,
  temperatureType: 'high' | 'low' = 'high',
  bracketRegime: BracketRegime = 'inner',
): number {
  const leadBucket = getLeadBucket(hoursToResolution)
  const key = `${source}:${leadBucket}:${temperatureType}:${bracketRegime}`
  return MU_CORRECTION_TABLE[key]
    ?? MU_CORRECTION_TABLE[`${source}:gt72h:${temperatureType}:${bracketRegime}`]
    ?? 0
}

/**
 * Map hours-to-resolution to lead bucket key (used by the μ-correction table).
 * Item B Phase 1: 3-bucket scheme aligned to source_accuracy lead windows.
 * 48-72h collapses to gt72h (n=15, insufficient for own bucket — see B summary).
 */
export function getLeadBucket(hoursToResolution: number): string {
  if (hoursToResolution < 24) return '12to24h'
  if (hoursToResolution < 48) return '24to48h'
  return 'gt72h'
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
  biasCorrection = 0,
  weightsOverride?: EnsembleWeights,
  skipCalibration?: boolean
): WeatherProbability {
  if (ensemble.forecasts.length === 0) {
    throw new Error('Cannot calculate probability from empty ensemble')
  }

  // Read dynamic weights from override/ensemble or fall back to defaults
  const activeWeights = weightsOverride ?? ensemble.activeWeights ?? DEFAULT_WEIGHTS

  // Extract temperatures from forecast sources only (exclude ground-truth observations)
  // Use min temperatures for LOW markets, max temperatures for HIGH markets
  const useMin = temperatureType === 'low'
  const forecastsOnly = ensemble.forecasts.filter(f => FORECAST_SOURCES.has(f.source))
  const filteredForecasts = forecastsOnly.filter(f => {
    const temp = useMin ? f.temperature.min : f.temperature.max
    return typeof temp === 'number' && !isNaN(temp)
  })
  const forecastWeights = getForecastWeights(filteredForecasts, activeWeights)
  const sourceNames = filteredForecasts.map(f => f.source)
  const maxTemps = filteredForecasts.map(f => useMin ? f.temperature.min : f.temperature.max)

  // Apply bias correction to ensemble temperatures (shift in °C)
  const correctedTemps = maxTemps.map(t => t + biasCorrection)

  // Calculate weighted mean and standard deviation using bias-corrected temps
  const mean = correctedTemps.reduce((s, t, i) => s + t * forecastWeights[i], 0)
  const rawStdDev = Math.sqrt(correctedTemps.reduce((s, t, i) => s + forecastWeights[i] * (t - mean) ** 2, 0))

  const hoursToRes = ensemble.hoursToResolution ?? 36

  // Single Normal(mean, σ): σ = max(source spread, lead-time NWP floor).
  const MIN_STD_DEV = calculateDynamicStdDevFloor(maxTemps.length, ensemble.consensus.modelAgreement, hoursToRes)
  const stdDev = Math.max(rawStdDev, MIN_STD_DEV)
  const probability = direction === 'above'
    ? 1 - normalCDF(threshold, mean, stdDev)
    : normalCDF(threshold, mean, stdDev)

  // Single-Normal σ already encodes predictive uncertainty — no base-rate blend.
  const adjusted = probability

  // Apply isotonic calibration if model is available
  // Threshold brackets (above/below) are outside the calibration training domain —
  // skipCalibration prevents extrapolation inflation on these paths.
  let calibrated = adjusted
  let calibrationModelId = 'none'
  if (!skipCalibration) {
    const cal = applyCalibration(adjusted, {
      marketType: temperatureType === 'low' ? 'temperature-low' : 'temperature-high',
      hoursToResolution: hoursToRes,
    })
    calibrated = cal.calibrated
    calibrationModelId = cal.modelId
  }

  // FA-09: Safety clamp [0.02, 0.95] is an intentional tail bound.
  // This prevents the model from asserting near-certainty. Markets priced
  // at extremes (e.g. 0.01) would create artificial 1¢ edges after clamping,
  // but the minEdge filter (15%) already screens out those markets — so the
  // clamp has no practical impact on generated signals.
  const clampedProbability = clamp(calibrated, 0.02, 0.95)

  const weightsLabel = ensemble.activeWeights ? 'dynamic' : 'default'
  return {
    outcome: `temperature ${direction} ${threshold}°C`,
    probability: clampedProbability,
    confidence: ensemble.consensus.modelAgreement,
    sources: ensemble.forecasts,
    calculatedAt: Date.now(),
    reasoning: `Normal: ${maxTemps.length} sources (mean: ${mean.toFixed(1)}°, spread: ${rawStdDev.toFixed(1)}°, weights: ${weightsLabel})`,
    uncalibratedProbability: adjusted,
    calibrationModelId,
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
  biasCorrection = 0,
  weightsOverride?: EnsembleWeights
): WeatherProbability {
  if (ensemble.forecasts.length === 0) {
    throw new Error('Cannot calculate probability from empty ensemble')
  }

  // Read dynamic weights from override/ensemble or fall back to defaults
  const activeWeights = weightsOverride ?? ensemble.activeWeights ?? DEFAULT_WEIGHTS

  // Extract temperatures from forecast sources only (exclude ground-truth observations)
  // Use min temperatures for LOW markets, max temperatures for HIGH markets
  const useMin = temperatureType === 'low'
  const forecastsOnly = ensemble.forecasts.filter(f => FORECAST_SOURCES.has(f.source))
  const filteredForecasts = forecastsOnly.filter(f => {
    const temp = useMin ? f.temperature.min : f.temperature.max
    return typeof temp === 'number' && !isNaN(temp)
  })
  const forecastWeights = getForecastWeights(filteredForecasts, activeWeights)
  const sourceNames = filteredForecasts.map(f => f.source)
  const maxTemps = filteredForecasts.map(f => useMin ? f.temperature.min : f.temperature.max)

  // Apply bias correction to ensemble temperatures (shift in °C)
  const correctedTemps = maxTemps.map(t => t + biasCorrection)

  const mean = correctedTemps.reduce((s, t, i) => s + t * forecastWeights[i], 0)
  const rawStdDev = Math.sqrt(correctedTemps.reduce((s, t, i) => s + forecastWeights[i] * (t - mean) ** 2, 0))

  const hoursToRes = ensemble.hoursToResolution ?? 36

  // Single Normal(mean, σ): σ = max(source spread, lead-time NWP floor).
  const MIN_STD_DEV = calculateDynamicStdDevFloor(maxTemps.length, ensemble.consensus.modelAgreement, hoursToRes)
  const stdDev = Math.max(rawStdDev, MIN_STD_DEV)
  const probability = normalCDF(capStrike, mean, stdDev) - normalCDF(floorStrike, mean, stdDev)

  // Single-Normal σ already encodes predictive uncertainty — no prior blend.
  const adjusted = probability

  // Apply isotonic calibration if model is available
  const { calibrated, modelId: calibrationModelId } = applyCalibration(adjusted, {
    marketType: temperatureType === 'low' ? 'temperature-low' : 'temperature-high',
    hoursToResolution: hoursToRes,
  })

  // FA-09: Safety clamp — see comment in calculateTemperatureProbability
  const clampedProbability = clamp(calibrated, 0.02, 0.95)

  const weightsLabel = ensemble.activeWeights ? 'dynamic' : 'default'
  return {
    outcome: `temperature ${floorStrike}° to ${capStrike}°C`,
    probability: clampedProbability,
    confidence: ensemble.consensus.modelAgreement,
    sources: ensemble.forecasts,
    calculatedAt: Date.now(),
    reasoning: `Normal: ${maxTemps.length} sources (mean: ${mean.toFixed(1)}°, spread: ${rawStdDev.toFixed(1)}°, weights: ${weightsLabel})`,
    uncalibratedProbability: adjusted,
    calibrationModelId,
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
  const { calibrated, modelId: calibrationModelId } = applyCalibration(adjusted, {
    marketType: 'precipitation',
    hoursToResolution: ensemble.hoursToResolution,
  })

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
    uncalibratedProbability: adjusted,
    calibrationModelId,
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
  const { calibrated, modelId: calibrationModelId } = applyCalibration(adjusted, {
    marketType: 'precipitation',
    hoursToResolution: ensemble.hoursToResolution,
  })

  const clampedProbability = clamp(calibrated, 0.02, 0.95)

  return {
    outcome: `precipitation ${floorThreshold}" to ${capThreshold}"`,
    probability: clampedProbability,
    confidence: ensemble.consensus.modelAgreement,
    sources: ensemble.forecasts,
    calculatedAt: Date.now(),
    reasoning: `Based on ${ensemble.forecasts.length} sources (bracket ${floorThreshold}"-${capThreshold}")`,
    uncalibratedProbability: adjusted,
    calibrationModelId,
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
  const calibrationConf = getCalibrationConfidence(getGlobalCalibrationModel())
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
 * @param nws - Optional NWS forecasts
 * @param accuWeather - Optional AccuWeather forecasts
 * @param tomorrow - Optional Tomorrow.io forecasts
 * @returns Complete WeatherEnsemble
 */
export function buildEnsemble(
  openMeteo: WeatherForecast[],
  googleWeather: WeatherForecast[],
  metar: WeatherForecast | null,
  location: { lat: number; lng: number; city?: string; timezone?: string },
  nws: WeatherForecast[] = [],
  accuWeather: WeatherForecast[] = [],
  tomorrow: WeatherForecast[] = [],
  weights?: EnsembleWeights
): WeatherEnsemble {
  // Combine all forecasts
  const forecasts: WeatherForecast[] = [
    ...openMeteo,
    ...googleWeather,
    ...(metar ? [metar] : []),
    ...nws,
    ...accuWeather,
    ...tomorrow,
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
  const accuPick = pickCurrentForecast(accuWeather)
  if (accuPick) currentForecasts.push(accuPick)
  const tomorrowPick = pickCurrentForecast(tomorrow)
  if (tomorrowPick) currentForecasts.push(tomorrowPick)

  const consensus = buildConsensus(currentForecasts, weights)

  // Extract unique sources
  const sources = Array.from(new Set(forecasts.map(f => f.source)))

  return {
    location,
    forecasts,
    consensus,
    sources,
    timestamp: Date.now(),
    activeWeights: weights,
  }
}
