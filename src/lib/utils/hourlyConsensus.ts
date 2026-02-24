// Shared hourly consensus computation
// Extracted from HourlyForecast.tsx for reuse in TemperatureGraph

import type { WeatherForecast } from '@/types/weather'

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
}

// ============================================================================
// Source weights — aligned with DEFAULT_WEIGHTS from weatherProbability.ts
// METAR excluded from temperature consensus (ground-truth obs, not forecast)
// ============================================================================

export const SOURCE_WEIGHTS: Record<string, number> = {
  'Open-Meteo': 0.20,
  'Google-Weather': 0.15,
  'NWS': 0.30,
  'AccuWeather': 0.10,
  'Tomorrow.io': 0.10,
}

// ============================================================================
// Core: Compute weighted hourly consensus from multi-source forecasts
// ============================================================================

export function getHourlyConsensus(forecasts: WeatherForecast[], timezone?: string): HourlyData[] {
  const now = new Date()
  const next24h = new Date(now.getTime() + 24 * 60 * 60 * 1000)

  // Timezone-aware formatters
  const hourFormatter = timezone
    ? new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', hour12: false })
    : null
  const dayFormatter = timezone
    ? new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
    : null

  const currentHour = hourFormatter
    ? parseInt(hourFormatter.format(now), 10)
    : now.getHours()
  const todayStr = dayFormatter
    ? dayFormatter.format(now)
    : now.toDateString()

  // Filter to forecasts within the next 24 hours that are hourly (min === max) or METAR
  const hourlyForecasts = forecasts.filter(f => {
    const fDate = new Date(f.timestamp)
    if (fDate < now || fDate > next24h) return false
    if (f.source === 'METAR') return true
    return f.temperature.min === f.temperature.max
  })

  if (hourlyForecasts.length === 0) return []

  // Group by date+hour to handle cross-midnight correctly
  const hourMap = new Map<string, WeatherForecast[]>()
  hourlyForecasts.forEach(f => {
    const fDate = new Date(f.timestamp)
    const dateStr = dayFormatter ? dayFormatter.format(fDate) : fDate.toDateString()
    const hour = hourFormatter ? parseInt(hourFormatter.format(fDate), 10) : fDate.getHours()
    const key = `${dateStr}|${hour}`
    if (!hourMap.has(key)) hourMap.set(key, [])
    hourMap.get(key)!.push(f)
  })

  // Compute weighted average per hour
  const result: HourlyData[] = []
  hourMap.forEach((entries, key) => {
    const [dateStr, hourStr] = key.split('|')
    const hour = parseInt(hourStr, 10)
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
      const w = SOURCE_WEIGHTS[f.source] ?? 0.15

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
      isCurrentHour: !isNextDay && hour === currentHour,
      isPast: false, // All entries are in the future (filtered above)
      isNextDay,
    })
  })

  // Sort by date then hour
  return result.sort((a, b) => {
    if (a.isNextDay !== b.isNextDay) return a.isNextDay ? 1 : -1
    return a.hour - b.hour
  })
}
