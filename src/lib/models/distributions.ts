// Distribution-aware temperature model using Kernel Density Estimation (KDE)
// Handles bimodal weather, fat tails, and non-normal distributions
// Uses Gaussian kernel with Silverman's rule for bandwidth selection

// ============================================================================
// Types
// ============================================================================

export interface KDEResult {
  /** Evaluate the density at a given point */
  density: (x: number) => number
  /** Compute P(X > threshold) */
  exceedanceProbability: (threshold: number) => number
  /** Compute P(floor <= X < cap) */
  intervalProbability: (floor: number, cap: number) => number
  /** Summary statistics */
  mean: number
  stdDev: number
  bandwidth: number
  sampleSize: number
}

export interface ClimatologicalPrior {
  mean: number
  stdDev: number
  weight: number  // How much to blend with KDE (0-1)
}

// ============================================================================
// Gaussian Kernel
// ============================================================================

/**
 * Standard Gaussian kernel: K(u) = (1/sqrt(2*pi)) * exp(-u^2/2)
 */
function gaussianKernel(u: number): number {
  return Math.exp(-0.5 * u * u) / Math.sqrt(2 * Math.PI)
}

/**
 * Gaussian CDF using error function approximation
 */
function gaussianCDF(x: number): number {
  return 0.5 * (1 + erf(x / Math.sqrt(2)))
}

function erf(x: number): number {
  const sign = x >= 0 ? 1 : -1
  x = Math.abs(x)

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

// ============================================================================
// Bandwidth Selection
// ============================================================================

/**
 * Silverman's rule of thumb for bandwidth selection.
 * h = 0.9 * min(stdDev, IQR/1.34) * n^(-1/5)
 *
 * Good for unimodal distributions; slightly oversmooths bimodal ones
 * which is acceptable for our use case (conservative estimation).
 */
function silvermanBandwidth(data: number[], minBandwidth?: number): number {
  const n = data.length
  if (n < 2) return 2.0 // Fallback to 2°C

  const sorted = [...data].sort((a, b) => a - b)
  const mean = data.reduce((s, v) => s + v, 0) / n
  const variance = data.reduce((s, v) => s + (v - mean) ** 2, 0) / n
  const stdDev = Math.sqrt(variance)

  // Interquartile range
  const q1 = sorted[Math.floor(n * 0.25)]
  const q3 = sorted[Math.floor(n * 0.75)]
  const iqr = q3 - q1

  const spread = Math.min(stdDev, iqr / 1.34)

  // Silverman's rule
  const h = 0.9 * spread * Math.pow(n, -0.2)

  // Use minBandwidth (from NWP-grounded dynamic stdDev floor) when provided,
  // otherwise fall back to 0.3°C hard floor.
  // This ensures the KDE distribution width reflects actual forecast uncertainty,
  // not just inter-source agreement.
  const floor = minBandwidth ?? 0.3
  return Math.max(h, floor)
}

// ============================================================================
// KDE Construction
// ============================================================================

/**
 * Build a Kernel Density Estimate from ensemble temperature samples.
 * Optionally blends with a climatological prior for robustness.
 *
 * @param samples - Temperature values from ensemble forecasts (°C)
 * @param prior - Optional climatological prior for blending
 * @returns KDE result with density evaluation and probability functions
 */
export function buildKDE(
  samples: number[],
  prior?: ClimatologicalPrior,
  weights?: number[],
  minBandwidth?: number
): KDEResult {
  if (samples.length === 0) {
    throw new Error('Cannot build KDE from empty samples')
  }

  const n = samples.length

  // Normalize weights: when provided and length matches, normalize to sum=1;
  // otherwise fall back to uniform 1/n
  const w: number[] = (weights && weights.length === n)
    ? (() => { const s = weights.reduce((a, b) => a + b, 0); return s > 0 ? weights.map(v => v / s) : samples.map(() => 1 / n) })()
    : samples.map(() => 1 / n)

  const mean = samples.reduce((s, v) => s + v, 0) / n
  const variance = samples.reduce((s, v) => s + (v - mean) ** 2, 0) / n
  const stdDev = Math.sqrt(variance) || 0.5

  const h = silvermanBandwidth(samples, minBandwidth)

  // KDE density: f(x) = (1/h) * sum(w[i] * K((x - xi)/h))
  function kdeDensity(x: number): number {
    let sum = 0
    for (let i = 0; i < n; i++) {
      sum += w[i] * gaussianKernel((x - samples[i]) / h)
    }
    return sum / h
  }

  // KDE CDF: F(x) = sum(w[i] * Phi((x - xi)/h))
  function kdeCDF(x: number): number {
    let sum = 0
    for (let i = 0; i < n; i++) {
      sum += w[i] * gaussianCDF((x - samples[i]) / h)
    }
    return sum
  }

  // Prior CDF (normal distribution)
  function priorCDF(x: number): number {
    if (!prior) return 0
    return gaussianCDF((x - prior.mean) / prior.stdDev)
  }

  // Blended CDF
  function blendedCDF(x: number): number {
    if (!prior || prior.weight <= 0) return kdeCDF(x)
    return (1 - prior.weight) * kdeCDF(x) + prior.weight * priorCDF(x)
  }

  // Blended density
  function blendedDensity(x: number): number {
    if (!prior || prior.weight <= 0) return kdeDensity(x)
    const priorDensity = gaussianKernel((x - prior.mean) / prior.stdDev) / prior.stdDev
    return (1 - prior.weight) * kdeDensity(x) + prior.weight * priorDensity
  }

  return {
    density: blendedDensity,
    exceedanceProbability: (threshold: number) => {
      return 1 - blendedCDF(threshold)
    },
    intervalProbability: (floor: number, cap: number) => {
      return blendedCDF(cap) - blendedCDF(floor)
    },
    mean,
    stdDev,
    bandwidth: h,
    sampleSize: n,
  }
}

/**
 * Calculate temperature probability using KDE instead of simple normal CDF.
 * This handles bimodal distributions and fat tails better.
 *
 * @param temperatures - Array of forecast temperatures from ensemble (°C)
 * @param threshold - Temperature threshold (°C)
 * @param direction - 'above' or 'below'
 * @param prior - Optional climatological prior
 * @returns Probability (0-1)
 */
export function kdeTemperatureProbability(
  temperatures: number[],
  threshold: number,
  direction: 'above' | 'below',
  prior?: ClimatologicalPrior,
  weights?: number[],
  minBandwidth?: number
): number {
  if (temperatures.length === 0) return 0.5

  const kde = buildKDE(temperatures, prior, weights, minBandwidth)

  if (direction === 'above') {
    return kde.exceedanceProbability(threshold)
  } else {
    return 1 - kde.exceedanceProbability(threshold)
  }
}

/**
 * Calculate bracket probability using KDE.
 *
 * @param temperatures - Array of forecast temperatures from ensemble (°C)
 * @param floor - Lower bracket bound (°C)
 * @param cap - Upper bracket bound (°C)
 * @param prior - Optional climatological prior
 * @returns Probability (0-1)
 */
export function kdeBracketProbability(
  temperatures: number[],
  floor: number,
  cap: number,
  prior?: ClimatologicalPrior,
  weights?: number[],
  minBandwidth?: number
): number {
  if (temperatures.length === 0) return 0.1

  const kde = buildKDE(temperatures, prior, weights, minBandwidth)
  return kde.intervalProbability(floor, cap)
}
