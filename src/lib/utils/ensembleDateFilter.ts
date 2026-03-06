import { buildConsensus } from '@/lib/models/weatherProbability'
import { getWeatherDateKeyFromResolution, localDateKey } from '@/lib/utils/weatherDate'
import type { WeatherEnsemble, WeatherForecast } from '@/types/weather'

/**
 * Filter ensemble forecasts to the weather day corresponding to a Kalshi market resolution time.
 * Recomputes consensus/sources to keep downstream confidence and spread metrics consistent.
 *
 * @param options.failClosed - When true, return null instead of falling back to the full ensemble
 *   if no forecasts match the target date. Use for trading paths where wrong-day data is worse
 *   than no data.
 */
export function filterEnsembleByDate(
  ensemble: WeatherEnsemble,
  resolutionTime: string,
  options?: { failClosed?: boolean; marketType?: 'high' | 'low' | 'precipitation' }
): WeatherEnsemble | null {
  const timezone = ensemble.location?.timezone || 'America/New_York'
  const weatherDate = getWeatherDateKeyFromResolution(resolutionTime, timezone)

  const matched = ensemble.forecasts.filter((f) => localDateKey(f.timestamp, timezone) === weatherDate)

  if (matched.length === 0) {
    if (options?.failClosed) {
      console.warn(
        `[filterEnsembleByDate] No forecasts matched weatherDate=${weatherDate} (tz=${timezone}) for resolution=${resolutionTime}. failClosed=true — returning null.`
      )
      return null
    }
    console.warn(
      `[filterEnsembleByDate] No forecasts matched weatherDate=${weatherDate} (tz=${timezone}) for resolution=${resolutionTime}. Falling back to full ensemble (${ensemble.forecasts.length} forecasts).`
    )
    return ensemble
  }

  const sourceMap = new Map<string, WeatherForecast[]>()
  for (const forecast of matched) {
    if (!sourceMap.has(forecast.source)) sourceMap.set(forecast.source, [])
    sourceMap.get(forecast.source)!.push(forecast)
  }

  const filtered: WeatherForecast[] = []
  for (const [, forecasts] of sourceMap) {
    const daily = forecasts.filter((f) => f.temperature.min !== f.temperature.max)
    if (daily.length > 0) {
      filtered.push(...daily)
      continue
    }

    const temps = forecasts
      .map((f) => f.temperature.current)
      .filter((t) => typeof t === 'number' && !isNaN(t))

    if (temps.length > 0) {
      const template = forecasts[0]
      filtered.push({
        ...template,
        temperature: {
          ...template.temperature,
          min: Math.min(...temps),
          max: Math.max(...temps),
        },
      })
    }
  }

  return {
    ...ensemble,
    forecasts: filtered,
    consensus: buildConsensus(filtered, undefined, options?.marketType),
    sources: [...new Set(filtered.map((f) => f.source))],
  }
}
