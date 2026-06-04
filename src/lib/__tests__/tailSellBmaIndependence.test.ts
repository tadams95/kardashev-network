// Phase 1 BMA-deletion equivalence guard.
//
// The deletion of the BMA Gaussian-mixture machinery must leave tail-sell
// signal generation byte-identical (it is the live earning path). Tail-sell
// reads only the point-distribution fields (pointForecastF, spreadC,
// sourceCount, perSourceForecastsF, temperatureType) and never the BMA
// mixture outputs (components[].sigmaC, pAbove/pBelow/pBracket) — those are
// consumed only by the deprecated probability-model signal path.
//
// This suite is a *differential* proof: perturbing the BMA σ-tables provably
// moves the mixture closures (pBracket) while leaving the emitted tail-sell
// signals unchanged. If a future edit ever routes tail-sell through the
// mixture, the invariance assertion breaks loudly.

import { describe, it, expect } from 'vitest'
import { generateTailSellSignals } from '../computeOpportunities'
import { buildForecastDistribution } from '../models/forecastDistribution'
import {
  SIGMA_SOURCE_TABLE,
  SIGMA_ALEATORIC_TABLE,
} from '../models/weatherProbability'
import type {
  WeatherEnsemble,
  EnsembleWeights,
  WeatherMarket,
} from '@/types/weather'

// --- fixtures ---------------------------------------------------------------

function makeEnsemble(
  sources: { name: string; maxTemp: number; minTemp?: number }[],
  opts: { hoursToResolution?: number; activeWeights?: EnsembleWeights } = {},
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

// 5-source ensemble ≈ 25°C → point forecast ≈ 77°F
const FIVE_SOURCES = [
  { name: 'NWS', maxTemp: 26 },
  { name: 'AccuWeather', maxTemp: 24.5 },
  { name: 'Open-Meteo', maxTemp: 25.2 },
  { name: 'Google-Weather', maxTemp: 25.8 },
  { name: 'Tomorrow.io', maxTemp: 24.0 },
]

// Cold-side 'between' brackets, all ≥6°F below the ~77°F forecast, priced in
// the 5-15¢ tail band with enough volume to pass the gate.
function makeColdMarkets(): WeatherMarket[] {
  const mk = (id: string, floorF: number, capF: number): WeatherMarket => ({
    id,
    platform: 'Kalshi',
    question: `temp ${floorF}-${capF}°F`,
    outcome: 'between',
    threshold: floorF,
    capStrike: capF,
    direction: 'between',
    temperatureType: 'high',
    eventTicker: 'EVT-TEST',
    location: { lat: 40.7, lng: -74.0, city: 'TestCity' },
    resolutionTime: '2026-06-05T22:00:00Z',
    currentPrice: 0.08,
    volume: 500,
    status: 'active',
    tradingStatus: 'open',
  })
  return [mk('M-66-68', 66, 68), mk('M-64-66', 64, 66), mk('M-62-64', 62, 64)]
}

const LEAD_HOURS = 30 // within [12,48] and the high-confidence [18,36] band
const fToC = (f: number) => ((f - 32) * 5) / 9
// Strip the only non-deterministic field (Date.now() stamp) before comparing.
const omitTs = (sigs: ReturnType<typeof generateTailSellSignals>) =>
  sigs.map(({ timestamp, ...rest }) => rest)

function buildDist() {
  return buildForecastDistribution({
    ensemble: makeEnsemble(FIVE_SOURCES, { hoursToResolution: LEAD_HOURS }),
    temperatureType: 'high',
    biasCorrection: 0.3,
    cityCode: 'NYC',
    date: '2026-06-05',
  })!
}

// --- tests ------------------------------------------------------------------

describe('tail-sell is independent of the BMA σ-machinery (Phase 1 deletion guard)', () => {
  it('perturbing the BMA σ-tables moves pBracket but leaves tail-sell signals byte-identical', () => {
    const ts = Date.now()
    const probeFloorC = fToC(64)
    const probeCapC = fToC(66)

    const distBefore = buildDist()
    const signalsBefore = omitTs(
      generateTailSellSignals(distBefore, makeColdMarkets(), LEAD_HOURS, 'NYC', ts),
    )
    const probeBefore = distBefore.pBracket(probeFloorC, probeCapC)

    // The fixture must actually emit, or the test proves nothing.
    expect(signalsBefore.length).toBeGreaterThan(0)

    const origSource = { ...SIGMA_SOURCE_TABLE }
    const origAleatoric = { ...SIGMA_ALEATORIC_TABLE }
    try {
      // 100× every σ-table entry — this changes components[].sigmaC and every
      // mixture closure, but must not reach the point-forecast/spread tail-sell
      // depends on.
      for (const k of Object.keys(SIGMA_SOURCE_TABLE)) SIGMA_SOURCE_TABLE[k] *= 100
      for (const k of Object.keys(SIGMA_ALEATORIC_TABLE)) SIGMA_ALEATORIC_TABLE[k] *= 100

      const distAfter = buildDist()
      const signalsAfter = omitTs(
        generateTailSellSignals(distAfter, makeColdMarkets(), LEAD_HOURS, 'NYC', ts),
      )
      const probeAfter = distAfter.pBracket(probeFloorC, probeCapC)

      // The perturbation is genuinely live: the mixture probability moved.
      expect(probeAfter).not.toBeCloseTo(probeBefore, 6)
      // ...yet tail-sell output is unchanged.
      expect(signalsAfter).toEqual(signalsBefore)
    } finally {
      for (const k of Object.keys(SIGMA_SOURCE_TABLE)) delete SIGMA_SOURCE_TABLE[k]
      Object.assign(SIGMA_SOURCE_TABLE, origSource)
      for (const k of Object.keys(SIGMA_ALEATORIC_TABLE)) delete SIGMA_ALEATORIC_TABLE[k]
      Object.assign(SIGMA_ALEATORIC_TABLE, origAleatoric)
    }
  })

  it('emitted signal forecastF/spreadF equal the point distribution, not the mixture', () => {
    const dist = buildDist()
    const signals = generateTailSellSignals(dist, makeColdMarkets(), LEAD_HOURS, 'NYC', Date.now())

    expect(signals.length).toBeGreaterThan(0)
    for (const s of signals) {
      expect(s.signalType).toBe('TAIL_SELL_NO')
      expect(s.direction).toBe('cold')
      expect(s.temperatureType).toBe('high')
      // The load-bearing equivalence: tail-sell numerics are the weighted-mean
      // point forecast and the weighted σ of source means — both BMA-free.
      expect(s.forecastF).toBeCloseTo(dist.pointForecastF, 10)
      expect(s.spreadF).toBeCloseTo((dist.spreadC * 9) / 5, 10)
      expect(s.sourceCount).toBe(dist.sourceCount)
      expect(s.yesPrice).toBeGreaterThanOrEqual(0.05)
      expect(s.yesPrice).toBeLessThanOrEqual(0.15)
    }
  })
})
