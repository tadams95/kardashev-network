// 7-day forecast cards
// Horizontal scrollable grid showing daily forecasts

import type { WeatherForecast } from '@/types/weather'
import { celsiusToFahrenheit } from '@/lib/utils/temperature'
import { WeatherIcon } from '@/components/weather/WeatherIcon'
import { ScrollableCardRow } from '@/components/weather/ScrollableCardRow'
import { groupForecastsByDay } from '@/lib/utils/dailyForecasts'

// ============================================================================
// Types
// ============================================================================

interface ForecastCardsProps {
  forecasts: WeatherForecast[]
  timezone?: string
}

// ============================================================================
// Helper Functions
// ============================================================================

function formatDayOfWeek(timestamp: string | number, timezone?: string): string {
  const date = new Date(timestamp)
  const today = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  if (timezone) {
    const dayFormatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
    const dateKey = dayFormatter.format(date)
    const todayKey = dayFormatter.format(today)
    const tomorrowKey = dayFormatter.format(tomorrow)

    if (dateKey === todayKey) return 'Today'
    if (dateKey === tomorrowKey) return 'Tomorrow'

    return new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(date)
  }

  if (date.toDateString() === today.toDateString()) {
    return 'Today'
  } else if (date.toDateString() === tomorrow.toDateString()) {
    return 'Tomorrow'
  }

  return date.toLocaleDateString('en-US', { weekday: 'short' })
}

// ============================================================================
// Component
// ============================================================================

export function ForecastCards({ forecasts, timezone }: ForecastCardsProps) {
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

  const dailyForecasts = groupForecastsByDay(forecasts, timezone)

  return (
    <ScrollableCardRow title="7-Day Forecast">
      {dailyForecasts.map((forecast) => {
        const dayLabel = formatDayOfWeek(forecast.timestamp, timezone)
        const isToday = dayLabel === 'Today'
        return (
        <div
          key={String(forecast.timestamp)}
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
            {forecast.high != null ? `${celsiusToFahrenheit(forecast.high).toFixed(1)}°F` : '--'}
          </div>

          {/* Low Temperature */}
          <div className="text-xs text-gray-400 mb-1">
            {forecast.low != null ? `${celsiusToFahrenheit(forecast.low).toFixed(1)}°F` : '--'}
          </div>

          {/* Precipitation */}
          <div className="text-xs text-blue-400">
            {(forecast.precipProbability * 100).toFixed(0)}%
          </div>
        </div>
        )
      })}
    </ScrollableCardRow>
  )
}
