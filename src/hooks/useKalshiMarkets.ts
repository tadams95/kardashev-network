// SWR hook for fetching live Kalshi weather markets
// Auto-refreshes every 5 minutes

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
// Exported key + fetcher (for SWR preload)
// ============================================================================

export const getMarketsKey = (cityCode: string, status = 'active') => {
  const params = new URLSearchParams()
  if (cityCode) params.set('city', cityCode)
  if (status) params.set('status', status)
  return `/api/kalshi/markets?${params.toString()}`
}

export { fetcher as marketsFetcher }
