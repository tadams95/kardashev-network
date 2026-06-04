// Phase 1 BMA-deletion equivalence guard.
//
// The deletion of the BMA Gaussian-mixture machinery must leave tail-sell
// signal generation byte-identical (it is the live earning path). Tail-sell
// reads only the point-distribution fields (pointForecastF, spreadC,
// sourceCount, perSourceForecastsF, temperatureType) and never the BMA
// mixture outputs — those are consumed only by the deprecated
// probability-model signal path.
//
// This suite locks the emitted tail-sell output to a frozen GOLDEN snapshot
// captured from the pre-deletion code. The BMA σ-machinery (and the original
// differential σ-perturbation proof) is gone, so invariance is now proven by
// byte-equality against the golden array: any drift in the point-forecast /
// spread path that feeds tail-sell breaks this loudly.

import { describe, it, expect } from 'vitest'
import { generateTailSellSignals } from '../computeOpportunities'
import { buildForecastDistribution } from '../models/forecastDistribution'
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
// Strip the only non-deterministic field (Date.now() stamp) before comparing.
const omitTs = (sigs: ReturnType<typeof generateTailSellSignals>) =>
  sigs.map(({ timestamp, ...rest }) => rest)

// GOLDEN: the exact tail-sell output captured from the pre-BMA-deletion code
// for the FIVE_SOURCES / makeColdMarkets fixture at LEAD_HOURS=30. The emitted
// signal is entirely BMA-free (point forecast + weighted-σ spread only), so the
// deletion must reproduce this byte-for-byte.
const GOLDEN_SIGNALS = [
  {
    signalType: 'TAIL_SELL_NO',
    ticker: 'M-66-68',
    eventTicker: 'EVT-TEST',
    cityCode: 'NYC',
    forecastF: 77.7794,
    bracketFloorF: 66,
    bracketCapF: 68,
    bracketDistance: 5,
    direction: 'cold',
    yesPrice: 0.08,
    noSellPrice: 0.92,
    expectedProfit: 0.07200000000000001,
    leadHours: 30,
    spreadF: 1.389165087381626,
    confidence: 'high',
    sourceCount: 5,
    temperatureType: 'high',
    perSourceForecastsF: {
      NWS: 79.34,
      AccuWeather: 76.64,
      'Open-Meteo': 77.9,
      'Google-Weather': 78.98,
      'Tomorrow.io': 75.74000000000001,
    },
  },
  {
    signalType: 'TAIL_SELL_NO',
    ticker: 'M-64-66',
    eventTicker: 'EVT-TEST',
    cityCode: 'NYC',
    forecastF: 77.7794,
    bracketFloorF: 64,
    bracketCapF: 66,
    bracketDistance: 6,
    direction: 'cold',
    yesPrice: 0.08,
    noSellPrice: 0.92,
    expectedProfit: 0.07200000000000001,
    leadHours: 30,
    spreadF: 1.389165087381626,
    confidence: 'high',
    sourceCount: 5,
    temperatureType: 'high',
    perSourceForecastsF: {
      NWS: 79.34,
      AccuWeather: 76.64,
      'Open-Meteo': 77.9,
      'Google-Weather': 78.98,
      'Tomorrow.io': 75.74000000000001,
    },
  },
  {
    signalType: 'TAIL_SELL_NO',
    ticker: 'M-62-64',
    eventTicker: 'EVT-TEST',
    cityCode: 'NYC',
    forecastF: 77.7794,
    bracketFloorF: 62,
    bracketCapF: 64,
    bracketDistance: 7,
    direction: 'cold',
    yesPrice: 0.08,
    noSellPrice: 0.92,
    expectedProfit: 0.07200000000000001,
    leadHours: 30,
    spreadF: 1.389165087381626,
    confidence: 'high',
    sourceCount: 5,
    temperatureType: 'high',
    perSourceForecastsF: {
      NWS: 79.34,
      AccuWeather: 76.64,
      'Open-Meteo': 77.9,
      'Google-Weather': 78.98,
      'Tomorrow.io': 75.74000000000001,
    },
  },
]

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
  it('emits the frozen golden tail-sell output (BMA-free point/spread path)', () => {
    const dist = buildDist()
    const signals = omitTs(
      generateTailSellSignals(dist, makeColdMarkets(), LEAD_HOURS, 'NYC', Date.now()),
    )

    // The fixture must actually emit, or the test proves nothing.
    expect(signals.length).toBeGreaterThan(0)
    // Byte-identical to the pre-deletion capture.
    expect(signals).toEqual(GOLDEN_SIGNALS)
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
