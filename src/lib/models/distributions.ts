// Normal CDF helpers for the single-Normal bracket/threshold probability model.
// (Former KDE + BMA Gaussian-mixture machinery deleted — see the BMA-deletion
// Phase 1 work; tail-sell signal generation is unaffected.)

/**
 * Error function (erf) — Abramowitz & Stegun 7.1.26 approximation.
 */
export function erf(x: number): number {
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

/**
 * Standard normal CDF (mean 0, stdDev 1).
 */
export function gaussianCDF(x: number): number {
  return 0.5 * (1 + erf(x / Math.sqrt(2)))
}

/**
 * Normal CDF with mean and stdDev parameters.
 */
export function normalCDF(x: number, mean: number, stdDev: number): number {
  if (stdDev <= 0) return x >= mean ? 1 : 0
  return gaussianCDF((x - mean) / stdDev)
}
