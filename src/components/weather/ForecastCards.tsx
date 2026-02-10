// 7-day forecast cards
// Horizontal scrollable grid showing daily forecasts

import { CloudIcon, SunIcon } from '@heroicons/react/24/solid'
import type { WeatherForecast } from '@/types/weather'
import { celsiusToFahrenheit } from '@/lib/utils/temperature'

// ============================================================================
// Types
// ============================================================================

interface ForecastCardsProps {
  forecasts: WeatherForecast[]
}

// ============================================================================
// Helper Functions
// ============================================================================

function formatDayOfWeek(timestamp: number): string {
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
function groupForecastsByDay(forecasts: WeatherForecast[]): WeatherForecast[] {
  const dayMap = new Map<string, WeatherForecast[]>()

  forecasts.forEach(forecast => {
    const dateKey = new Date(forecast.timestamp).toDateString()
    if (!dayMap.has(dateKey)) {
      dayMap.set(dateKey, [])
    }
    dayMap.get(dateKey)!.push(forecast)
  })

  // Average forecasts for each day
  const dailyForecasts: WeatherForecast[] = []
  dayMap.forEach((dayForecasts, dateKey) => {
    const avgForecast: WeatherForecast = {
      ...dayForecasts[0],
      temperature: {
        min: Math.min(...dayForecasts.map(f => f.temperature.min)),
        max: Math.max(...dayForecasts.map(f => f.temperature.max)),
        current: dayForecasts[0].temperature.current,
      },
      precipitation: {
        probability: Math.max(...dayForecasts.map(f => f.precipitation.probability)),
        amount: Math.max(...dayForecasts.map(f => f.precipitation.amount)),
      },
    }
    dailyForecasts.push(avgForecast)
  })

  // Sort by timestamp and take first 7 days
  return dailyForecasts.sort((a, b) => a.timestamp - b.timestamp).slice(0, 7)
}

// ============================================================================
// Component
// ============================================================================

export function ForecastCards({ forecasts }: ForecastCardsProps) {
  if (!forecasts || forecasts.length === 0) {
    return (
      <div className="bg-black/40 border border-gray-700/50 rounded-xl p-6">
        <h3 className="text-lg font-semibold mb-4">7-Day Forecast</h3>
        <div className="flex gap-4 overflow-x-auto pb-4">
          {[...Array(7)].map((_, i) => (
            <div key={i} className="bg-gray-700/20 rounded-xl p-4 min-w-[140px] flex-shrink-0 animate-pulse">
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
    <div className="bg-black/40 border border-gray-700/50 rounded-xl p-6">
      <h3 className="text-lg font-semibold mb-4">7-Day Forecast</h3>
      <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-gray-900/50">
        {dailyForecasts.map((forecast, index) => (
          <div
            key={forecast.timestamp}
            className="bg-black/40 border border-gray-700/50 rounded-xl p-4 min-w-[140px] flex-shrink-0 hover:border-amber-500/30 transition-colors"
          >
            {/* Day of Week */}
            <div className="text-sm text-gray-400 mb-2">
              {formatDayOfWeek(forecast.timestamp)}
            </div>

            {/* High Temperature */}
            <div className="text-2xl font-bold text-white mb-1">
              {celsiusToFahrenheit(forecast.temperature.max).toFixed(0)}°F
            </div>

            {/* Low Temperature */}
            <div className="text-sm text-gray-400 mb-3">
              {celsiusToFahrenheit(forecast.temperature.min).toFixed(0)}°F
            </div>

            {/* Precipitation */}
            <div className="flex items-center gap-1.5 text-xs text-gray-400">
              {forecast.precipitation.probability > 0.3 ? (
                <CloudIcon className="w-4 h-4 text-blue-400" />
              ) : (
                <SunIcon className="w-4 h-4 text-amber-400" />
              )}
              <span>
                {(forecast.precipitation.probability * 100).toFixed(0)}%
              </span>
            </div>

            {/* Weather Condition */}
            <div className="mt-2 text-xs text-gray-500 truncate">
              {forecast.conditions}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
