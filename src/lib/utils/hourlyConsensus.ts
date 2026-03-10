// Shared hourly consensus computation
// Extracted from HourlyForecast.tsx for reuse in TemperatureGraph

import type { WeatherForecast } from '@/types/weather'
import { FORECAST_WEIGHTS } from '@/lib/models/weatherProbability'

// ============================================================================
// Types
// ============================================================================

export interface HourlyData {
  hour: number
  date: string
  temperature: number  // °C (consensus weighted average)
  precipProbability: number
  windSpeed: number | null
  weatherCode: number | null
  conditions: string
  isCurrentHour: boolean
  isPast: boolean
  isNextDay: boolean
  /** Epoch hour (ms/3600000) for stable sort ordering across DST transitions */
  epochHour: number
}

// ============================================================================
// Core: Compute weighted hourly consensus from multi-source forecasts
// ============================================================================

export function getHourlyConsensus(forecasts: WeatherForecast[], timezone: string): HourlyData[] {
  const now = new Date()
  const next24h = new Date(now.getTime() + 24 * 60 * 60 * 1000)

  // Timezone-aware formatters (always use city timezone)
  const hourFormatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', hour12: false })
  const dayFormatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' })

  const currentEpochHour = Math.floor(now.getTime() / 3600000)
  const todayStr = dayFormatter.format(now)

  // Filter to forecasts within the next 24 hours that are hourly (min === max) or METAR
  const hourlyForecasts = forecasts.filter(f => {
    const fDate = new Date(f.timestamp)
    if (fDate < now || fDate > next24h) return false
    if (f.source === 'METAR') return true
    return f.temperature.min === f.temperature.max
  })

  if (hourlyForecasts.length === 0) return []

  // Group by epoch hour to avoid DST fallback-hour collapse
  // Two 1:00 AM hours during fall-back get different epoch-hour keys
  const hourMap = new Map<string, WeatherForecast[]>()
  hourlyForecasts.forEach(f => {
    const fDate = new Date(f.timestamp)
    const epochHour = Math.floor(fDate.getTime() / 3600000)
    const key = String(epochHour)
    if (!hourMap.has(key)) hourMap.set(key, [])
    hourMap.get(key)!.push(f)
  })

  // Compute weighted average per hour
  const result: HourlyData[] = []
  hourMap.forEach((entries, epochKey) => {
    const epochHour = parseInt(epochKey, 10)
    // Derive display date/hour from the first entry's timestamp (timezone-aware)
    const representative = new Date(entries[0].timestamp)
    const dateStr = dayFormatter.format(representative)
    const hour = parseInt(hourFormatter.format(representative), 10)
    const isNextDay = dateStr !== todayStr

    let tempSum = 0
    let precipSum = 0
    let precipWeightSum = 0
    let weightSum = 0
    let windSpeed: number | null = null
    let windWeightSum = 0
    let windSum = 0
    let bestWeatherCode: number | null = null
    let bestWeatherWeight = -1
    let bestConditions = ''

    entries.forEach(f => {
      const w = FORECAST_WEIGHTS[f.source] ?? 0.15

      // Temperature consensus: exclude METAR (ground-truth obs, not forecast)
      if (f.source !== 'METAR') {
        const temp = f.temperature.current ?? f.temperature.max
        tempSum += temp * w
        weightSum += w
      }

      // Precipitation: exclude METAR (synthetic, not measured probability)
      if (f.source !== 'METAR') {
        precipSum += f.precipitation.probability * w
        precipWeightSum += w
      }

      // Wind speed (Google Weather and METAR only — Open-Meteo doesn't request wind)
      if (f.windSpeed != null) {
        windSum += f.windSpeed * w
        windWeightSum += w
      }

      // Weather code from highest-weighted source
      if (f.weatherCode != null && w > bestWeatherWeight) {
        bestWeatherCode = f.weatherCode
        bestWeatherWeight = w
        bestConditions = f.conditions
      }
    })

    if (weightSum === 0) return

    result.push({
      hour,
      date: dateStr,
      temperature: tempSum / weightSum,
      precipProbability: precipWeightSum > 0 ? precipSum / precipWeightSum : 0,
      windSpeed: windWeightSum > 0 ? windSum / windWeightSum : null,
      weatherCode: bestWeatherCode,
      conditions: bestConditions,
      isCurrentHour: epochHour === currentEpochHour,
      isPast: false, // All entries are in the future (filtered above)
      isNextDay,
      epochHour,
    })
  })

  // Sort by epoch hour for stable ordering across DST transitions
  return result.sort((a, b) => a.epochHour - b.epochHour)
}
