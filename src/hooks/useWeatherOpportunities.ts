// Hook to fetch pre-computed trading opportunities from server
// All computation, caching, and signal logging happens server-side at /api/weather/opportunities

import useSWR from 'swr'
import type { WeatherOpportunity, EventGroup, BiasInfo } from '@/lib/computeOpportunities'

// Re-export types so existing consumers don't need to change imports
export type { WeatherOpportunity, EventGroup, BiasInfo }
// Re-export for cross-city guard tests
export { isCrossCityStale } from '@/lib/computeOpportunities'

interface UseWeatherOpportunitiesReturn {
  opportunities: WeatherOpportunity[]
  eventGroups: EventGroup[]
  totalMarketsCount: number
  allWithinBuffer: boolean
  isLoading: boolean
  isTransitioning: boolean
  isError: boolean
  error: Error | undefined
  refresh: () => void
  biasInfo: BiasInfo | null
}

// ============================================================================
// Fetcher
// ============================================================================

interface OpportunitiesApiResponse {
  success: boolean
  data?: {
    opportunities: WeatherOpportunity[]
    eventGroups: EventGroup[]
    totalMarketsCount: number
    allWithinBuffer: boolean
    biasInfo: BiasInfo | null
    cityCode: string
    cityName: string
  }
  error?: string
  cached?: boolean
  timestamp: number
}

// Low-privilege internal API key baked into the client bundle at build time.
// Gates the IP-sensitive GET endpoints against casual public scraping — NOT
// a real secret. The bundle is public, so anyone inspecting the JS can recover
// this value; the goal is obscurity-as-friction while we design the real
// productized API path.
const INTERNAL_API_KEY = process.env.NEXT_PUBLIC_INTERNAL_API_KEY ?? ''

const fetcher = async (url: string): Promise<OpportunitiesApiResponse> => {
  const res = await fetch(url, {
    headers: INTERNAL_API_KEY ? { Authorization: `Bearer ${INTERNAL_API_KEY}` } : undefined,
  })
  if (!res.ok) {
    throw new Error('Failed to fetch opportunities')
  }
  return res.json()
}

// ============================================================================
// Exported key + fetcher (for SWR preload)
// ============================================================================

export const getOpportunitiesKey = (cityCode: string) =>
  cityCode ? `/api/weather/opportunities?city=${cityCode}` : null

export { fetcher as opportunitiesFetcher }

// ============================================================================
// Hook
// ============================================================================

export function useWeatherOpportunities(
  cityCode: string
): UseWeatherOpportunitiesReturn {
  const { data, error, isLoading, isValidating, mutate } = useSWR<OpportunitiesApiResponse>(
    cityCode ? `/api/weather/opportunities?city=${cityCode}` : null,
    fetcher,
    {
      refreshInterval: 5 * 60 * 1000, // 5 minutes (match server cache TTL)
      dedupingInterval: 30 * 1000,
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      keepPreviousData: true,
      shouldRetryOnError: true,
      errorRetryCount: 3,
      errorRetryInterval: 5000,
    }
  )

  return {
    opportunities: data?.data?.opportunities ?? [],
    eventGroups: data?.data?.eventGroups ?? [],
    totalMarketsCount: data?.data?.totalMarketsCount ?? 0,
    allWithinBuffer: data?.data?.allWithinBuffer ?? true,
    isLoading,
    isTransitioning: isValidating && !isLoading && data?.data?.cityCode !== cityCode,
    isError: !!error || (data?.success === false),
    error: error ?? (data?.success === false ? new Error(data?.error ?? 'Unknown error') : undefined),
    refresh: () => mutate(),
    biasInfo: data?.data?.biasInfo ?? null,
  }
}
