// SWR hook for fetching live Kalshi weather markets
// Auto-refreshes every 5 minutes

import useSWR from 'swr'
import type { WeatherMarket } from '@/types/weather'

// ============================================================================
// Types
// ============================================================================

interface KalshiMarketsApiResponse {
  success: boolean
  data?: {
    markets: WeatherMarket[]
    count: number
  }
  error?: string
  cached?: boolean
  timestamp: number
}

interface UseKalshiMarketsOptions {
  refreshInterval?: number
  revalidateOnFocus?: boolean
  revalidateOnReconnect?: boolean
  status?: 'active' | 'settled'
}

interface UseKalshiMarketsReturn {
  markets: WeatherMarket[] | undefined
  count: number | undefined
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

const fetcher = async (url: string): Promise<KalshiMarketsApiResponse> => {
  const res = await fetch(url)
  if (!res.ok) {
    const error = new Error('Failed to fetch Kalshi markets')
    throw error
  }
  return res.json()
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Hook to fetch live Kalshi weather markets
 * Uses SWR for caching and automatic 5-minute refresh
 *
 * @param cityCode - Optional city code to filter markets (e.g., 'NY', 'CHI', 'LA')
 * @param options - SWR configuration options
 * @returns Kalshi markets with loading/error states
 *
 * @example
 * ```tsx
 * function MarketsList() {
 *   const { markets, isLoading, isError } = useKalshiMarkets('NY')
 *
 *   if (isLoading) return <div>Loading markets...</div>
 *   if (isError) return <div>Error loading markets</div>
 *
 *   return (
 *     <div>
 *       <h2>Active Markets: {markets?.length || 0}</h2>
 *       {markets?.map(market => (
 *         <div key={market.id}>
 *           {market.question} - ${(market.currentPrice * 100).toFixed(0)}¢
 *         </div>
 *       ))}
 *     </div>
 *   )
 * }
 * ```
 */
export function useKalshiMarkets(
  cityCode?: string,
  options: UseKalshiMarketsOptions = {}
): UseKalshiMarketsReturn {
  const {
    refreshInterval = 5 * 60 * 1000, // 5 minutes (markets change fast)
    revalidateOnFocus = false,
    revalidateOnReconnect = true,
    status = 'active',
  } = options

  // Build URL with optional filters
  const buildUrl = () => {
    const params = new URLSearchParams()
    if (cityCode) params.set('city', cityCode)
    if (status) params.set('status', status)
    return `/api/kalshi/markets?${params.toString()}`
  }

  const { data, error, isLoading, isValidating, mutate } = useSWR<KalshiMarketsApiResponse>(
    buildUrl(),
    fetcher,
    {
      refreshInterval,
      dedupingInterval: 30 * 1000, // 30 seconds (reduce duplicate requests)
      revalidateOnFocus,
      revalidateOnReconnect,
      keepPreviousData: true,
      shouldRetryOnError: true,
      errorRetryCount: 2, // Fewer retries (auth issues may not resolve)
      errorRetryInterval: 3000,
    }
  )

  return {
    markets: data?.data?.markets,
    count: data?.data?.count,
    isLoading,
    isValidating,
    isError: !!error,
    error,
    isCached: data?.cached || false,
    timestamp: data?.timestamp,
    refresh: () => mutate(),
  }
}
