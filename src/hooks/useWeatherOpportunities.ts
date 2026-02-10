// Hook to combine weather forecasts and Kalshi markets to find trading opportunities
// Calculates edge, expected value, and generates trading signals

import { useMemo } from 'react'
import { useWeatherForecasts } from './useWeatherForecasts'
import { useKalshiMarkets } from './useKalshiMarkets'
import {
  calculateTemperatureProbability,
  calculatePrecipitationProbability,
  calculateExpectedValue,
  isTradingAllowed,
  getTimeBasedDiscount,
} from '@/lib/models/weatherProbability'
import type { WeatherMarket, WeatherEnsemble } from '@/types/weather'

// ============================================================================
// Types
// ============================================================================

export interface WeatherOpportunity {
  market: WeatherMarket
  modelProbability: number
  marketPrice: number
  edge: number
  signal: 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL'
  expectedValue: number
  confidence: number
  reasoning: string
  hoursToResolution: number
}

interface UseWeatherOpportunitiesReturn {
  opportunities: WeatherOpportunity[]
  isLoading: boolean
  isError: boolean
  error: Error | undefined
  refresh: () => void
}

// ============================================================================
// Signal Generation
// ============================================================================

function generateSignal(
  edge: number,
  confidence: number,
  hoursToResolution: number
): 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL' {
  // 12-hour buffer rule: never trade within 12 hours of resolution
  if (!isTradingAllowed(hoursToResolution)) {
    return 'HOLD'
  }

  // Apply time-based discount to confidence
  const timeDiscount = getTimeBasedDiscount(hoursToResolution)
  const adjustedConfidence = confidence * timeDiscount

  // Signal thresholds
  if (edge >= 0.20 && adjustedConfidence >= 80) return 'STRONG_BUY'
  if (edge >= 0.15 && adjustedConfidence >= 70) return 'BUY'
  if (edge >= 0.10 && adjustedConfidence >= 60) return 'HOLD'

  return 'HOLD'
}

// ============================================================================
// Hours to Resolution
// ============================================================================

function calculateHoursToResolution(resolutionTime: string): number {
  const resolution = new Date(resolutionTime).getTime()
  const now = Date.now()
  const diffMs = resolution - now
  return Math.max(0, diffMs / (1000 * 60 * 60))
}

// ============================================================================
// Opportunity Calculation
// ============================================================================

function calculateOpportunity(
  market: WeatherMarket,
  ensemble: WeatherEnsemble
): WeatherOpportunity | null {
  try {
    // Calculate model probability based on market type
    const probabilityResult = market.threshold !== undefined &&
      market.direction &&
      (market.outcome.includes('°F') || market.outcome.includes('temperature'))
      ? calculateTemperatureProbability(ensemble, market.threshold, market.direction)
      : market.threshold !== undefined
      ? calculatePrecipitationProbability(ensemble, market.threshold)
      : null

    if (!probabilityResult) return null

    const modelProbability = probabilityResult.probability
    const marketPrice = market.currentPrice || 0

    // Calculate edge (absolute difference)
    const edge = Math.abs(modelProbability - marketPrice)

    // Calculate hours to resolution
    const hoursToResolution = calculateHoursToResolution(market.resolutionTime)

    // Calculate expected value
    const ev = calculateExpectedValue(
      modelProbability,
      marketPrice,
      100, // $100 position size for display
      0.15 // 15% all-in fees
    )

    // Generate signal
    const signal = generateSignal(edge, probabilityResult.confidence, hoursToResolution)

    return {
      market,
      modelProbability,
      marketPrice,
      edge,
      signal,
      expectedValue: ev,
      confidence: probabilityResult.confidence,
      reasoning: probabilityResult.reasoning || '',
      hoursToResolution,
    }
  } catch (error) {
    console.warn('Failed to calculate opportunity for market:', market.id, error)
    return null
  }
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Hook to find trading opportunities by comparing weather forecasts to Kalshi markets
 * Calculates edge, expected value, and generates trading signals
 *
 * @param cityCode - City code (e.g., 'NY', 'CHI', 'LA')
 * @returns Trading opportunities with loading/error states
 *
 * @example
 * ```tsx
 * function OpportunitiesTable() {
 *   const { opportunities, isLoading, isError } = useWeatherOpportunities('NY')
 *
 *   if (isLoading) return <div>Loading opportunities...</div>
 *   if (isError) return <div>Error loading opportunities</div>
 *
 *   return (
 *     <div>
 *       <h2>Trading Opportunities: {opportunities.length}</h2>
 *       {opportunities.map(opp => (
 *         <div key={opp.market.id}>
 *           {opp.market.question}
 *           <br />
 *           Edge: {(opp.edge * 100).toFixed(1)}%
 *           <br />
 *           Signal: {opp.signal}
 *           <br />
 *           EV: ${opp.expectedValue.toFixed(2)}
 *         </div>
 *       ))}
 *     </div>
 *   )
 * }
 * ```
 */
export function useWeatherOpportunities(
  cityCode: string
): UseWeatherOpportunitiesReturn {
  // Fetch forecasts and markets
  const forecasts = useWeatherForecasts(cityCode)
  const markets = useKalshiMarkets(cityCode, { status: 'active' })

  // Calculate opportunities
  const opportunities = useMemo(() => {
    if (!forecasts.ensemble || !markets.markets) {
      return []
    }

    const opps: WeatherOpportunity[] = []

    for (const market of markets.markets) {
      const opp = calculateOpportunity(market, forecasts.ensemble)
      if (opp) {
        opps.push(opp)
      }
    }

    // Filter: only show meaningful opportunities (edge > 5%)
    const filtered = opps.filter(opp => opp.edge >= 0.05)

    // Sort by edge descending (highest edge first)
    const sorted = filtered.sort((a, b) => b.edge - a.edge)

    return sorted
  }, [forecasts.ensemble, markets.markets])

  return {
    opportunities,
    isLoading: forecasts.isLoading || markets.isLoading,
    isError: forecasts.isError || markets.isError,
    error: forecasts.error || markets.error,
    refresh: () => {
      forecasts.refresh()
      markets.refresh()
    },
  }
}
