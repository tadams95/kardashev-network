// 7-day forecast cards
// Horizontal scrollable grid showing daily forecasts

import type { WeatherForecast, EnsembleWeights } from '@/types/weather'
import { celsiusToFahrenheit } from '@/lib/utils/temperature'
import { WeatherIcon } from '@/components/weather/WeatherIcon'
import { ScrollableCardRow } from '@/components/weather/ScrollableCardRow'
import { groupForecastsByDay } from '@/lib/utils/dailyForecasts'
import { formatDayLabel } from '@/lib/utils/formatDayLabel'
import Card from '@/components/Card'
import SkelBar from '@/components/SkelBar'

// ============================================================================
// Types
// ============================================================================

interface ForecastCardsProps {
  forecasts: WeatherForecast[]
  timezone: string
  activeWeights?: EnsembleWeights
}

// ============================================================================
// Component
// ============================================================================

export function ForecastCards({ forecasts, timezone, activeWeights }: ForecastCardsProps) {
  if (!forecasts || forecasts.length === 0) {
    return (
      <Card noPadding className="p-4">
        <h3 className="text-subhead font-semibold mb-2">7-Day Forecast</h3>
        <div className="flex gap-2 overflow-x-auto pb-2">
          {[...Array(7)].map((_, i) => (
            <div key={i} className="bg-gray-700/20 rounded-xl p-3 min-w-[100px] flex-shrink-0">
              <SkelBar size="h-4 w-full" className="mb-2" />
              <SkelBar size="h-8 w-full" className="mb-1" />
              <SkelBar size="h-4 w-full" className="mb-3" />
              <SkelBar size="h-4 w-full" />
            </div>
          ))}
        </div>
      </Card>
    )
  }

  const dailyForecasts = groupForecastsByDay(forecasts, timezone, activeWeights)

  return (
    <ScrollableCardRow title="7-Day Forecast">
      {dailyForecasts.map((forecast) => {
        const dayLabel = formatDayLabel(forecast.timestamp, timezone)
        const isToday = dayLabel === 'Today'
        return (
        <Card
          key={String(forecast.timestamp)}
          variant={isToday ? 'hero' : 'nested'}
          className={`min-w-[110px] flex-shrink-0 text-center transition-colors ${
            isToday
              ? '!border !border-white/[0.15]'
              : 'hover:!border-white/[0.15]'
          }`}
        >
          {/* Day of Week */}
          <div className={`text-caption mb-1 font-medium ${isToday ? 'text-white' : 'text-gray-400'}`}>
            {dayLabel}
          </div>

          {/* Weather Icon */}
          <div className="flex justify-center my-1.5">
            <WeatherIcon weatherCode={forecast.bestWeatherCode} className="w-7 h-7" />
          </div>

          {/* High Temperature */}
          <div className="text-subhead font-bold text-white font-mono mb-0.5">
            {forecast.high != null ? `${celsiusToFahrenheit(forecast.high).toFixed(1)}°F` : '--'}
          </div>

          {/* Low Temperature */}
          <div className="text-caption text-gray-400 font-mono mb-1">
            {forecast.low != null ? `${celsiusToFahrenheit(forecast.low).toFixed(1)}°F` : '--'}
          </div>

          {/* Precipitation */}
          <div className="text-caption text-blue-400 font-mono">
            {(forecast.precipProbability * 100).toFixed(0)}%
          </div>

          {/* Wind speed (Phase 2a surfacing — fixes 24h/7-day gap) */}
          {forecast.windSpeed != null && (
            <div className="text-caption text-gray-400 font-mono mt-1">
              {forecast.windSpeed.toFixed(0)} mph
            </div>
          )}
        </Card>
        )
      })}
    </ScrollableCardRow>
  )
}
