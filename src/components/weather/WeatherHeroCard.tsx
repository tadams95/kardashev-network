// Hero card displaying current weather + consensus/freshness status
// Vertical layout filling the first column of the 3-column hero grid

import { useState } from 'react'
import { CloudIcon } from '@heroicons/react/24/solid'
import { ArrowPathIcon } from '@heroicons/react/24/outline'
import type { WeatherEnsemble, WeatherForecast } from '@/types/weather'
import type { CityCoordinates } from '@/lib/utils/cityCoordinates'
import type { BiasInfo } from '@/hooks/useWeatherOpportunities'
import { celsiusToFahrenheit } from '@/lib/utils/temperature'
import { getTodayForecast } from '@/lib/utils/dailyForecasts'

// ============================================================================
// Types
// ============================================================================

interface WeatherHeroCardProps {
  forecast?: WeatherEnsemble['consensus']
  forecasts?: WeatherForecast[]
  timezone?: string
  city?: CityCoordinates
  sources?: Record<string, 'ok' | 'stale' | 'failed'>
  freshness?: Record<string, number>
  biasInfo?: BiasInfo | null
  onRefresh: () => void
}

// ============================================================================
// Helpers (carried over from ForecastStatusBar)
// ============================================================================

function formatTimeAgo(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 5) return 'Just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m ago`
}

function statusDotColor(status: 'ok' | 'stale' | 'failed'): string {
  if (status === 'ok') return 'bg-green-400'
  if (status === 'stale') return 'bg-yellow-400'
  return 'bg-red-400'
}

function agreementColor(value: number): string {
  if (value >= 80) return 'text-green-400'
  if (value >= 60) return 'text-yellow-400'
  return 'text-red-400'
}

function qualityColor(value: number): string {
  if (value >= 90) return 'text-green-400'
  if (value >= 70) return 'text-yellow-400'
  return 'text-red-400'
}

function biasColor(info: BiasInfo): string {
  if (!info.isActive) return 'text-gray-500'
  const mag = Math.abs(info.correction)
  if (mag <= 1) return 'text-green-400'
  if (mag < 3) return 'text-yellow-400'
  return 'text-red-400'
}

const METAR_STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000 // 2 hours

function getCurrentTemperature(
  forecasts: WeatherForecast[] | undefined,
  consensusMean: number
): number {
  if (!forecasts || forecasts.length === 0) return consensusMean

  // 1. METAR ground-truth observation (highest priority)
  const metar = forecasts.find(f => f.source === 'METAR')
  if (metar && metar.dataAge < METAR_STALE_THRESHOLD_MS) {
    return metar.temperature.current
  }

  // 2. Most recent forecast source's current temperature
  const sorted = [...forecasts]
    .filter(f => typeof f.temperature.current === 'number' && !isNaN(f.temperature.current))
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  if (sorted.length > 0) {
    return sorted[0].temperature.current
  }

  // 3. Last resort: consensus mean
  return consensusMean
}

// ============================================================================
// Component
// ============================================================================

export function WeatherHeroCard({ forecast, forecasts, timezone, city, sources, freshness, biasInfo, onRefresh }: WeatherHeroCardProps) {
  const [isRefreshing, setIsRefreshing] = useState(false)

  const handleRefresh = () => {
    setIsRefreshing(true)
    onRefresh()
    setTimeout(() => setIsRefreshing(false), 1000)
  }

  if (!forecast || !city) {
    return (
      <div className="bg-black/40 border border-gray-700/50 rounded-xl p-5 h-48">
        <div className="animate-pulse space-y-3">
          <div className="h-5 bg-gray-700/30 rounded w-1/2"></div>
          <div className="h-8 bg-gray-700/30 rounded w-2/3"></div>
          <div className="h-4 bg-gray-700/30 rounded w-1/2"></div>
          <div className="h-4 bg-gray-700/30 rounded w-3/4"></div>
        </div>
      </div>
    )
  }

  const tempMean = forecast.temperatureMean ?? 0
  const currentTemp = getCurrentTemperature(forecasts, tempMean)
  const todayForecast = forecasts ? getTodayForecast(forecasts, timezone) : null
  const dailyHigh = todayForecast ? todayForecast.high : (forecast.temperatureRange ?? [0, 0])[1]
  const dailyLow = todayForecast ? todayForecast.low : (forecast.temperatureRange ?? [0, 0])[0]
  const precipProb = forecast.precipProbability ?? 0
  const modelAgreement = forecast.modelAgreement ?? 0
  const dataQuality = forecast.dataQuality ?? 0

  const sourceEntries = sources ? Object.entries(sources) : []
  const okCount = sourceEntries.filter(([, s]) => s === 'ok').length

  let freshnessLabel = ''
  if (freshness) {
    const validTimes = Object.values(freshness).filter(ms => ms > 0)
    if (validTimes.length > 0) {
      freshnessLabel = formatTimeAgo(Math.min(...validTimes))
    }
  }

  return (
    <div className="bg-black/40 border border-gray-700/50 rounded-xl p-5 h-full flex flex-col">
      {/* City Name */}
      <div className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-1">
        {city.name}
      </div>

      {/* Temperature */}
      <div className="text-4xl font-bold text-amber-400 mb-1">
        {celsiusToFahrenheit(currentTemp).toFixed(0)}°F
      </div>

      {/* High / Low */}
      <div className="text-sm text-gray-300 mb-1">
        H: {celsiusToFahrenheit(dailyHigh).toFixed(0)}° L: {celsiusToFahrenheit(dailyLow).toFixed(0)}°
      </div>

      {/* Precipitation */}
      <div className="flex items-center gap-1.5 text-sm mb-0">
        <CloudIcon className="w-4 h-4 text-blue-400" />
        <span className="text-gray-300">{(precipProb * 100).toFixed(0)}% rain</span>
      </div>

      {/* Divider */}
      <div className="border-t border-gray-700/50 mt-auto mb-3"></div>

      {/* Status Section */}
      <div className="space-y-1.5 text-sm">
        {/* Source dots */}
        {sourceEntries.length > 0 && (
          <div className="flex items-center gap-1.5">
            {sourceEntries.map(([name, status]) => (
              <div
                key={name}
                className={`w-2 h-2 rounded-full ${statusDotColor(status)}`}
                title={`${name}: ${status}`}
              />
            ))}
            <span className="text-gray-400 ml-0.5">
              {okCount}/{sourceEntries.length} sources OK
            </span>
          </div>
        )}

        {/* Agreement */}
        <div className={agreementColor(modelAgreement)}>
          {modelAgreement.toFixed(1)}% agreement
        </div>

        {/* Quality */}
        <div className={qualityColor(dataQuality)}>
          {dataQuality}% quality
        </div>

        {/* Bias Correction */}
        {biasInfo && (
          <div className={biasColor(biasInfo)}>
            {biasInfo.isActive
              ? `${biasInfo.correction > 0 ? '+' : ''}${biasInfo.correction.toFixed(1)}°F bias correction (n=${biasInfo.sampleCount})`
              : `Bias: collecting data (${biasInfo.sampleCount}/10 samples)`}
          </div>
        )}

        {/* Freshness + Refresh */}
        <div className="flex items-center justify-between">
          {freshnessLabel ? (
            <span className="text-gray-400">Updated {freshnessLabel}</span>
          ) : (
            <span></span>
          )}
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-md hover:bg-gray-700/50 transition-colors disabled:opacity-50"
            aria-label="Refresh data"
          >
            <ArrowPathIcon
              className={`w-5 h-5 text-amber-400 ${isRefreshing ? 'animate-spin' : ''}`}
            />
          </button>
        </div>
      </div>
    </div>
  )
}
