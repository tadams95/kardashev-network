// ForecastDistribution unit tests
// Tests: equivalence with existing BMA functions, point forecasts,
// complementarity, bracket consistency, edge cases

import { describe, it, expect } from 'vitest'
import { buildForecastDistribution } from '../forecastDistribution'
import { bmaBracketProbability, bmaThresholdProbability } from '../distributions'
import { getPerSourceSigma, DEFAULT_WEIGHTS } from '../weatherProbability'
import type { WeatherEnsemble, EnsembleWeights } from '@/types/weather'

// ---------------------------------------------------------------------------
// Helper: build a minimal WeatherEnsemble (mirrors bma.test.ts pattern)
// ---------------------------------------------------------------------------
function makeEnsemble(
  sources: { name: string; maxTemp: number; minTemp?: number }[],
  opts: { hoursToResolution?: number; activeWeights?: EnsembleWeights } = {}
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
      modelAgreement: 90,
      dataQuality: 90,
    },
    location: { city: 'TestCity', lat: 40.7, lng: -74.0 },
    hoursToResolution: opts.hoursToResolution ?? 24,
    activeWeights: opts.activeWeights,
  } as unknown as WeatherEnsemble
}

// Helper: get forecast weights matching what buildForecastDistribution uses
function getNormalizedWeights(
  sources: string[],
  weights: EnsembleWeights = DEFAULT_WEIGHTS
): number[] {
  const raw = sources.map(s => weights[s] ?? 0.10)
  const total = raw.reduce((s, w) => s + w, 0)
  if (total === 0) return sources.map(() => 1 / sources.length)
  return raw.map(w => w / total)
}

// Standard 5-source ensemble for reuse
const FIVE_SOURCES = [
  { name: 'NWS', maxTemp: 26 },
  { name: 'AccuWeather', maxTemp: 24.5 },
  { name: 'Open-Meteo', maxTemp: 25.2 },
  { name: 'Google-Weather', maxTemp: 25.8 },
  { name: 'Tomorrow.io', maxTemp: 24.0 },
]

const BIAS = 0.3 // °C

// ---------------------------------------------------------------------------
// 1. Equivalence: pBracket vs bmaBracketProbability
// ---------------------------------------------------------------------------
describe('pBracket equivalence with bmaBracketProbability', () => {
  it('matches for multiple bracket pairs on 5-source ensemble', () => {
    const ensemble = makeEnsemble(FIVE_SOURCES, { hoursToResolution: 24 })
    const dist = buildForecastDistribution({
      ensemble,
      temperatureType: 'high',
      biasCorrection: BIAS,
      cityCode: 'NYC',
      date: '2026-03-28',
    })!

    // Reconstruct the arrays that bmaBracketProbability expects
    const sourceNames = FIVE_SOURCES.map(s => s.name)
    const correctedTemps = FIVE_SOURCES.map(s => s.maxTemp + BIAS)
    const forecastWeights = getNormalizedWeights(sourceNames)
    const sigmas = sourceNames.map(s =>
      getPerSourceSigma(s, 24, correctedTemps, forecastWeights, sourceNames)
    )

    const brackets: [number, number][] = [
      [24, 25], [25, 26], [23, 27], [20, 30], [26, 27],
    ]

    for (const [floor, cap] of brackets) {
      const fromDist = dist.pBracket(floor, cap)
      const fromBMA = bmaBracketProbability(correctedTemps, forecastWeights, floor, cap, sigmas)
      expect(fromDist).toBeCloseTo(fromBMA, 10)
    }
  })
})

// ---------------------------------------------------------------------------
// 2. Equivalence: pAbove vs bmaThresholdProbability
// ---------------------------------------------------------------------------
describe('pAbove equivalence with bmaThresholdProbability', () => {
  it('matches for multiple thresholds on 5-source ensemble', () => {
    const ensemble = makeEnsemble(FIVE_SOURCES, { hoursToResolution: 36 })
    const dist = buildForecastDistribution({
      ensemble,
      temperatureType: 'high',
      biasCorrection: BIAS,
      cityCode: 'NYC',
      date: '2026-03-28',
    })!

    const sourceNames = FIVE_SOURCES.map(s => s.name)
    const correctedTemps = FIVE_SOURCES.map(s => s.maxTemp + BIAS)
    const forecastWeights = getNormalizedWeights(sourceNames)
    const sigmas = sourceNames.map(s =>
      getPerSourceSigma(s, 36, correctedTemps, forecastWeights, sourceNames)
    )

    const thresholds = [20, 23, 25, 26, 28, 30]

    for (const t of thresholds) {
      const fromDist = dist.pAbove(t)
      const fromBMA = bmaThresholdProbability(correctedTemps, forecastWeights, t, 'above', sigmas)
      expect(fromDist).toBeCloseTo(fromBMA, 10)
    }
  })
})

// ---------------------------------------------------------------------------
// 3. pAbove + pBelow === 1.0
// ---------------------------------------------------------------------------
describe('pAbove + pBelow complementarity', () => {
  it('sums to exactly 1.0 for several thresholds', () => {
    const ensemble = makeEnsemble(FIVE_SOURCES, { hoursToResolution: 24 })
    const dist = buildForecastDistribution({
      ensemble,
      temperatureType: 'high',
      biasCorrection: 0,
      cityCode: 'NYC',
      date: '2026-03-28',
    })!

    for (const t of [15, 20, 25, 30, 35]) {
      expect(dist.pAbove(t) + dist.pBelow(t)).toBe(1.0)
    }
  })
})

// ---------------------------------------------------------------------------
// 4. pAllBrackets consistency
// ---------------------------------------------------------------------------
describe('pAllBrackets', () => {
  const ensemble = makeEnsemble(FIVE_SOURCES, { hoursToResolution: 24 })
  const dist = buildForecastDistribution({
    ensemble,
    temperatureType: 'high',
    biasCorrection: BIAS,
    cityCode: 'NYC',
    date: '2026-03-28',
  })!

  it('wide-range sum ≈ 1.0', () => {
    const boundaries: number[] = []
    for (let t = -50; t <= 100; t += 1) boundaries.push(t)
    const probs = dist.pAllBrackets(boundaries)
    const total = probs.reduce((s, p) => s + p, 0)
    expect(total).toBeGreaterThan(1 - 1e-6)
    expect(total).toBeLessThan(1 + 1e-6)
  })

  it('each element matches individual pBracket call', () => {
    const boundaries = [22, 23, 24, 25, 26, 27, 28]
    const probs = dist.pAllBrackets(boundaries)
    for (let i = 0; i < probs.length; i++) {
      expect(probs[i]).toBeCloseTo(dist.pBracket(boundaries[i], boundaries[i + 1]), 10)
    }
  })

  it('returns empty array for < 2 boundaries', () => {
    expect(dist.pAllBrackets([])).toEqual([])
    expect(dist.pAllBrackets([25])).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 5. Point forecast matches weighted mean
// ---------------------------------------------------------------------------
describe('point forecast', () => {
  it('pointForecastC equals weighted mean of corrected temps', () => {
    const ensemble = makeEnsemble(FIVE_SOURCES, { hoursToResolution: 24 })
    const dist = buildForecastDistribution({
      ensemble,
      temperatureType: 'high',
      biasCorrection: BIAS,
      cityCode: 'NYC',
      date: '2026-03-28',
    })!

    const sourceNames = FIVE_SOURCES.map(s => s.name)
    const correctedTemps = FIVE_SOURCES.map(s => s.maxTemp + BIAS)
    const forecastWeights = getNormalizedWeights(sourceNames)
    const expectedMean = correctedTemps.reduce((s, t, i) => s + t * forecastWeights[i], 0)

    expect(dist.pointForecastC).toBeCloseTo(expectedMean, 10)
  })

  it('pointForecastF equals pointForecastC * 9/5 + 32', () => {
    const ensemble = makeEnsemble(FIVE_SOURCES, { hoursToResolution: 24 })
    const dist = buildForecastDistribution({
      ensemble,
      temperatureType: 'high',
      biasCorrection: BIAS,
      cityCode: 'NYC',
      date: '2026-03-28',
    })!

    expect(dist.pointForecastF).toBeCloseTo(dist.pointForecastC * 9 / 5 + 32, 10)
  })

  it('rawPointForecastF reflects pre-bias weighted mean in °F', () => {
    const ensemble = makeEnsemble(FIVE_SOURCES, { hoursToResolution: 24 })
    const dist = buildForecastDistribution({
      ensemble,
      temperatureType: 'high',
      biasCorrection: BIAS,
      cityCode: 'NYC',
      date: '2026-03-28',
    })!

    const sourceNames = FIVE_SOURCES.map(s => s.name)
    const rawTemps = FIVE_SOURCES.map(s => s.maxTemp)
    const forecastWeights = getNormalizedWeights(sourceNames)
    const expectedRawF = rawTemps.reduce((s, t, i) => s + t * forecastWeights[i], 0) * 9 / 5 + 32

    expect(dist.rawPointForecastF).toBeCloseTo(expectedRawF, 10)
  })
})

// ---------------------------------------------------------------------------
// 6. Single source
// ---------------------------------------------------------------------------
describe('single source', () => {
  it('produces valid distribution with sensible probabilities', () => {
    const ensemble = makeEnsemble([{ name: 'NWS', maxTemp: 25 }], { hoursToResolution: 24 })
    const dist = buildForecastDistribution({
      ensemble,
      temperatureType: 'high',
      biasCorrection: 0,
      cityCode: 'NYC',
      date: '2026-03-28',
    })!

    expect(dist).not.toBeNull()
    expect(dist.sourceCount).toBe(1)
    expect(dist.components).toHaveLength(1)
    expect(dist.components[0].weight).toBe(1)

    // Bracket centered on 25°C should have high probability
    const p = dist.pBracket(24, 26)
    expect(p).toBeGreaterThan(0.2)
    expect(p).toBeLessThan(1)
  })
})

// ---------------------------------------------------------------------------
// 7. Null on 0 valid sources
// ---------------------------------------------------------------------------
describe('null on empty ensemble', () => {
  it('returns null when no forecast sources pass filter', () => {
    const ensemble = makeEnsemble([], { hoursToResolution: 24 })
    const dist = buildForecastDistribution({
      ensemble,
      temperatureType: 'high',
      biasCorrection: 0,
      cityCode: 'NYC',
      date: '2026-03-28',
    })

    expect(dist).toBeNull()
  })

  it('returns null when sources are non-forecast (e.g. METAR)', () => {
    const ensemble = {
      ...makeEnsemble([], { hoursToResolution: 24 }),
      forecasts: [
        {
          source: 'METAR',
          temperature: { max: 25, min: 17, current: 23 },
          humidity: 50,
          windSpeed: 10,
          precipitation: { probability: 10, amount: 0 },
          confidence: 85,
          dataAge: 3600000,
        },
      ],
    } as unknown as WeatherEnsemble

    const dist = buildForecastDistribution({
      ensemble,
      temperatureType: 'high',
      biasCorrection: 0,
      cityCode: 'NYC',
      date: '2026-03-28',
    })

    expect(dist).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 8. Identical source temps
// ---------------------------------------------------------------------------
describe('identical source temperatures', () => {
  it('point forecast equals that temp', () => {
    const sources = [
      { name: 'NWS', maxTemp: 25 },
      { name: 'AccuWeather', maxTemp: 25 },
      { name: 'Open-Meteo', maxTemp: 25 },
      { name: 'Google-Weather', maxTemp: 25 },
      { name: 'Tomorrow.io', maxTemp: 25 },
    ]
    const ensemble = makeEnsemble(sources, { hoursToResolution: 24 })
    const dist = buildForecastDistribution({
      ensemble,
      temperatureType: 'high',
      biasCorrection: 0,
      cityCode: 'NYC',
      date: '2026-03-28',
    })!

    expect(dist.pointForecastC).toBeCloseTo(25, 10)
    expect(dist.spreadC).toBeCloseTo(0, 10)
  })

  it('bracket centered on that temp has high probability', () => {
    const sources = [
      { name: 'NWS', maxTemp: 25 },
      { name: 'AccuWeather', maxTemp: 25 },
      { name: 'Open-Meteo', maxTemp: 25 },
    ]
    const ensemble = makeEnsemble(sources, { hoursToResolution: 24 })
    const dist = buildForecastDistribution({
      ensemble,
      temperatureType: 'high',
      biasCorrection: 0,
      cityCode: 'NYC',
      date: '2026-03-28',
    })!

    const p = dist.pBracket(24.5, 25.5)
    expect(p).toBeGreaterThan(0.15)
  })
})

// ---------------------------------------------------------------------------
// 9. Bias correction applied correctly
// ---------------------------------------------------------------------------
describe('bias correction', () => {
  it('shifts component means and point forecast', () => {
    const sources = [{ name: 'NWS', maxTemp: 25 }, { name: 'AccuWeather', maxTemp: 26 }]
    const bias = 2 // °C

    const distWithBias = buildForecastDistribution({
      ensemble: makeEnsemble(sources, { hoursToResolution: 24 }),
      temperatureType: 'high',
      biasCorrection: bias,
      cityCode: 'NYC',
      date: '2026-03-28',
    })!

    const distNoBias = buildForecastDistribution({
      ensemble: makeEnsemble(sources, { hoursToResolution: 24 }),
      temperatureType: 'high',
      biasCorrection: 0,
      cityCode: 'NYC',
      date: '2026-03-28',
    })!

    // Point forecast shifted by bias
    expect(distWithBias.pointForecastC).toBeCloseTo(distNoBias.pointForecastC + bias, 5)

    // Raw forecast unaffected by bias
    expect(distWithBias.rawPointForecastF).toBeCloseTo(distNoBias.rawPointForecastF, 5)

    // Component means shifted
    for (let i = 0; i < distWithBias.components.length; i++) {
      expect(distWithBias.components[i].meanC).toBeCloseTo(
        distNoBias.components[i].meanC + bias, 10
      )
    }
  })
})

// ---------------------------------------------------------------------------
// 10. perSourceForecastsF populated
// ---------------------------------------------------------------------------
describe('perSourceForecastsF', () => {
  it('contains bias-corrected temps in °F for each source', () => {
    const bias = 1.5
    const ensemble = makeEnsemble(FIVE_SOURCES, { hoursToResolution: 24 })
    const dist = buildForecastDistribution({
      ensemble,
      temperatureType: 'high',
      biasCorrection: bias,
      cityCode: 'NYC',
      date: '2026-03-28',
    })!

    for (const s of FIVE_SOURCES) {
      const expectedF = (s.maxTemp + bias) * 9 / 5 + 32
      expect(dist.perSourceForecastsF[s.name]).toBeCloseTo(expectedF, 10)
    }
  })
})

// ---------------------------------------------------------------------------
// Metadata fields
// ---------------------------------------------------------------------------
describe('metadata', () => {
  it('populates cityCode, date, temperatureType, leadBucket, sourceCount', () => {
    const ensemble = makeEnsemble(FIVE_SOURCES, { hoursToResolution: 24 })
    const dist = buildForecastDistribution({
      ensemble,
      temperatureType: 'low',
      biasCorrection: 0,
      cityCode: 'CHI',
      date: '2026-04-01',
    })!

    expect(dist.cityCode).toBe('CHI')
    expect(dist.date).toBe('2026-04-01')
    expect(dist.temperatureType).toBe('low')
    expect(dist.leadBucket).toBe('lt30h')
    expect(dist.sourceCount).toBe(5)
    expect(dist.hoursToResolution).toBe(24)
    expect(dist.biasCorrection).toBe(0)
  })

  it('uses temperatureType=low to read min temps', () => {
    const sources = [
      { name: 'NWS', maxTemp: 30, minTemp: 20 },
      { name: 'AccuWeather', maxTemp: 31, minTemp: 21 },
    ]
    const ensemble = makeEnsemble(sources, { hoursToResolution: 24 })

    const distHigh = buildForecastDistribution({
      ensemble,
      temperatureType: 'high',
      biasCorrection: 0,
      cityCode: 'NYC',
      date: '2026-03-28',
    })!

    const distLow = buildForecastDistribution({
      ensemble,
      temperatureType: 'low',
      biasCorrection: 0,
      cityCode: 'NYC',
      date: '2026-03-28',
    })!

    // High uses maxTemp, Low uses minTemp — means should differ by ~10°C
    expect(distHigh.pointForecastC).toBeGreaterThan(distLow.pointForecastC + 5)
  })
})
