// SWR hook for fetching real-time weather forecasts
// Aggregates 3 sources with 15-minute auto-refresh

import useSWR from 'swr'
import type { WeatherEnsemble } from '@/types/weather'
import type { CityCoordinates } from '@/lib/utils/cityCoordinates'

// ============================================================================
// Types
// ============================================================================

interface ForecastsApiResponse {
  success: boolean
  data?: {
    ensemble: WeatherEnsemble
    city: CityCoordinates
    freshness: {
      'Open-Meteo': number
      'Google-Weather': number
      'METAR': number
      'NWS': number
      'AccuWeather': number
      'Tomorrow.io': number
    }
    sourceStatus: {
      'Open-Meteo': 'ok' | 'stale' | 'failed'
      'Google-Weather': 'ok' | 'stale' | 'failed'
      'METAR': 'ok' | 'stale' | 'failed'
      'NWS': 'ok' | 'stale' | 'failed'
      'AccuWeather': 'ok' | 'stale' | 'failed'
      'Tomorrow.io': 'ok' | 'stale' | 'failed'
    }
  }
  error?: string
  cached?: boolean
  timestamp: number
}

interface UseWeatherForecastsOptions {
  refreshInterval?: number
  revalidateOnFocus?: boolean
  revalidateOnReconnect?: boolean
}

interface UseWeatherForecastsReturn {
  ensemble: WeatherEnsemble | undefined
  city: CityCoordinates | undefined
  freshness: Record<string, number> | undefined
  sourceStatus: Record<string, 'ok' | 'stale' | 'failed'> | undefined
  isLoading: boolean
  isValidating: boolean
  isError: boolean
  error: Error | undefined
  isCached: boolean
  timestamp: number | undefined
  refresh: () => void
}

// ============================================================================
// Fetcher
// ============================================================================

const fetcher = async (url: string): Promise<ForecastsApiResponse> => {
  const res = await fetch(url)
  if (!res.ok) {
    const error = new Error('Failed to fetch weather forecasts')
    throw error
  }
  return res.json()
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Hook to fetch real-time weather forecasts with 6-source consensus
 * Uses SWR for caching and automatic 15-minute refresh
 *
 * @param cityCode - City code (e.g., 'NY', 'CHI', 'LA')
 * @param options - SWR configuration options
 * @returns Weather ensemble with loading/error states
 *
 * @example
 * ```tsx
 * function WeatherDashboard() {
 *   const { ensemble, isLoading, isError } = useWeatherForecasts('NY')
 *
 *   if (isLoading) return <div>Loading forecasts...</div>
 *   if (isError) return <div>Error loading forecasts</div>
 *
 *   return (
 *     <div>
 *       <h2>Temperature: {ensemble.consensus.temperatureMean}°F</h2>
 *       <p>Precipitation: {(ensemble.consensus.precipProbability * 100).toFixed(0)}%</p>
 *     </div>
 *   )
 * }
 * ```
 */
export function useWeatherForecasts(
  cityCode: string,
  options: UseWeatherForecastsOptions = {}
): UseWeatherForecastsReturn {
  const {
    refreshInterval = 15 * 60 * 1000, // 15 minutes
    revalidateOnFocus = false,
    revalidateOnReconnect = true,
  } = options

  const { data, error, isLoading, isValidating, mutate } = useSWR<ForecastsApiResponse>(
    cityCode ? `/api/weather/forecasts?city=${cityCode}` : null,
    fetcher,
    {
      refreshInterval,
      dedupingInterval: 60 * 1000, // 1 minute (reduce duplicate requests)
      revalidateOnFocus,
      revalidateOnReconnect,
      keepPreviousData: true,
      shouldRetryOnError: true,
      errorRetryCount: 3,
      errorRetryInterval: 5000,
    }
  )

  return {
    ensemble: data?.data?.ensemble,
    city: data?.data?.city,
    freshness: data?.data?.freshness,
    sourceStatus: data?.data?.sourceStatus,
    isLoading,
    isValidating,
    isError: !!error,
    error,
    isCached: data?.cached || false,
    timestamp: data?.timestamp,
    refresh: () => mutate(),
  }
}
