import { describe, it, expect } from 'vitest'
import { filterEnsembleByDate } from '@/lib/utils/ensembleDateFilter'
import type { WeatherEnsemble, WeatherForecast } from '@/types/weather'

function forecast(input: Partial<WeatherForecast>): WeatherForecast {
  return {
    location: { lat: 40.7128, lng: -74.006, city: 'New York', timezone: 'America/New_York' },
    timestamp: '2026-02-23T12:00:00-05:00',
    temperature: { current: 10, min: 8, max: 12 },
    precipitation: { probability: 0.2, amount: 0.0 },
    conditions: 'Clear',
    source: 'Open-Meteo',
    dataAge: 0,
    confidence: 80,
    ...input,
  }
}

function ensemble(forecasts: WeatherForecast[]): WeatherEnsemble {
  return {
    location: { lat: 40.7128, lng: -74.006, city: 'New York', timezone: 'America/New_York' },
    forecasts,
    consensus: {
      temperatureRange: [5, 15],
      temperatureMean: 10,
      precipProbability: 0.25,
      modelAgreement: 75,
      dataQuality: 90,
    },
    sources: [...new Set(forecasts.map(f => f.source))],
    timestamp: Date.now(),
  }
}

describe('filterEnsembleByDate', () => {
  it('filters to weather day and recomputes sources/consensus', () => {
    const forecasts: WeatherForecast[] = [
      // target weather day (resolution-1)
      forecast({ source: 'Open-Meteo', timestamp: '2026-02-23T12:00:00-05:00', temperature: { current: 10, min: 8, max: 12 } }),
      forecast({ source: 'NWS', timestamp: '2026-02-23T12:00:00-05:00', temperature: { current: 11, min: 9, max: 13 } }),
      // hourly-only Google data on target weather day
      forecast({ source: 'Google-Weather', timestamp: '2026-02-23T06:00:00-05:00', temperature: { current: 7, min: 7, max: 7 } }),
      forecast({ source: 'Google-Weather', timestamp: '2026-02-23T18:00:00-05:00', temperature: { current: 14, min: 14, max: 14 } }),
      // different day, should be filtered out
      forecast({ source: 'Open-Meteo', timestamp: '2026-02-24T12:00:00-05:00', temperature: { current: 20, min: 18, max: 22 } }),
    ]

    const result = filterEnsembleByDate(
      ensemble(forecasts),
      '2026-02-24T14:00:00Z'
    )

    // one Open-Meteo daily + one NWS daily + one synthesized Google daily
    expect(result).not.toBeNull()
    expect(result!.forecasts.length).toBe(3)
    expect(new Set(result!.sources)).toEqual(new Set(['Open-Meteo', 'NWS', 'Google-Weather']))

    const google = result!.forecasts.find(f => f.source === 'Google-Weather')
    expect(google?.temperature.min).toBe(7)
    expect(google?.temperature.max).toBe(14)

    // recomputed consensus should differ from initial placeholder
    expect(result!.consensus.temperatureMean).not.toBe(10)
  })

  it('falls back to original ensemble when no weather-day forecasts match', () => {
    const original = ensemble([
      forecast({ source: 'Open-Meteo', timestamp: '2026-02-25T12:00:00-05:00' }),
      forecast({ source: 'NWS', timestamp: '2026-02-25T12:00:00-05:00' }),
    ])

    const result = filterEnsembleByDate(original, '2026-02-24T14:00:00Z')

    expect(result).toBe(original)
  })

  it('returns null with failClosed when no weather-day forecasts match', () => {
    const original = ensemble([
      forecast({ source: 'Open-Meteo', timestamp: '2026-02-25T12:00:00-05:00' }),
      forecast({ source: 'NWS', timestamp: '2026-02-25T12:00:00-05:00' }),
    ])

    const result = filterEnsembleByDate(original, '2026-02-24T14:00:00Z', { failClosed: true })

    expect(result).toBeNull()
  })
})
