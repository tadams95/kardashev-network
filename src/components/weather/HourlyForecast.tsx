// 24-hour forecast
// Horizontal scrollable grid showing hour-by-hour forecasts for the next 24 hours

import { useEffect, useRef } from 'react'
import type { WeatherForecast } from '@/types/weather'
import { celsiusToFahrenheit } from '@/lib/utils/temperature'
import { WeatherIcon } from '@/components/weather/WeatherIcon'
import { ScrollableCardRow } from '@/components/weather/ScrollableCardRow'

// ============================================================================
// Types
// ============================================================================

interface HourlyForecastProps {
  forecasts: WeatherForecast[]
  timezone?: string
}

interface HourlyData {
  hour: number
  date: string
  temperature: number
  precipProbability: number
  windSpeed: number | null
  weatherCode: number | null
  conditions: string
  isCurrentHour: boolean
  isPast: boolean
  isNextDay: boolean
}

// ============================================================================
// Source weights (matches consensus weights)
// ============================================================================

const SOURCE_WEIGHTS: Record<string, number> = {
  'Open-Meteo': 0.4,
  'Google-Weather': 0.4,
  'NWS': 0.3,
  'METAR': 0.2,
}

// ============================================================================
// Data Logic
// ============================================================================

function getHourlyConsensus(forecasts: WeatherForecast[], timezone?: string): HourlyData[] {
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
      const w = SOURCE_WEIGHTS[f.source] ?? 0.2
      const temp = f.temperature.current ?? f.temperature.max
      tempSum += temp * w
      weightSum += w

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

// ============================================================================
// Helpers
// ============================================================================

function getTimezoneAbbreviation(timezone?: string): string {
  if (!timezone) return ''
  return new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'short' })
    .formatToParts(new Date())
    .find(p => p.type === 'timeZoneName')?.value || ''
}

function formatHourLabel(hour: number, isCurrent: boolean, isNextDay: boolean, tzAbbr: string): string {
  if (isCurrent) return 'Now'
  const period = hour >= 12 ? 'PM' : 'AM'
  const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour
  const label = tzAbbr ? `${displayHour} ${period} ${tzAbbr}` : `${displayHour} ${period}`
  return isNextDay ? `${label} +1` : label
}

// ============================================================================
// Component
// ============================================================================

export function HourlyForecast({ forecasts, timezone }: HourlyForecastProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const hourlyData = getHourlyConsensus(forecasts, timezone)
  const tzAbbr = getTimezoneAbbreviation(timezone)

  // Auto-scroll to center the current hour on mount
  useEffect(() => {
    if (!scrollRef.current || hourlyData.length === 0) return
    const currentIndex = hourlyData.findIndex(d => d.isCurrentHour)
    if (currentIndex < 0) return

    const container = scrollRef.current
    const cardWidth = 120 // min-w-[110px] + gap
    const scrollTo = currentIndex * cardWidth - container.clientWidth / 2 + cardWidth / 2
    container.scrollTo({ left: Math.max(0, scrollTo), behavior: 'smooth' })
  }, [hourlyData])

  if (!forecasts || forecasts.length === 0 || hourlyData.length === 0) {
    return (
      <div className="bg-black/40 border border-gray-700/50 rounded-xl p-4">
        <h3 className="text-sm font-semibold mb-2 text-white">24-Hour Forecast</h3>
        <p className="text-gray-400 text-sm">No hourly data available</p>
      </div>
    )
  }

  return (
    <ScrollableCardRow title="24-Hour Forecast" scrollRef={scrollRef}>
      {hourlyData.map((data) => (
        <div
          key={`${data.date}-${data.hour}`}
          className={`${hourlyData.length <= 8 ? 'flex-1 min-w-[90px]' : 'min-w-[110px] flex-shrink-0'} rounded-xl p-3.5 text-center transition-colors ${
            data.isCurrentHour
              ? 'bg-amber-500/[0.08] border border-amber-500/50 ring-1 ring-amber-500/20'
              : 'bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06] hover:border-amber-500/30'
          }`}
        >
          {/* Hour Label */}
          <div className={`text-xs font-medium mb-1 ${data.isCurrentHour ? 'text-amber-400' : data.isNextDay ? 'text-blue-400' : 'text-gray-400'}`}>
            {formatHourLabel(data.hour, data.isCurrentHour, data.isNextDay, tzAbbr)}
          </div>

          {/* Weather Icon */}
          <div className="flex justify-center my-1.5">
            <WeatherIcon weatherCode={data.weatherCode} className="w-7 h-7" />
          </div>

          {/* Temperature */}
          <div className={`text-lg font-bold mb-1 ${data.isCurrentHour ? 'text-amber-400' : 'text-white'}`}>
            {celsiusToFahrenheit(data.temperature).toFixed(0)}°F
          </div>

          {/* Precipitation */}
          <div className="text-xs text-blue-400">
            {(data.precipProbability * 100).toFixed(0)}%
          </div>

          {/* Wind Speed (if available) */}
          {data.windSpeed != null && (
            <div className="text-xs text-gray-400 mt-1">
              {data.windSpeed.toFixed(0)} mph
            </div>
          )}
        </div>
      ))}
    </ScrollableCardRow>
  )
}
