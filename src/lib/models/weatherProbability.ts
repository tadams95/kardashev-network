// Weather probability calculator
// Consensus aggregation and market probability calculations for weather trading

import type { WeatherForecast, WeatherEnsemble, WeatherProbability, EnsembleWeights } from '@/types/weather'

// Fixed ensemble weights per spec (targeting 71-73% win rate)
export const DEFAULT_WEIGHTS: EnsembleWeights = {
  'Open-Meteo': 0.40,      // Free, comprehensive forecasts
  'Google-Weather': 0.40,  // Free, AI-powered MetNet model
  'METAR': 0.20,           // Free, ground truth observations
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
 * Calculate model agreement based on standard deviation
 * Lower std dev = higher agreement
 *
 * @returns Agreement score 0-100
 */
function calculateAgreement(forecasts: WeatherForecast[]): number {
  if (forecasts.length === 0) return 0
  if (forecasts.length === 1) return 100 // Perfect agreement with itself

  // Calculate agreement based on temperature max std deviation
  const temps = forecasts.map(f => f.temperature.max)
  const stdDev = standardDeviation(temps)

  // Convert to 0-100 scale (low stdDev = high agreement)
  // stdDev of 0 = 100% agreement, stdDev of 10°C = 0% agreement
  const agreement = Math.max(0, 100 - stdDev * 10)

  return agreement
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

  // Calculate weighted precipitation probability
  const precipValues = forecasts.map(f => ({
    value: f.precipitation.probability,
    weight: weights[f.source] || 0,
  }))
  const precipProbability = weightedAverage(precipValues)

  // Calculate temperature range from all sources
  const allTemps = forecasts.flatMap(f => [f.temperature.min, f.temperature.max])
  const temperatureRange: [number, number] = [
    Math.min(...allTemps),
    Math.max(...allTemps),
  ]

  // Calculate weighted mean temperature
  const tempValues = forecasts.map(f => ({
    value: (f.temperature.min + f.temperature.max) / 2,
    weight: weights[f.source] || 0,
  }))
  const temperatureMean = weightedAverage(tempValues)

  // Calculate model agreement
  const modelAgreement = calculateAgreement(forecasts)

  // Calculate data quality (freshness + confidence)
  const avgDataAge = average(forecasts.map(f => f.dataAge))
  const avgConfidence = average(forecasts.map(f => f.confidence))

  // Data quality: penalize stale data (>6h) and low confidence (<70)
  let dataQuality = 100
  if (avgDataAge > 6 * 3600000) dataQuality *= 0.90 // >6 hours old
  if (avgConfidence < 70) dataQuality *= 0.85      // Low confidence sources
  if (forecasts.length < 3) dataQuality *= 0.90    // Fewer than 3 sources

  return {
    temperatureRange,
    temperatureMean,
    precipProbability,
    modelAgreement,
    dataQuality: Math.round(dataQuality),
  }
}

// ============================================================================
// Temperature Probability Calculation
// ============================================================================

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
  direction: 'above' | 'below'
): WeatherProbability {
  if (ensemble.forecasts.length === 0) {
    throw new Error('Cannot calculate probability from empty ensemble')
  }

  // Extract max temperatures from forecasts (for "high of the day" predictions)
  const maxTemps = ensemble.forecasts.map(f => f.temperature.max)

  // Calculate mean and standard deviation
  const mean = average(maxTemps)
  const stdDev = standardDeviation(maxTemps)

  // Calculate raw probability using normal CDF
  let probability: number
  if (direction === 'above') {
    // P(X > threshold) = 1 - P(X ≤ threshold)
    probability = 1 - normalCDF(threshold, mean, stdDev)
  } else {
    // P(X < threshold) = P(X ≤ threshold)
    probability = normalCDF(threshold, mean, stdDev)
  }

  // Adjust probability based on model agreement
  // High disagreement should reduce confidence in extreme predictions
  const agreementFactor = ensemble.consensus.modelAgreement / 100
  const adjusted = probability * (0.7 + 0.3 * agreementFactor) // Scale between 0.7 and 1.0

  // Clamp to valid probability range (avoid 0 or 1 for betting markets)
  const clampedProbability = clamp(adjusted, 0.01, 0.99)

  return {
    outcome: `temperature ${direction} ${threshold}°${ensemble.forecasts[0].temperature.current >= 0 ? 'F' : 'C'}`,
    probability: clampedProbability,
    confidence: ensemble.consensus.modelAgreement,
    sources: ensemble.forecasts,
    calculatedAt: Date.now(),
    reasoning: `Based on ${ensemble.forecasts.length} sources (mean: ${mean.toFixed(1)}°, stdDev: ${stdDev.toFixed(1)}°)`,
  }
}

// ============================================================================
// Precipitation Probability Calculation
// ============================================================================

/**
 * Calculate probability of precipitation exceeding threshold
 * Uses direct consensus probability from weather models
 *
 * @param ensemble - Weather ensemble with multiple forecasts
 * @param threshold - Precipitation threshold in same units as forecasts (inches or mm)
 * @returns Probability calculation with confidence metrics
 */
export function calculatePrecipitationProbability(
  ensemble: WeatherEnsemble,
  threshold: number
): WeatherProbability {
  if (ensemble.forecasts.length === 0) {
    throw new Error('Cannot calculate probability from empty ensemble')
  }

  // Use consensus precipitation probability directly
  const probability = ensemble.consensus.precipProbability

  // Adjust for data quality
  const dataQualityFactor = ensemble.consensus.dataQuality / 100
  const adjusted = probability * dataQualityFactor

  // Clamp to valid probability range
  const clampedProbability = clamp(adjusted, 0.01, 0.99)

  return {
    outcome: `precipitation > ${threshold} ${threshold < 2 ? 'inches' : 'mm'}`,
    probability: clampedProbability,
    confidence: ensemble.consensus.modelAgreement,
    sources: ensemble.forecasts,
    calculatedAt: Date.now(),
    reasoning: `Based on ${ensemble.forecasts.length} sources (consensus: ${(probability * 100).toFixed(0)}%)`,
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
 * Reduces confidence as we approach resolution time
 *
 * @param hoursToResolution - Hours until market resolves
 * @returns Confidence multiplier (0-1)
 */
export function getTimeBasedDiscount(hoursToResolution: number): number {
  if (hoursToResolution <= 12) return 0  // No trading allowed
  if (hoursToResolution >= 48) return 1  // Full confidence

  // Linear decay from 48h (100%) to 12h (0%)
  return (hoursToResolution - 12) / (48 - 12)
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
 * @param fees - Transaction fees as decimal (default: 0.15 = 15% all-in costs)
 * @returns Expected profit/loss
 */
export function calculateExpectedValue(
  modelProbability: number,
  marketPrice: number,
  positionSize: number,
  fees = 0.15
): number {
  // Bet YES if model thinks it's more likely than market
  if (modelProbability > marketPrice) {
    // Win: pay marketPrice, receive $1, keep (1 - marketPrice - fees)
    const winAmount = (1 - marketPrice) * (1 - fees)
    // Loss: lose marketPrice
    const lossAmount = marketPrice

    return modelProbability * winAmount - (1 - modelProbability) * lossAmount
  } else {
    // Bet NO if model thinks it's less likely than market
    // Win: pay (1 - marketPrice), receive $1, keep (marketPrice - fees)
    const winAmount = marketPrice * (1 - fees)
    // Loss: lose (1 - marketPrice)
    const lossAmount = 1 - marketPrice

    return (1 - modelProbability) * winAmount - modelProbability * lossAmount
  }
}

// ============================================================================
// Kelly Criterion Position Sizing
// ============================================================================

/**
 * Calculate optimal position size using Kelly Criterion
 * Fractional Kelly (25%) is recommended to reduce variance
 *
 * @param modelProbability - Our model's probability (0-1)
 * @param marketPrice - Market's current price (0-1)
 * @param bankroll - Total available bankroll
 * @param fraction - Kelly fraction (0.25 = 25% Kelly, default)
 * @returns Recommended position size in dollars
 */
export function calculateKellyPosition(
  modelProbability: number,
  marketPrice: number,
  bankroll: number,
  fraction = 0.25
): number {
  // Determine if betting YES or NO
  const bettingYes = modelProbability > marketPrice

  let kellyFraction: number

  if (bettingYes) {
    // Betting YES: edge / odds
    const edge = modelProbability - marketPrice
    const odds = (1 - marketPrice) / marketPrice
    kellyFraction = edge / odds
  } else {
    // Betting NO: edge / odds
    const edge = marketPrice - modelProbability
    const odds = marketPrice / (1 - marketPrice)
    kellyFraction = edge / odds
  }

  // Apply fractional Kelly
  const fractionalKelly = kellyFraction * fraction

  // Calculate position size (capped at 10% of bankroll per trade)
  const positionSize = Math.min(
    fractionalKelly * bankroll,
    bankroll * 0.10  // Never risk more than 10% on single trade
  )

  // Minimum position size per spec: $0.50
  return Math.max(positionSize, 0.50)
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
 * @returns Complete WeatherEnsemble
 */
export function buildEnsemble(
  openMeteo: WeatherForecast[],
  googleWeather: WeatherForecast[],
  metar: WeatherForecast | null,
  location: { lat: number; lng: number; city?: string }
): WeatherEnsemble {
  // Combine all forecasts
  const forecasts: WeatherForecast[] = [
    ...openMeteo,
    ...googleWeather,
    ...(metar ? [metar] : []),
  ]

  if (forecasts.length === 0) {
    throw new Error('Cannot build ensemble with no forecasts')
  }

  // Build consensus
  const consensus = buildConsensus(forecasts)

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
