// Today's hourly forecast
// Horizontal scrollable grid showing hour-by-hour forecasts for today

import { useEffect, useRef } from 'react'
import { CloudIcon, SunIcon } from '@heroicons/react/24/solid'
import type { WeatherForecast } from '@/types/weather'
import { celsiusToFahrenheit } from '@/lib/utils/temperature'
import { getWeatherIcon } from '@/lib/weather'

// ============================================================================
// Types
// ============================================================================

interface HourlyForecastProps {
  forecasts: WeatherForecast[]
}

interface HourlyData {
  hour: number
  temperature: number
  precipProbability: number
  windSpeed: number | null
  weatherCode: number | null
  conditions: string
  isCurrentHour: boolean
  isPast: boolean
}

// ============================================================================
// Source weights (matches consensus weights)
// ============================================================================

const SOURCE_WEIGHTS: Record<string, number> = {
  'Open-Meteo': 0.4,
  'Google-Weather': 0.4,
  'METAR': 0.2,
}

// ============================================================================
// Data Logic
// ============================================================================

function getHourlyConsensus(forecasts: WeatherForecast[]): HourlyData[] {
  const now = new Date()
  const todayStr = now.toDateString()
  const currentHour = now.getHours()

  // Filter to today's forecasts that are hourly (min === max) or METAR
  const todayHourly = forecasts.filter(f => {
    const fDate = new Date(f.timestamp)
    if (fDate.toDateString() !== todayStr) return false
    if (f.source === 'METAR') return true
    return f.temperature.min === f.temperature.max
  })

  if (todayHourly.length === 0) return []

  // Group by hour
  const hourMap = new Map<number, WeatherForecast[]>()
  todayHourly.forEach(f => {
    const hour = new Date(f.timestamp).getHours()
    if (!hourMap.has(hour)) hourMap.set(hour, [])
    hourMap.get(hour)!.push(f)
  })

  // Compute weighted average per hour
  const result: HourlyData[] = []
  hourMap.forEach((entries, hour) => {
    let tempSum = 0
    let precipSum = 0
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
      precipSum += f.precipitation.probability * w
      weightSum += w

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
      temperature: tempSum / weightSum,
      precipProbability: precipSum / weightSum,
      windSpeed: windWeightSum > 0 ? windSum / windWeightSum : null,
      weatherCode: bestWeatherCode,
      conditions: bestConditions,
      isCurrentHour: hour === currentHour,
      isPast: hour < currentHour,
    })
  })

  return result.sort((a, b) => a.hour - b.hour)
}

// ============================================================================
// Helpers
// ============================================================================

function formatHourLabel(hour: number, isCurrent: boolean): string {
  if (isCurrent) return 'Now'
  const period = hour >= 12 ? 'PM' : 'AM'
  const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour
  return `${displayHour} ${period}`
}

function WeatherIcon({ weatherCode }: { weatherCode: number | null }) {
  if (weatherCode == null) {
    return <SunIcon className="w-6 h-6 text-amber-400" />
  }
  const icon = getWeatherIcon(weatherCode)
  if (icon === 'sun' || icon === 'cloud-sun') {
    return <SunIcon className="w-6 h-6 text-amber-400" />
  }
  return <CloudIcon className="w-6 h-6 text-blue-400" />
}

// ============================================================================
// Component
// ============================================================================

export function HourlyForecast({ forecasts }: HourlyForecastProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const hourlyData = getHourlyConsensus(forecasts)

  // Auto-scroll to center the current hour on mount
  useEffect(() => {
    if (!scrollRef.current || hourlyData.length === 0) return
    const currentIndex = hourlyData.findIndex(d => d.isCurrentHour)
    if (currentIndex < 0) return

    const container = scrollRef.current
    const cardWidth = 108 // min-w-[100px] + gap
    const scrollTo = currentIndex * cardWidth - container.clientWidth / 2 + cardWidth / 2
    container.scrollTo({ left: Math.max(0, scrollTo), behavior: 'smooth' })
  }, [hourlyData])

  if (!forecasts || forecasts.length === 0 || hourlyData.length === 0) {
    return (
      <div className="bg-black/40 border border-gray-700/50 rounded-xl p-6">
        <h3 className="text-lg font-semibold mb-4 text-white">Today&apos;s Hourly Forecast</h3>
        <p className="text-gray-400 text-sm">No hourly data available for today</p>
      </div>
    )
  }

  return (
    <div className="bg-black/40 border border-gray-700/50 rounded-xl p-6">
      <h3 className="text-lg font-semibold mb-4 text-white">Today&apos;s Hourly Forecast</h3>
      <div
        ref={scrollRef}
        className="flex gap-3 overflow-x-auto pb-4 scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-gray-900/50"
      >
        {hourlyData.map((data) => (
          <div
            key={data.hour}
            className={`min-w-[100px] flex-shrink-0 rounded-xl p-3 text-center transition-colors ${
              data.isCurrentHour
                ? 'bg-black/40 border border-amber-500/60 ring-1 ring-amber-500/20'
                : 'bg-black/40 border border-gray-700/50 hover:border-amber-500/30'
            } ${data.isPast ? 'opacity-50' : ''}`}
          >
            {/* Hour Label */}
            <div className={`text-xs font-medium mb-2 ${data.isCurrentHour ? 'text-amber-400' : 'text-gray-400'}`}>
              {formatHourLabel(data.hour, data.isCurrentHour)}
            </div>

            {/* Weather Icon */}
            <div className="flex justify-center mb-2">
              <WeatherIcon weatherCode={data.weatherCode} />
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
      </div>
    </div>
  )
}
