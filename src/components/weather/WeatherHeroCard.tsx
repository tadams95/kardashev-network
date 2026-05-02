// Hero card displaying current weather + consensus/freshness status
// Vertical layout filling the first column of the 3-column hero grid

import { useState } from 'react'
import { CloudIcon } from '@heroicons/react/24/solid'
import { ArrowPathIcon } from '@heroicons/react/24/outline'
import { CheckIcon, ExclamationTriangleIcon, XMarkIcon } from '@heroicons/react/20/solid'
import type { WeatherEnsemble, WeatherForecast, EnsembleWeights } from '@/types/weather'
import type { CityCoordinates } from '@/lib/utils/cityCoordinates'
import { celsiusToFahrenheit } from '@/lib/utils/temperature'
import { getTodayForecast } from '@/lib/utils/dailyForecasts'

// ============================================================================
// Types
// ============================================================================

interface SourceWeightsData {
  weights: Record<string, number | undefined>
  isDynamic: boolean
  defaultWeights: Record<string, number | undefined>
}

interface WeatherHeroCardProps {
  forecast?: WeatherEnsemble['consensus']
  forecasts?: WeatherForecast[]
  timezone?: string
  city?: CityCoordinates
  sources?: Record<string, 'ok' | 'stale' | 'failed'>
  freshness?: Record<string, number>
  sourceWeights?: SourceWeightsData | null
  activeWeights?: EnsembleWeights
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
  if (status === 'ok') return 'bg-green-500/20 text-green-400 border-green-500/30'
  if (status === 'stale') return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
  return 'bg-red-500/20 text-red-400 border-red-500/30'
}

function StatusIcon({ status }: { status: 'ok' | 'stale' | 'failed' }) {
  if (status === 'ok') return <CheckIcon className="w-2.5 h-2.5" />
  if (status === 'stale') return <ExclamationTriangleIcon className="w-2.5 h-2.5" />
  return <XMarkIcon className="w-2.5 h-2.5" />
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

  // 2. Most recent past/current forecast source's current temperature
  const now = Date.now()
  const sorted = [...forecasts]
    .filter(f => typeof f.temperature.current === 'number' && !isNaN(f.temperature.current))
    .filter(f => new Date(f.timestamp).getTime() <= now)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  if (sorted.length > 0) {
    return sorted[0].temperature.current
  }

  // 3. Last resort: consensus mean
  return consensusMean
}

/**
 * Pick the most recent past/current observation for an atmospheric field.
 * Prefers fresh METAR (ground-truth) when available, falls back to the
 * latest past forecast source that publishes the field. Returns null when
 * no source has a value.
 *
 * Used to surface current-snapshot humidity and apparent temperature on
 * the hero card alongside `currentTemp`, matching weather-app convention
 * where "feels like" and "humidity" reflect right-now values rather than
 * daily means.
 */
function getCurrentAtmospheric(
  forecasts: WeatherForecast[] | undefined,
  extract: (f: WeatherForecast) => number | null | undefined
): number | null {
  if (!forecasts || forecasts.length === 0) return null

  // 1. Fresh METAR (when it publishes the field)
  const metar = forecasts.find(f => f.source === 'METAR')
  if (metar && metar.dataAge < METAR_STALE_THRESHOLD_MS) {
    const v = extract(metar)
    if (typeof v === 'number' && !isNaN(v)) return v
  }

  // 2. Most recent past forecast source with the field populated
  const now = Date.now()
  const sorted = [...forecasts]
    .filter(f => {
      const v = extract(f)
      return typeof v === 'number' && !isNaN(v)
    })
    .filter(f => new Date(f.timestamp).getTime() <= now)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  if (sorted.length > 0) {
    const v = extract(sorted[0])
    if (typeof v === 'number' && !isNaN(v)) return v
  }

  return null
}

// ============================================================================
// Component
// ============================================================================

export function WeatherHeroCard({ forecast, forecasts, timezone, city, sources, freshness, sourceWeights, activeWeights, onRefresh }: WeatherHeroCardProps) {
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [showWeights, setShowWeights] = useState(false)

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
  const todayForecast = forecasts && timezone ? getTodayForecast(forecasts, timezone, activeWeights) : null
  const dailyHigh = todayForecast?.high ?? (forecast.temperatureRange ? forecast.temperatureRange[1] : null)
  const dailyLow = todayForecast?.low ?? (forecast.temperatureRange ? forecast.temperatureRange[0] : null)
  const precipProb = forecast.precipProbability ?? 0

  // Phase 2a UI surfacing (2026-04-11): current-snapshot humidity + feels-like.
  // Picks the most recent past observation per field (fresh METAR preferred).
  // Rendered as a compact secondary row below the precipitation line — small
  // text, not prominent, so the hero card stays roughly as dense as before.
  const currentHumidity = getCurrentAtmospheric(forecasts, f => f.humidity)
  const currentApparent = getCurrentAtmospheric(forecasts, f => f.temperature.apparent)
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
    <div className="bg-black/40 border border-gray-700/50 rounded-xl h-full flex flex-col overflow-hidden">
      {/* Primary Weather Section */}
      <div className="p-5 flex-1">
        {/* City Name */}
        <div className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-1">
          {city.name}
        </div>

        {/* Temperature */}
        <div className="text-4xl font-bold text-amber-400 mb-1">
          {celsiusToFahrenheit(currentTemp).toFixed(1)}°F
        </div>

        {/* High / Low */}
        <div className="text-sm text-gray-300 mb-1">
          H: {dailyHigh != null ? `${celsiusToFahrenheit(dailyHigh).toFixed(1)}°F` : '--'} L: {dailyLow != null ? `${celsiusToFahrenheit(dailyLow).toFixed(1)}°F` : '--'}
        </div>

        {/* Precipitation */}
        <div className="flex items-center gap-1.5 text-sm mb-0">
          <CloudIcon className="w-4 h-4 text-blue-400" />
          <span className="text-gray-300">{(precipProb * 100).toFixed(0)}% rain</span>
        </div>

        {/* Atmospheric secondary row — humidity + feels-like (Phase 2a surfacing) */}
        {(currentHumidity != null || currentApparent != null) && (
          <div className="flex items-center gap-3 text-xs text-gray-400 mt-1">
            {currentHumidity != null && (
              <span>{Math.round(currentHumidity)}% humidity</span>
            )}
            {currentApparent != null && (
              <span>Feels {celsiusToFahrenheit(currentApparent).toFixed(0)}°F</span>
            )}
          </div>
        )}
      </div>

      {/* Meta-Diagnostics Footer */}
      <div className="bg-black/60 p-3 text-xs border-t border-gray-700/50 space-y-1.5">
        {/* Source dots */}
        {sourceEntries.length > 0 && (
          <div className="flex items-center gap-1.5">
            {sourceEntries.map(([name, status]) => (
              <div
                key={name}
                className={`w-4 h-4 rounded-full flex items-center justify-center border ${statusDotColor(status)}`}
                title={`${name}: ${status}`}
              >
                <StatusIcon status={status} />
                <span className="sr-only">{name}: {status}</span>
              </div>
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

        {/* Source Weights (expandable) */}
        {sourceWeights && (
          <div>
            <button
              onClick={() => setShowWeights(!showWeights)}
              className="text-gray-400 hover:text-gray-300 transition-colors w-full text-left"
            >
              Source Weights{' '}
              <span className={`inline-block text-[9px] px-1.5 py-0.5 rounded-full font-medium ${sourceWeights.isDynamic ? 'bg-amber-500/20 text-amber-400' : 'bg-gray-600/30 text-gray-500'}`}>
                {sourceWeights.isDynamic ? 'Dynamic' : 'Static'}
              </span>
              <span className="ml-1 text-[10px]">{showWeights ? '\u25B2' : '\u25BC'}</span>
            </button>
            {showWeights && (
              <div className="mt-1.5 space-y-1">
                {Object.entries(sourceWeights.weights)
                  .filter(([, w]) => w != null && w > 0)
                  .sort(([, a], [, b]) => (b ?? 0) - (a ?? 0))
                  .map(([source, weight]) => {
                    const w = weight ?? 0
                    return (
                      <div key={source} className="flex items-center gap-1.5">
                        <span className="text-gray-500 w-16 truncate text-[10px]" title={source}>
                          {source.replace('Open-Meteo', 'O-Meteo').replace('Google-Weather', 'Google').replace('Tomorrow.io', 'Tmrw')}
                        </span>
                        <div className="flex-1 h-1.5 bg-gray-700/50 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-amber-500/60 rounded-full"
                            style={{ width: `${Math.min(100, (w / 0.5) * 100)}%` }}
                          />
                        </div>
                        <span className="text-gray-400 w-8 text-right text-[10px]">
                          {(w * 100).toFixed(0)}%
                        </span>
                      </div>
                    )
                  })}
              </div>
            )}
          </div>
        )}

        {/* Freshness + Refresh */}
        <div className="flex items-center justify-between pt-1">
          {freshnessLabel ? (
            <span className="text-gray-400">Updated {freshnessLabel}</span>
          ) : (
            <span></span>
          )}
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="p-1.5 min-w-[32px] min-h-[32px] flex items-center justify-center rounded-md hover:bg-gray-700/50 transition-colors disabled:opacity-50"
            aria-label="Refresh data"
          >
            <ArrowPathIcon
              className={`w-4 h-4 text-amber-400 ${isRefreshing ? 'animate-spin' : ''}`}
            />
          </button>
        </div>
      </div>
    </div>
  )
}
