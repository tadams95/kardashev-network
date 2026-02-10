// SWR hook for fetching weather backtesting results
// Provides performance metrics and trade history for the weather trading model

import useSWR from 'swr'
import type { BacktestResults } from '@/lib/backtesting/backtest'

// ============================================================================
// Types
// ============================================================================

interface BacktestApiResponse {
  success: boolean
  data?: BacktestResults
  error?: string
  cached?: boolean
  timestamp?: number
}

interface UseBacktestResultsOptions {
  refreshInterval?: number
  revalidateOnFocus?: boolean
  revalidateOnReconnect?: boolean
}

interface UseBacktestResultsReturn {
  results: BacktestResults | undefined
  isLoading: boolean
  isError: boolean
  error: Error | undefined
  isCached: boolean
  timestamp: number | undefined
  refresh: () => void
}

// ============================================================================
// Fetcher
// ============================================================================

const fetcher = async (url: string): Promise<BacktestApiResponse> => {
  const res = await fetch(url)
  if (!res.ok) {
    const error = new Error('Failed to fetch backtest results')
    throw error
  }
  return res.json()
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Hook to fetch weather trading backtesting results
 * Uses SWR for caching and revalidation
 *
 * @param options - SWR configuration options
 * @returns Backtest results with loading/error states
 *
 * @example
 * ```tsx
 * function BacktestDashboard() {
 *   const { results, isLoading, isError } = useBacktestResults()
 *
 *   if (isLoading) return <div>Loading backtest results...</div>
 *   if (isError) return <div>Error loading results</div>
 *
 *   return (
 *     <div>
 *       <h2>Win Rate: {(results.summary.winRate * 100).toFixed(1)}%</h2>
 *       <p>Total Trades: {results.summary.totalTrades}</p>
 *     </div>
 *   )
 * }
 * ```
 */
export function useBacktestResults(
  options: UseBacktestResultsOptions = {}
): UseBacktestResultsReturn {
  const {
    refreshInterval = 0, // Don't auto-refresh (expensive computation)
    revalidateOnFocus = false,
    revalidateOnReconnect = false,
  } = options

  const { data, error, isLoading, mutate } = useSWR<BacktestApiResponse>(
    '/api/weather/backtest',
    fetcher,
    {
      refreshInterval,
      revalidateOnFocus,
      revalidateOnReconnect,
      dedupingInterval: 300000, // 5 minutes (reduce duplicate requests)
    }
  )

  return {
    results: data?.data,
    isLoading,
    isError: !!error,
    error,
    isCached: data?.cached || false,
    timestamp: data?.timestamp,
    refresh: () => mutate(),
  }
}
