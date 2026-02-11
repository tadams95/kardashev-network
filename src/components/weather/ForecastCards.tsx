// 7-day forecast cards
// Horizontal scrollable grid showing daily forecasts

import type { WeatherForecast } from '@/types/weather'
import { celsiusToFahrenheit } from '@/lib/utils/temperature'
import { WeatherIcon } from '@/components/weather/WeatherIcon'
import { ScrollableCardRow } from '@/components/weather/ScrollableCardRow'

// ============================================================================
// Types
// ============================================================================

interface ForecastCardsProps {
  forecasts: WeatherForecast[]
}

// ============================================================================
// Helper Functions
// ============================================================================

function formatDayOfWeek(timestamp: string | number): string {
  const date = new Date(timestamp)
  const today = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  if (date.toDateString() === today.toDateString()) {
    return 'Today'
  } else if (date.toDateString() === tomorrow.toDateString()) {
    return 'Tomorrow'
  }

  return date.toLocaleDateString('en-US', { weekday: 'short' })
}

// Group forecasts by day and take the average
function groupForecastsByDay(forecasts: WeatherForecast[]): (WeatherForecast & { bestWeatherCode: number | null })[] {
  const dayMap = new Map<string, WeatherForecast[]>()

  forecasts.forEach(forecast => {
    const dateKey = new Date(forecast.timestamp).toDateString()
    if (!dayMap.has(dateKey)) {
      dayMap.set(dateKey, [])
    }
    dayMap.get(dateKey)!.push(forecast)
  })

  // Average forecasts for each day
  const dailyForecasts: (WeatherForecast & { bestWeatherCode: number | null })[] = []
  dayMap.forEach((dayForecasts) => {
    // Pick best weather code from highest-weighted source
    let bestWeatherCode: number | null = null
    let bestWeight = -1
    const SOURCE_WEIGHTS: Record<string, number> = {
      'Open-Meteo': 0.4,
      'Google-Weather': 0.4,
      'METAR': 0.2,
    }
    dayForecasts.forEach(f => {
      if (f.weatherCode != null) {
        const w = SOURCE_WEIGHTS[f.source] ?? 0.2
        if (w > bestWeight) {
          bestWeatherCode = f.weatherCode
          bestWeight = w
        }
      }
    })

    const avgForecast = {
      ...dayForecasts[0],
      temperature: (() => {
        const mins = dayForecasts.map(f => f.temperature.min).filter(t => typeof t === 'number' && !isNaN(t))
        const maxs = dayForecasts.map(f => f.temperature.max).filter(t => typeof t === 'number' && !isNaN(t))
        return {
          min: mins.length > 0 ? Math.min(...mins) : 0,
          max: maxs.length > 0 ? Math.max(...maxs) : 0,
          current: dayForecasts[0].temperature.current ?? 0,
        }
      })(),
      precipitation: {
        probability: Math.max(...dayForecasts.map(f => f.precipitation.probability)),
        amount: Math.max(...dayForecasts.map(f => f.precipitation.amount)),
      },
      bestWeatherCode,
    }
    dailyForecasts.push(avgForecast)
  })

  // Sort by timestamp and take first 7 days
  return dailyForecasts.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()).slice(0, 7)
}

// ============================================================================
// Component
// ============================================================================

export function ForecastCards({ forecasts }: ForecastCardsProps) {
  if (!forecasts || forecasts.length === 0) {
    return (
      <div className="bg-black/40 border border-gray-700/50 rounded-xl p-4">
        <h3 className="text-sm font-semibold mb-2">7-Day Forecast</h3>
        <div className="flex gap-2 overflow-x-auto pb-2">
          {[...Array(7)].map((_, i) => (
            <div key={i} className="bg-gray-700/20 rounded-xl p-3 min-w-[100px] flex-shrink-0 animate-pulse">
              <div className="h-4 bg-gray-700/30 rounded mb-2"></div>
              <div className="h-8 bg-gray-700/30 rounded mb-1"></div>
              <div className="h-4 bg-gray-700/30 rounded mb-3"></div>
              <div className="h-4 bg-gray-700/30 rounded"></div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  const dailyForecasts = groupForecastsByDay(forecasts)

  return (
    <ScrollableCardRow title="7-Day Forecast">
      {dailyForecasts.map((forecast) => {
        const dayLabel = formatDayOfWeek(forecast.timestamp)
        const isToday = dayLabel === 'Today'
        return (
        <div
          key={forecast.timestamp}
          className={`rounded-xl p-3.5 min-w-[110px] flex-shrink-0 transition-colors text-center ${
            isToday
              ? 'bg-amber-500/[0.08] border border-amber-500/50 ring-1 ring-amber-500/20'
              : 'bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06] hover:border-amber-500/30'
          }`}
        >
          {/* Day of Week */}
          <div className={`text-xs mb-1 ${isToday ? 'text-amber-400 font-medium' : 'text-gray-400'}`}>
            {dayLabel}
          </div>

          {/* Weather Icon */}
          <div className="flex justify-center my-1.5">
            <WeatherIcon weatherCode={forecast.bestWeatherCode} className="w-7 h-7" />
          </div>

          {/* High Temperature */}
          <div className="text-lg font-bold text-white mb-0.5">
            {celsiusToFahrenheit(forecast.temperature.max).toFixed(0)}°F
          </div>

          {/* Low Temperature */}
          <div className="text-xs text-gray-400 mb-1">
            {celsiusToFahrenheit(forecast.temperature.min).toFixed(0)}°F
          </div>

          {/* Precipitation */}
          <div className="text-xs text-blue-400">
            {(forecast.precipitation.probability * 100).toFixed(0)}%
          </div>
        </div>
        )
      })}
    </ScrollableCardRow>
  )
}
