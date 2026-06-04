// Forecast-First Distribution: compute the weighted-mean point forecast ONCE
// per city/day/type, then derive all bracket probabilities from a single
// Normal centered on it.
//
// The point forecast (pointForecastF / spreadC / perSourceForecastsF) is the
// BMA-free live earning path consumed by tail-sell. The probability closures
// (pAbove/pBelow/pBracket/pAllBrackets) feed only the deprecated
// probability-model signal path — a single Normal replaces the former BMA
// per-source Gaussian mixture.

import { normalCDF } from './distributions'
import {
  getMuCorrection,
  MU_CORRECTION_ENABLED,
  getForecastWeights,
  getLeadBucket,
  calculateDynamicStdDevFloor,
  FORECAST_SOURCES,
  DEFAULT_WEIGHTS,
  DEFAULT_WEIGHTS_LOW,
} from './weatherProbability'
import type { BracketRegime } from './weatherProbability'
import type { WeatherEnsemble, EnsembleWeights } from '@/types/weather'

// ============================================================================
// Types
// ============================================================================

export interface ForecastDistributionComponent {
  source: string
  weight: number    // normalized, sums to 1
  meanC: number     // bias-corrected forecast in °C
}

export interface ForecastDistribution {
  cityCode: string
  date: string                    // resolution date
  temperatureType: 'high' | 'low'

  // Point forecast
  pointForecastC: number          // weighted mean of components, °C
  pointForecastF: number          // °C → °F
  rawPointForecastF: number       // pre-bias weighted mean in °F

  // Distribution
  components: ForecastDistributionComponent[]

  // Metadata
  spreadC: number                 // weighted σ of source means
  ensembleSigmaC: number          // single-Normal predictive σ (aleatoric ⊕ spread)
  sourceCount: number
  hoursToResolution: number
  leadBucket: string
  bracketRegime: BracketRegime
  biasCorrection: number          // °C delta applied
  perSourceForecastsF: Record<string, number>  // source → bias-corrected temp in °F

  // Probability queries — single Normal(pointForecastC, ensembleSigmaC)
  pAbove(thresholdC: number): number
  pBelow(thresholdC: number): number
  pBracket(floorC: number, capC: number): number
  pAllBrackets(boundaries: number[]): number[]  // N-1 probabilities for N boundaries
}

// ============================================================================
// Constructor
// ============================================================================

export function buildForecastDistribution(opts: {
  ensemble: WeatherEnsemble
  temperatureType: 'high' | 'low'
  biasCorrection: number          // °C
  cityCode: string
  date: string
  weightsOverride?: EnsembleWeights
  bracketRegime?: BracketRegime   // defaults to 'inner'
}): ForecastDistribution | null {
  const { ensemble, temperatureType, biasCorrection, cityCode, date, weightsOverride } = opts
  const bracketRegime: BracketRegime = opts.bracketRegime ?? 'inner'

  // 1. Resolve weights — DEFAULT_WEIGHTS for high-temp, DEFAULT_WEIGHTS_LOW for low-temp.
  // Source rankings reverse between regimes (GW best for lows, NWS best for highs).
  // weightsOverride (e.g., THRESHOLD_WEIGHTS) and ensemble.activeWeights take precedence.
  const regimeDefault = temperatureType === 'low' ? DEFAULT_WEIGHTS_LOW : DEFAULT_WEIGHTS
  const activeWeights = weightsOverride ?? ensemble.activeWeights ?? regimeDefault

  // 2. Filter to forecast sources with valid temps
  const useMin = temperatureType === 'low'
  const forecastsOnly = ensemble.forecasts.filter(f => FORECAST_SOURCES.has(f.source))
  const filteredForecasts = forecastsOnly.filter(f => {
    const temp = useMin ? f.temperature.min : f.temperature.max
    return typeof temp === 'number' && !isNaN(temp)
  })

  if (filteredForecasts.length === 0) return null

  // 3. Compute weights + extract temps
  const forecastWeights = getForecastWeights(filteredForecasts, activeWeights)
  const sourceNames = filteredForecasts.map(f => f.source)
  const maxTemps = filteredForecasts.map(f => useMin ? f.temperature.min : f.temperature.max)

  const hoursToRes = ensemble.hoursToResolution ?? 36

  // Item B Phase 2: per-source μ correction replaces the per-city scalar
  // biasCorrection when MU_CORRECTION_ENABLED. Applied BEFORE the weighted-mean
  // aggregation so each source's bias is corrected independently.
  //
  // Sign: μ = mean(forecast - actual) in °C → subtract from forecast
  // to shift toward actual. The legacy path uses `t + biasCorrection`
  // where biasCorrection is pre-negated upstream (opportunities.ts:111);
  // the μ path skips that off-site sign flip and subtracts directly.
  //
  // Flag default is ON. Rollback: set MU_CORRECTION_ENABLED=false in
  // .env.local + pm2 reload — legacy scalar path is preserved below.
  //
  // See docs/archive/phase-2-mu-correction-plan.md for full design.
  const correctedTemps = MU_CORRECTION_ENABLED
    ? maxTemps.map((t, i) => t - getMuCorrection(sourceNames[i], hoursToRes, temperatureType, bracketRegime))
    : maxTemps.map(t => t + biasCorrection)

  // 4. Build components (source, weight, bias-corrected mean)
  const components: ForecastDistributionComponent[] = sourceNames.map((source, i) => ({
    source,
    weight: forecastWeights[i],
    meanC: correctedTemps[i],
  }))

  // 5. Point forecasts
  const pointForecastC = correctedTemps.reduce((s, t, i) => s + t * forecastWeights[i], 0)
  const pointForecastF = pointForecastC * 9 / 5 + 32
  const rawPointForecastF = maxTemps.reduce((s, t, i) => s + t * forecastWeights[i], 0) * 9 / 5 + 32

  // 6. Weighted spread of source means (epistemic disagreement, °C)
  const spreadC = Math.sqrt(
    correctedTemps.reduce((s, t, i) => s + forecastWeights[i] * (t - pointForecastC) ** 2, 0)
  )

  // 7. Single-Normal predictive σ: lead-time NWP floor combined in quadrature
  // with the source-disagreement spread. Replaces the former BMA per-source
  // mixture σ; feeds only the deprecated probability-model path.
  const aleatoricFloorC = calculateDynamicStdDevFloor(
    filteredForecasts.length,
    ensemble.consensus?.modelAgreement ?? 75,
    hoursToRes,
  )
  const ensembleSigmaC = Math.sqrt(aleatoricFloorC ** 2 + spreadC ** 2)

  // 8. Per-source forecasts in °F
  const perSourceForecastsF: Record<string, number> = {}
  for (let i = 0; i < sourceNames.length; i++) {
    perSourceForecastsF[sourceNames[i]] = correctedTemps[i] * 9 / 5 + 32
  }

  const leadBucket = getLeadBucket(hoursToRes)

  // 9. Probability closures — single Normal(pointForecastC, ensembleSigmaC)
  function pAbove(thresholdC: number): number {
    return Math.min(Math.max(1 - normalCDF(thresholdC, pointForecastC, ensembleSigmaC), 0), 1)
  }

  function pBelow(thresholdC: number): number {
    return 1 - pAbove(thresholdC)
  }

  function pBracket(floorC: number, capC: number): number {
    const p = normalCDF(capC, pointForecastC, ensembleSigmaC) - normalCDF(floorC, pointForecastC, ensembleSigmaC)
    return Math.min(Math.max(p, 0), 1)
  }

  function pAllBrackets(boundaries: number[]): number[] {
    if (boundaries.length < 2) return []
    const cdfs = boundaries.map(b => normalCDF(b, pointForecastC, ensembleSigmaC))
    const probs: number[] = []
    for (let i = 0; i < boundaries.length - 1; i++) {
      probs.push(Math.min(Math.max(cdfs[i + 1] - cdfs[i], 0), 1))
    }
    return probs
  }

  return {
    cityCode,
    date,
    temperatureType,
    pointForecastC,
    pointForecastF,
    rawPointForecastF,
    components,
    spreadC,
    ensembleSigmaC,
    sourceCount: filteredForecasts.length,
    hoursToResolution: hoursToRes,
    leadBucket,
    bracketRegime,
    biasCorrection,
    perSourceForecastsF,
    pAbove,
    pBelow,
    pBracket,
    pAllBrackets,
  }
}
