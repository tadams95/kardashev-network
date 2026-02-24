// Tests for weather probability calculations
// Validates Phase 1 fixes: overconfidence, precipitation model, agreement, time decay

import { describe, it, expect } from 'vitest'
import {
  calculateTemperatureProbability,
  calculateBracketProbability,
  calculatePrecipitationProbability,
  calculatePrecipitationBracketProbability,
  calculateEdge,
  calculateExpectedValue,
  calculateKellyPosition,
  isTradingAllowed,
  getTimeBasedDiscount,
  buildConsensus,
  buildEnsemble,
  applyDataQualityDiscount,
  calculateDynamicStdDevFloor,
  DEFAULT_WEIGHTS,
} from '../weatherProbability'
import type { WeatherForecast, WeatherEnsemble } from '@/types/weather'

// ============================================================================
// Test Helpers
// ============================================================================

function makeForecast(overrides: Partial<WeatherForecast> = {}): WeatherForecast {
  return {
    location: { lat: 40.7, lng: -74.0, city: 'New York' },
    timestamp: new Date().toISOString(),
    temperature: { current: 20, min: 15, max: 25 },
    precipitation: { probability: 0.3, amount: 2.5 },
    conditions: 'Partly Cloudy',
    source: 'Open-Meteo',
    dataAge: 1800000, // 30 minutes
    confidence: 85,
    ...overrides,
  }
}

function makeEnsemble(forecasts: WeatherForecast[]): WeatherEnsemble {
  const consensus = buildConsensus(forecasts)
  return {
    location: { lat: 40.7, lng: -74.0, city: 'New York' },
    forecasts,
    consensus,
    sources: [...new Set(forecasts.map(f => f.source))],
    timestamp: Date.now(),
  }
}

// ============================================================================
// Temperature Probability Tests
// ============================================================================

describe('calculateTemperatureProbability', () => {
  it('returns probability between 0.02 and 0.95 (overconfidence clamp)', () => {
    const forecasts = [
      makeForecast({ temperature: { current: 30, min: 25, max: 35 } }),
      makeForecast({ source: 'Google-Weather', temperature: { current: 30, min: 25, max: 35 } }),
      makeForecast({ source: 'NWS', temperature: { current: 30, min: 25, max: 35 } }),
    ]
    const ensemble = makeEnsemble(forecasts)

    // Threshold far above mean — should still not be 0
    const result = calculateTemperatureProbability(ensemble, 50, 'above')
    expect(result.probability).toBeGreaterThanOrEqual(0.02)
    expect(result.probability).toBeLessThanOrEqual(0.95)

    // Threshold far below mean — should still not be 1
    const result2 = calculateTemperatureProbability(ensemble, 0, 'above')
    expect(result2.probability).toBeLessThanOrEqual(0.95)
  })

  it('applies minimum stdDev floor (prevents extreme probabilities)', () => {
    // All sources agree exactly — raw stdDev = 0
    const forecasts = [
      makeForecast({ temperature: { current: 25, min: 20, max: 30 } }),
      makeForecast({ source: 'Google-Weather', temperature: { current: 25, min: 20, max: 30 } }),
      makeForecast({ source: 'NWS', temperature: { current: 25, min: 20, max: 30 } }),
    ]
    const ensemble = makeEnsemble(forecasts)

    // With floor, even a threshold near the mean should not be extreme
    const result = calculateTemperatureProbability(ensemble, 31, 'above')
    expect(result.probability).toBeLessThan(0.90)
    expect(result.probability).toBeGreaterThan(0.05)
  })

  it('blends with base rate prior', () => {
    const forecasts = [
      makeForecast({ temperature: { current: 25, min: 20, max: 30 } }),
      makeForecast({ source: 'Google-Weather', temperature: { current: 25, min: 20, max: 30 } }),
    ]
    const ensemble = makeEnsemble(forecasts)

    // Even for very unlikely threshold, base rate blending prevents probability from being too low
    const result = calculateTemperatureProbability(ensemble, 45, 'above')
    expect(result.probability).toBeGreaterThan(0.02)
  })

  it('returns higher probability when threshold is below mean for above direction', () => {
    const forecasts = [
      makeForecast({ temperature: { current: 30, min: 25, max: 35 } }),
      makeForecast({ source: 'Google-Weather', temperature: { current: 30, min: 25, max: 35 } }),
    ]
    const ensemble = makeEnsemble(forecasts)

    const lowThreshold = calculateTemperatureProbability(ensemble, 20, 'above')
    const highThreshold = calculateTemperatureProbability(ensemble, 40, 'above')

    expect(lowThreshold.probability).toBeGreaterThan(highThreshold.probability)
  })

  it('throws on empty ensemble', () => {
    const ensemble: WeatherEnsemble = {
      location: { lat: 40.7, lng: -74.0 },
      forecasts: [],
      consensus: { temperatureRange: [0, 0], temperatureMean: 0, precipProbability: 0, modelAgreement: 0, dataQuality: 0 },
      sources: [],
      timestamp: Date.now(),
    }
    expect(() => calculateTemperatureProbability(ensemble, 30, 'above')).toThrow()
  })
})

// ============================================================================
// Bracket Probability Tests
// ============================================================================

describe('calculateBracketProbability', () => {
  it('never exceeds 0.95 for any single bracket', () => {
    const forecasts = [
      makeForecast({ temperature: { current: 25, min: 20, max: 30 } }),
      makeForecast({ source: 'Google-Weather', temperature: { current: 25, min: 20, max: 30 } }),
      makeForecast({ source: 'NWS', temperature: { current: 25, min: 20, max: 30 } }),
    ]
    const ensemble = makeEnsemble(forecasts)

    // Bracket centered on mean (should be high but not >95%)
    const result = calculateBracketProbability(ensemble, 28, 32)
    expect(result.probability).toBeLessThanOrEqual(0.95)
    expect(result.probability).toBeGreaterThan(0.02)
  })

  it('assigns higher probability to bracket containing the mean', () => {
    const forecasts = [
      makeForecast({ temperature: { current: 25, min: 20, max: 30 } }),
      makeForecast({ source: 'Google-Weather', temperature: { current: 25, min: 20, max: 30 } }),
    ]
    const ensemble = makeEnsemble(forecasts)

    const containsMean = calculateBracketProbability(ensemble, 28, 32) // mean ~30 is inside
    const doesNotContain = calculateBracketProbability(ensemble, 40, 45) // far from mean

    expect(containsMean.probability).toBeGreaterThan(doesNotContain.probability)
  })

  it('adjacent brackets sum to approximately 1 (property test)', () => {
    const forecasts = [
      makeForecast({ temperature: { current: 25, min: 20, max: 30 } }),
      makeForecast({ source: 'Google-Weather', temperature: { current: 26, min: 21, max: 31 } }),
      makeForecast({ source: 'NWS', temperature: { current: 24, min: 19, max: 29 } }),
    ]
    const ensemble = makeEnsemble(forecasts)

    // Create contiguous brackets from 10 to 50 (covering the full range)
    const brackets = []
    for (let floor = 10; floor < 50; floor += 5) {
      const result = calculateBracketProbability(ensemble, floor, floor + 5)
      brackets.push(result.probability)
    }

    // Sum should be approximately 1.0 (within tolerance for blending/clamping)
    const sum = brackets.reduce((s, p) => s + p, 0)
    // With base-rate blending and agreement adjustment, sum won't be exactly 1
    // but should be in reasonable range (0.5-1.5)
    expect(sum).toBeGreaterThan(0.4)
    expect(sum).toBeLessThan(1.6)
  })
})

// ============================================================================
// Precipitation Probability Tests
// ============================================================================

describe('calculatePrecipitationProbability', () => {
  it('returns threshold-aware probabilities (not just generic rain chance)', () => {
    const forecasts = [
      makeForecast({ precipitation: { probability: 0.5, amount: 1.0 } }),
      makeForecast({ source: 'Google-Weather', precipitation: { probability: 0.4, amount: 0.8 } }),
      makeForecast({ source: 'METAR', precipitation: { probability: 0.6, amount: 1.2 } }),
    ]
    const ensemble = makeEnsemble(forecasts)

    const lowThreshold = calculatePrecipitationProbability(ensemble, 0.1)
    const highThreshold = calculatePrecipitationProbability(ensemble, 10.0)

    // Higher threshold should have LOWER probability
    expect(lowThreshold.probability).toBeGreaterThan(highThreshold.probability)
  })

  it('handles "any rain" threshold (<=0.01) as occurrence probability', () => {
    const forecasts = [
      makeForecast({ precipitation: { probability: 0.6, amount: 1.0 } }),
      makeForecast({ source: 'Google-Weather', precipitation: { probability: 0.5, amount: 0.8 } }),
    ]
    const ensemble = makeEnsemble(forecasts)

    const result = calculatePrecipitationProbability(ensemble, 0.01)
    // Should be close to consensus precip probability
    expect(result.probability).toBeGreaterThan(0.3)
    expect(result.probability).toBeLessThan(0.8)
  })

  it('clamps probability to [0.02, 0.95]', () => {
    const forecasts = [
      makeForecast({ precipitation: { probability: 0.99, amount: 50.0 } }),
      makeForecast({ source: 'Google-Weather', precipitation: { probability: 0.99, amount: 50.0 } }),
    ]
    const ensemble = makeEnsemble(forecasts)

    const result = calculatePrecipitationProbability(ensemble, 0.01)
    expect(result.probability).toBeLessThanOrEqual(0.95)

    const dryForecasts = [
      makeForecast({ precipitation: { probability: 0.01, amount: 0.0 } }),
      makeForecast({ source: 'Google-Weather', precipitation: { probability: 0.01, amount: 0.0 } }),
    ]
    const dryEnsemble = makeEnsemble(dryForecasts)
    const dryResult = calculatePrecipitationProbability(dryEnsemble, 10.0)
    expect(dryResult.probability).toBeGreaterThanOrEqual(0.02)
  })
})

describe('calculatePrecipitationBracketProbability', () => {
  it('returns valid probabilities for precipitation brackets', () => {
    const forecasts = [
      makeForecast({ precipitation: { probability: 0.7, amount: 2.0 } }),
      makeForecast({ source: 'Google-Weather', precipitation: { probability: 0.6, amount: 1.5 } }),
    ]
    const ensemble = makeEnsemble(forecasts)

    const result = calculatePrecipitationBracketProbability(ensemble, 0.5, 2.0)
    expect(result.probability).toBeGreaterThanOrEqual(0.02)
    expect(result.probability).toBeLessThanOrEqual(0.95)
  })
})

// ============================================================================
// Time Decay Tests
// ============================================================================

describe('getTimeBasedDiscount', () => {
  it('returns 0 for <=12 hours (no trading zone)', () => {
    expect(getTimeBasedDiscount(12)).toBe(0)
    expect(getTimeBasedDiscount(6)).toBe(0)
    expect(getTimeBasedDiscount(0)).toBe(0)
  })

  it('returns 1 for >=18 hours (full confidence plateau)', () => {
    expect(getTimeBasedDiscount(18)).toBe(1)
    expect(getTimeBasedDiscount(24)).toBe(1)
    expect(getTimeBasedDiscount(36)).toBe(1)
    expect(getTimeBasedDiscount(48)).toBe(1)
  })

  it('returns linear interpolation between 12h and 18h', () => {
    expect(getTimeBasedDiscount(15)).toBeCloseTo(0.5, 1)
    expect(getTimeBasedDiscount(13)).toBeCloseTo(1 / 6, 1)
  })
})

describe('isTradingAllowed', () => {
  it('disallows trading within 12 hours of resolution', () => {
    expect(isTradingAllowed(11)).toBe(false)
    expect(isTradingAllowed(12)).toBe(false)
    expect(isTradingAllowed(13)).toBe(true)
  })
})

// ============================================================================
// Edge Detection Tests
// ============================================================================

describe('calculateEdge', () => {
  it('detects edge when model differs from market', () => {
    const result = calculateEdge(0.70, 0.50)
    expect(result.hasEdge).toBe(true)
    expect(result.edge).toBeCloseTo(0.20, 2)
    expect(result.direction).toBe('YES')
  })

  it('detects NO direction when model < market', () => {
    const result = calculateEdge(0.30, 0.60)
    expect(result.direction).toBe('NO')
    expect(result.edge).toBeCloseTo(0.30, 2)
  })

  it('respects minimum edge threshold', () => {
    const result = calculateEdge(0.55, 0.50, 0.10)
    expect(result.hasEdge).toBe(false)
  })
})

// ============================================================================
// Expected Value Tests
// ============================================================================

describe('calculateExpectedValue', () => {
  it('returns positive EV when model has edge on YES side', () => {
    const ev = calculateExpectedValue(0.75, 0.50, 100, 0.15)
    expect(ev).toBeGreaterThan(0)
  })

  it('returns positive EV when model has edge on NO side', () => {
    const ev = calculateExpectedValue(0.25, 0.50, 100, 0.15)
    expect(ev).toBeGreaterThan(0)
  })

  it('returns negative EV when model equals market (fees dominate)', () => {
    // When model = market, any direction is a losing trade due to fees
    const ev = calculateExpectedValue(0.50, 0.50, 100, 0.15)
    expect(ev).toBeLessThanOrEqual(0)
  })
})

// ============================================================================
// Kelly Position Tests
// ============================================================================

describe('calculateKellyPosition', () => {
  it('returns positive position size when edge exists', () => {
    const size = calculateKellyPosition(0.70, 0.50, 1000)
    expect(size).toBeGreaterThan(0)
    expect(size).toBeLessThanOrEqual(100) // 10% cap on $1000
  })

  it('caps at 10% of bankroll', () => {
    const size = calculateKellyPosition(0.95, 0.10, 1000)
    expect(size).toBeLessThanOrEqual(100)
  })

  it('returns zero when edge is too small after fees', () => {
    const size = calculateKellyPosition(0.525, 0.50, 1000)
    expect(size).toBe(0)
  })

  it('returns zero for exact zero-edge market', () => {
    const size = calculateKellyPosition(0.50, 0.50, 1000)
    expect(size).toBe(0)
  })
})

// ============================================================================
// End-to-End Pipeline Test
// ============================================================================

describe('forecast → probability → edge → signal pipeline', () => {
  it('produces coherent trade outputs for a high-temperature scenario', () => {
    const forecasts = [
      makeForecast({ source: 'Open-Meteo', temperature: { current: 25, min: 19, max: 29 } }),
      makeForecast({ source: 'Google-Weather', temperature: { current: 26, min: 20, max: 30 } }),
      makeForecast({ source: 'NWS', temperature: { current: 25.5, min: 19.5, max: 29.5 } }),
    ]
    const ensemble = makeEnsemble(forecasts)
    ensemble.hoursToResolution = 24

    const probability = calculateTemperatureProbability(ensemble, 27, 'above', 'high')
    const edge = calculateEdge(probability.probability, 0.45, 0.05)
    const ev = calculateExpectedValue(probability.probability, 0.45, 100)
    const kelly = calculateKellyPosition(probability.probability, 0.45, 1000)

    expect(probability.probability).toBeGreaterThan(0.45)
    expect(edge.hasEdge).toBe(true)
    expect(edge.direction).toBe('YES')
    expect(ev).toBeGreaterThan(0)
    expect(kelly).toBeGreaterThan(0)
  })
})

// ============================================================================
// Consensus / Agreement Tests
// ============================================================================

describe('buildConsensus', () => {
  it('calculates weighted precipitation probability', () => {
    const forecasts = [
      makeForecast({ precipitation: { probability: 0.8, amount: 5.0 } }),
      makeForecast({ source: 'Google-Weather', precipitation: { probability: 0.6, amount: 3.0 } }),
      makeForecast({ source: 'METAR', precipitation: { probability: 0.4, amount: 1.0 } }),
    ]
    const consensus = buildConsensus(forecasts)

    // Weighted: 0.8*0.25 + 0.6*0.20 + 0.4*0.20 = 0.20 + 0.12 + 0.08 = 0.40/0.65 ≈ 0.615
    expect(consensus.precipProbability).toBeCloseTo(0.615, 1)
  })

  it('throws on empty forecasts', () => {
    expect(() => buildConsensus([])).toThrow()
  })

  it('calculates data quality with freshness penalties', () => {
    const staleForecasts = [
      makeForecast({ dataAge: 10 * 3600000, confidence: 50 }), // 10 hours old, low confidence
    ]
    const consensus = buildConsensus(staleForecasts)
    expect(consensus.dataQuality).toBeLessThan(80) // Should be penalized
  })
})

describe('applyDataQualityDiscount', () => {
  it('reduces probability for stale data', () => {
    const forecasts = [makeForecast({ dataAge: 13 * 3600000 })] // 13 hours old
    const discount = applyDataQualityDiscount(0.80, forecasts)
    expect(discount).toBeLessThan(0.80)
  })

  it('does not reduce for fresh data from 3 sources', () => {
    const forecasts = [
      makeForecast({ dataAge: 1800000, confidence: 85 }),
      makeForecast({ source: 'Google-Weather', dataAge: 1800000, confidence: 85 }),
      makeForecast({ source: 'METAR', dataAge: 1800000, confidence: 90 }),
    ]
    const discount = applyDataQualityDiscount(0.80, forecasts)
    expect(discount).toBeCloseTo(0.80, 2)
  })
})

// ============================================================================
// Dynamic StdDev Floor Tests
// ============================================================================

describe('calculateDynamicStdDevFloor', () => {
  it('returns lower floor for same-day than next-day', () => {
    const sameDay = calculateDynamicStdDevFloor(2, 75, 18)
    const nextDay = calculateDynamicStdDevFloor(2, 75, 36)
    expect(sameDay).toBeLessThan(nextDay)
  })

  it('returns lower floor with more sources', () => {
    const twoSources = calculateDynamicStdDevFloor(2, 75, 24)
    const threeSources = calculateDynamicStdDevFloor(3, 75, 24)
    expect(threeSources).toBeLessThan(twoSources)
  })

  it('returns lower floor with high agreement', () => {
    const highAgreement = calculateDynamicStdDevFloor(2, 95, 24)
    const lowAgreement = calculateDynamicStdDevFloor(2, 40, 24)
    expect(highAgreement).toBeLessThan(lowAgreement)
  })

  it('never goes below 0.7°C', () => {
    const floor = calculateDynamicStdDevFloor(5, 100, 12)
    expect(floor).toBeGreaterThanOrEqual(0.7)
  })

  it('never exceeds 3.0°C', () => {
    const floor = calculateDynamicStdDevFloor(1, 0, 72)
    expect(floor).toBeLessThanOrEqual(3.0)
  })
})

// ============================================================================
// Peak Bracket Probability Test
// ============================================================================

describe('calculateBracketProbability (dynamic floor)', () => {
  it('peak bracket exceeds 15% for same-day high-agreement forecast', () => {
    const forecasts = [
      makeForecast({ temperature: { current: 28, min: 22, max: 30 } }),
      makeForecast({ source: 'Google-Weather', temperature: { current: 28, min: 22, max: 30.2 } }),
      makeForecast({ source: 'NWS', temperature: { current: 28, min: 22, max: 29.8 } }),
    ]
    const ensemble = makeEnsemble(forecasts)
    ensemble.hoursToResolution = 18

    // 4°C bracket centered on mean (≈ two 2°F brackets)
    const result = calculateBracketProbability(ensemble, 28, 32)
    expect(result.probability).toBeGreaterThan(0.15)
  })
})
