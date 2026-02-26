// 24-hour forecast
// Horizontal scrollable grid showing hour-by-hour forecasts for the next 24 hours

import { useEffect, useRef } from 'react'
import type { WeatherForecast } from '@/types/weather'
import { celsiusToFahrenheit } from '@/lib/utils/temperature'
import { getHourlyConsensus } from '@/lib/utils/hourlyConsensus'
import { WeatherIcon } from '@/components/weather/WeatherIcon'
import { ScrollableCardRow } from '@/components/weather/ScrollableCardRow'

// ============================================================================
// Types
// ============================================================================

interface HourlyForecastProps {
  forecasts: WeatherForecast[]
  timezone: string
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
            {celsiusToFahrenheit(data.temperature).toFixed(1)}°F
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
