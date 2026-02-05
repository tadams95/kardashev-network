// SWR hook for fetching solar irradiance data

import useSWR from 'swr'
import type { SolarData, SolarApiResponse } from '@/types/solar'
import type { WastedEnergy } from '@/types/solar'
import { calculateWastedValueFromData } from '@/lib/calculations/solarValue'

interface UseSolarDataOptions {
  refreshInterval?: number
  revalidateOnFocus?: boolean
}

interface UseSolarDataReturn {
  solarData: SolarData | undefined
  wastedEnergy: WastedEnergy | undefined
  isLoading: boolean
  isError: boolean
  error: Error | undefined
  isCached: boolean
  refresh: () => void
}

const fetcher = async (url: string): Promise<SolarApiResponse> => {
  const res = await fetch(url)
  if (!res.ok) {
    const error = new Error('Failed to fetch solar data')
    throw error
  }
  return res.json()
}

/**
 * Hook to fetch solar irradiance data for a location
 * Uses SWR for caching and revalidation
 */
export function useSolarData(
  lat: number | null | undefined,
  lng: number | null | undefined,
  options: UseSolarDataOptions = {}
): UseSolarDataReturn {
  const {
    refreshInterval = 300000, // 5 minutes default
    revalidateOnFocus = false,
  } = options

  // Only fetch if we have valid coordinates
  const shouldFetch = lat != null && lng != null && !isNaN(lat) && !isNaN(lng)
  const url = shouldFetch ? `/api/solar/irradiance?lat=${lat}&lng=${lng}` : null

  const { data, error, isLoading, isValidating, mutate } = useSWR<SolarApiResponse>(
    url,
    fetcher,
    {
      refreshInterval,
      revalidateOnFocus,
      revalidateOnReconnect: true,
      dedupingInterval: 60000, // Dedupe requests within 1 minute
      errorRetryCount: 3,
      errorRetryInterval: 5000,
    }
  )

  // Calculate wasted energy if we have solar data
  const wastedEnergy = data?.data ? calculateWastedValueFromData(data.data) : undefined

  return {
    solarData: data?.data,
    wastedEnergy,
    isLoading: isLoading || isValidating,
    isError: !!error || (data?.success === false),
    error: error || (data?.error ? new Error(data.error) : undefined),
    isCached: data?.cached ?? false,
    refresh: () => mutate(),
  }
}
