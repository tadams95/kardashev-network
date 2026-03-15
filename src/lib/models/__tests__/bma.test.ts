// BMA (Bayesian Model Averaging) unit tests
// Tests cover: bmaBracketProbability, bmaThresholdProbability, getPerSourceSigma,
// BMA_ENABLED flag fallback, and integration through calculate*Probability functions

import { describe, it, expect } from 'vitest'
import { bmaBracketProbability, bmaThresholdProbability } from '../distributions'
import {
  getPerSourceSigma,
  SIGMA_SOURCE_TABLE,
  SIGMA_ALEATORIC_TABLE,
  calculateTemperatureProbability,
  calculateBracketProbability,
} from '../weatherProbability'
import type { WeatherEnsemble } from '@/types/weather'

// ---------------------------------------------------------------------------
// Helper: build a minimal WeatherEnsemble for integration tests
// ---------------------------------------------------------------------------
function makeEnsemble(
  sources: { name: string; maxTemp: number; minTemp?: number }[],
  opts: { hoursToResolution?: number; agreement?: number } = {}
): WeatherEnsemble {
  return {
    forecasts: sources.map(s => ({
      source: s.name,
      temperature: { max: s.maxTemp, min: s.minTemp ?? s.maxTemp - 8, current: s.maxTemp - 2 },
      humidity: 50,
      windSpeed: 10,
      precipitation: { probability: 10, amount: 0 },
      confidence: 85,
      dataAge: 3600000,
    })),
    consensus: {
      temperatureRange: { min: 18, max: 28 },
      temperatureMean: 23,
      precipProbability: 10,
      modelAgreement: opts.agreement ?? 90,
      dataQuality: 90,
    },
    location: { city: 'TestCity', lat: 40.7, lng: -74.0 },
    hoursToResolution: opts.hoursToResolution ?? 24,
  } as unknown as WeatherEnsemble
}

// ---------------------------------------------------------------------------
// 1. bmaBracketProbability — identical sources at bracket center → high P
// ---------------------------------------------------------------------------
describe('bmaBracketProbability', () => {
  it('identical sources at bracket center → high probability (no compression)', () => {
    // All 5 sources forecast 25°C, bracket [24.5, 25.5), σ_i = 0.5°C
    const temps = [25, 25, 25, 25, 25]
    const weights = [0.35, 0.35, 0.1, 0.1, 0.1]
    const sigmas = [0.5, 0.5, 0.5, 0.5, 0.5]
    const p = bmaBracketProbability(temps, weights, 24.5, 25.5, sigmas)
    // Φ(1) - Φ(-1) ≈ 0.683 for each source → weighted sum = 0.683
    expect(p).toBeGreaterThan(0.65)
    expect(p).toBeLessThan(0.72)
  })

  it('identical temps, σ_i=0.5 → higher P than with σ_i=0.7', () => {
    const temps = [25, 25, 25, 25, 25]
    const weights = [0.2, 0.2, 0.2, 0.2, 0.2]
    const bmaP = bmaBracketProbability(temps, weights, 24.5, 25.5, [0.5, 0.5, 0.5, 0.5, 0.5])
    const kdeEquiv = bmaBracketProbability(temps, weights, 24.5, 25.5, [0.7, 0.7, 0.7, 0.7, 0.7])
    expect(bmaP).toBeGreaterThan(kdeEquiv)
  })

  it('sources spread across brackets → probability distributed proportionally', () => {
    // Source 1 (w=0.5) at 24°C, Source 2 (w=0.5) at 26°C
    const temps = [24, 26]
    const weights = [0.5, 0.5]
    const sigmas = [1.0, 1.0]
    const pLower = bmaBracketProbability(temps, weights, 23.5, 24.5, sigmas)
    const pUpper = bmaBracketProbability(temps, weights, 25.5, 26.5, sigmas)
    // Both brackets should get roughly equal probability (symmetric)
    expect(Math.abs(pLower - pUpper)).toBeLessThan(0.02)
    expect(pLower).toBeGreaterThan(0.1)
  })

  it('empty input → returns 0.1 fallback', () => {
    expect(bmaBracketProbability([], [], 24, 25, [])).toBe(0.1)
  })

  it('bracket probabilities across full range sum close to 1.0', () => {
    const temps = [24, 24.5, 25, 25.5, 26]
    const weights = [0.2, 0.2, 0.2, 0.2, 0.2]
    const sigmas = [1.5, 1.5, 1.5, 1.5, 1.5]
    let total = 0
    for (let floor = 15; floor < 35; floor++) {
      total += bmaBracketProbability(temps, weights, floor, floor + 1, sigmas)
    }
    expect(total).toBeGreaterThan(0.98)
    expect(total).toBeLessThan(1.02)
  })
})

// ---------------------------------------------------------------------------
// 2. bmaThresholdProbability — above/below
// ---------------------------------------------------------------------------
describe('bmaThresholdProbability', () => {
  it('all sources well above threshold → probability near 1.0', () => {
    const temps = [30, 31, 29, 30, 30]
    const weights = [0.35, 0.35, 0.1, 0.1, 0.1]
    const sigmas = [1.5, 1.5, 1.5, 1.5, 1.5]
    const p = bmaThresholdProbability(temps, weights, 20, 'above', sigmas)
    expect(p).toBeGreaterThan(0.99)
  })

  it('all sources well below threshold → P(above) near 0', () => {
    const temps = [15, 14, 16, 15, 15]
    const weights = [0.2, 0.2, 0.2, 0.2, 0.2]
    const sigmas = [1.5, 1.5, 1.5, 1.5, 1.5]
    const p = bmaThresholdProbability(temps, weights, 25, 'above', sigmas)
    expect(p).toBeLessThan(0.01)
  })

  it('direction=below gives complement of above', () => {
    const temps = [25, 25, 25]
    const weights = [0.4, 0.3, 0.3]
    const sigmas = [1.0, 1.0, 1.0]
    const pAbove = bmaThresholdProbability(temps, weights, 24, 'above', sigmas)
    const pBelow = bmaThresholdProbability(temps, weights, 24, 'below', sigmas)
    expect(pAbove + pBelow).toBeCloseTo(1.0, 5)
  })

  it('empty input → returns 0.5 fallback', () => {
    expect(bmaThresholdProbability([], [], 25, 'above', [])).toBe(0.5)
  })
})

// ---------------------------------------------------------------------------
// 3. getPerSourceSigma
// ---------------------------------------------------------------------------
describe('getPerSourceSigma', () => {
  const baseTemps = [25, 25, 25, 25, 25]
  const baseWeights = [0.35, 0.35, 0.1, 0.1, 0.1]
  const baseNames = ['NWS', 'AccuWeather', 'Open-Meteo', 'Google-Weather', 'Tomorrow.io']

  it('zero spread (all same temp) → returns σ_aleatoric (no epistemic)', () => {
    const sigma = getPerSourceSigma('NWS', 24, baseTemps, baseWeights, baseNames)
    // 24h falls in lt30h bucket
    const expected = SIGMA_SOURCE_TABLE['NWS']['lt30h']
    expect(sigma).toBeCloseTo(expected, 3)
  })

  it('large source deviation → returns value > σ_aleatoric', () => {
    const temps = [30, 25, 25, 25, 25]
    const sigma = getPerSourceSigma('NWS', 24, temps, baseWeights, baseNames)
    const aleatoric = SIGMA_SOURCE_TABLE['NWS']['lt30h']
    expect(sigma).toBeGreaterThan(aleatoric)
  })

  it('missing source in SIGMA_SOURCE_TABLE → falls back to SIGMA_ALEATORIC_TABLE', () => {
    const sigma = getPerSourceSigma('UnknownSource', 24, baseTemps, baseWeights, baseNames)
    const expected = SIGMA_ALEATORIC_TABLE['lt30h']
    expect(sigma).toBeCloseTo(expected, 3)
  })

  it('single source → σ_epistemic = 0, σ_total = σ_aleatoric', () => {
    const sigma = getPerSourceSigma('NWS', 24, [25], [1.0], ['NWS'])
    const expected = SIGMA_SOURCE_TABLE['NWS']['lt30h']
    expect(sigma).toBeCloseTo(expected, 3)
  })

  it('lead bucket mapping: ≤18h → lt18h', () => {
    const sigma = getPerSourceSigma('NWS', 12, baseTemps, baseWeights, baseNames)
    expect(sigma).toBeCloseTo(SIGMA_SOURCE_TABLE['NWS']['lt18h'], 3)
  })

  it('lead bucket mapping: >42h → gt42h', () => {
    const sigma = getPerSourceSigma('NWS', 45, baseTemps, baseWeights, baseNames)
    expect(sigma).toBeCloseTo(SIGMA_SOURCE_TABLE['NWS']['gt42h'], 3)
  })

  it('hard floor: σ never below 0.4°C', () => {
    const sigma = getPerSourceSigma('NWS', 24, baseTemps, baseWeights, baseNames)
    expect(sigma).toBeGreaterThanOrEqual(0.4)
  })
})

// ---------------------------------------------------------------------------
// 4. BMA integration through calculate*Probability
// ---------------------------------------------------------------------------
describe('BMA integration through calculateTemperatureProbability', () => {
  const ensemble = makeEnsemble([
    { name: 'NWS', maxTemp: 25 },
    { name: 'AccuWeather', maxTemp: 25 },
    { name: 'Open-Meteo', maxTemp: 25 },
    { name: 'Google-Weather', maxTemp: 25 },
    { name: 'Tomorrow.io', maxTemp: 25 },
  ], { hoursToResolution: 24 })

  it('returns valid probability in [0.02, 0.95]', () => {
    const result = calculateTemperatureProbability(ensemble, 24, 'above')
    expect(result.probability).toBeGreaterThanOrEqual(0.02)
    expect(result.probability).toBeLessThanOrEqual(0.95)
  })

  it('reasoning string includes BMA label', () => {
    const result = calculateTemperatureProbability(ensemble, 24, 'above')
    expect(result.reasoning).toContain('BMA')
  })
})

describe('BMA integration through calculateBracketProbability', () => {
  const ensemble = makeEnsemble([
    { name: 'NWS', maxTemp: 25 },
    { name: 'AccuWeather', maxTemp: 25 },
    { name: 'Open-Meteo', maxTemp: 25 },
    { name: 'Google-Weather', maxTemp: 25 },
    { name: 'Tomorrow.io', maxTemp: 25 },
  ], { hoursToResolution: 24 })

  it('peak bracket gets meaningful probability', () => {
    const result = calculateBracketProbability(ensemble, 24.5, 25.5)
    expect(result.probability).toBeGreaterThan(0.15)
  })

  it('reasoning string includes BMA label', () => {
    const result = calculateBracketProbability(ensemble, 24.5, 25.5)
    expect(result.reasoning).toContain('BMA')
  })

  it('far-away bracket gets low probability', () => {
    const result = calculateBracketProbability(ensemble, 35, 36)
    expect(result.probability).toBeLessThan(0.05)
  })

  it('4 sources (Tomorrow.io dropped) still produces valid probability', () => {
    const partial = makeEnsemble([
      { name: 'NWS', maxTemp: 25 },
      { name: 'AccuWeather', maxTemp: 25 },
      { name: 'Open-Meteo', maxTemp: 25 },
      { name: 'Google-Weather', maxTemp: 25 },
    ], { hoursToResolution: 24 })
    const result = calculateBracketProbability(partial, 24.5, 25.5)
    expect(result.probability).toBeGreaterThanOrEqual(0.02)
    expect(result.probability).toBeLessThanOrEqual(0.95)
    expect(result.reasoning).toContain('4 sources')
  })
})
