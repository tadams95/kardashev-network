// Hook to combine weather forecasts and Kalshi markets to find trading opportunities
// Calculates edge, expected value, and generates trading signals

import { useMemo, useEffect, useRef } from 'react'
import { useWeatherForecasts } from './useWeatherForecasts'
import { useKalshiMarkets } from './useKalshiMarkets'
import {
  calculateTemperatureProbability,
  calculateBracketProbability,
  calculatePrecipitationProbability,
  calculatePrecipitationBracketProbability,
  calculateExpectedValue,
  isTradingAllowed,
  getTimeBasedDiscount,
  DEFAULT_FEE_RATE,
} from '@/lib/models/weatherProbability'
import type { WeatherMarket, WeatherEnsemble } from '@/types/weather'
import { fahrenheitToCelsius, celsiusToFahrenheit } from '@/lib/utils/temperature'
import { logSignal, getPerformanceSnapshot } from '@/lib/models/performanceTracker'

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

export interface EventGroup {
  eventTicker: string
  city: string
  date: string
  marketType: string
  modelForecast: number
  brackets: WeatherOpportunity[]
  bestEdge: WeatherOpportunity | null
  hoursToResolution: number
}

interface UseWeatherOpportunitiesReturn {
  opportunities: WeatherOpportunity[]
  eventGroups: EventGroup[]
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
  hoursToResolution: number,
  direction: 'YES' | 'NO',
  minEdge: number = 0.15
): 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL' {
  // 12-hour buffer rule: never trade within 12 hours of resolution
  if (!isTradingAllowed(hoursToResolution)) {
    return 'HOLD'
  }

  // Apply time-based discount to confidence
  const timeDiscount = getTimeBasedDiscount(hoursToResolution)
  const adjustedConfidence = confidence * timeDiscount

  if (direction === 'YES') {
    // BUY side: model thinks market is underpriced
    if (edge >= minEdge + 0.05 && adjustedConfidence >= 80) return 'STRONG_BUY'
    if (edge >= minEdge && adjustedConfidence >= 70) return 'BUY'
  } else {
    // SELL side: model thinks market is overpriced
    if (edge >= minEdge + 0.05 && adjustedConfidence >= 80) return 'STRONG_SELL'
    if (edge >= minEdge && adjustedConfidence >= 70) return 'SELL'
  }

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
// Temporal Matching — filter forecasts to market resolution date
// ============================================================================

function filterEnsembleByDate(
  ensemble: WeatherEnsemble,
  resolutionTime: string
): WeatherEnsemble {
  // Markets resolve the morning AFTER the weather day — subtract 1 day
  const resolution = new Date(resolutionTime)
  resolution.setUTCDate(resolution.getUTCDate() - 1)
  const weatherDate = resolution.toISOString().slice(0, 10)

  // Filter forecasts to those matching the weather calendar date
  const matched = ensemble.forecasts.filter(f => {
    const forecastDate = new Date(f.timestamp).toISOString().slice(0, 10)
    return forecastDate === weatherDate
  })

  // If no forecasts match (market beyond forecast horizon), fall back to full ensemble
  if (matched.length === 0) return ensemble

  // Prefer daily forecasts (min ≠ max) over hourly (min === max) when both exist
  const daily = matched.filter(f => f.temperature.min !== f.temperature.max)
  const filtered = daily.length > 0 ? daily : matched

  return {
    ...ensemble,
    forecasts: filtered,
    // Keep original consensus.modelAgreement — still valid for adjustment
  }
}

// ============================================================================
// Opportunity Calculation
// ============================================================================

function calculateOpportunity(
  market: WeatherMarket,
  ensemble: WeatherEnsemble,
  minEdge: number = 0.15
): WeatherOpportunity | null {
  try {
    // Require minimum 3 unique sources for actionable signals
    if (ensemble.sources.length < 3) {
      return null
    }

    // Filter ensemble to forecasts matching market resolution date
    const dateFiltered = filterEnsembleByDate(ensemble, market.resolutionTime)

    // Calculate model probability based on market type
    // Kalshi thresholds are in °F but ensemble forecasts are in °C — convert before comparing
    let probabilityResult = null
    const isTemp = market.outcome.includes('°F') || market.outcome.includes('temperature')
    const isPrecip = market.outcome.includes('rain') || market.outcome.includes('precip') ||
      market.outcome.includes('snow') || market.outcome.includes('inch')

    if (isTemp && market.direction === 'between' && market.capStrike != null && market.threshold !== undefined) {
      const floorC = fahrenheitToCelsius(market.threshold)
      const capC = fahrenheitToCelsius(market.capStrike)
      probabilityResult = calculateBracketProbability(dateFiltered, floorC, capC)
    } else if (isTemp && market.threshold !== undefined && market.direction && (market.direction === 'above' || market.direction === 'below')) {
      const thresholdC = fahrenheitToCelsius(market.threshold)
      probabilityResult = calculateTemperatureProbability(dateFiltered, thresholdC, market.direction)
    } else if (isPrecip && market.direction === 'between' && market.capStrike != null && market.threshold !== undefined) {
      probabilityResult = calculatePrecipitationBracketProbability(dateFiltered, market.threshold, market.capStrike)
    } else if (market.threshold !== undefined) {
      probabilityResult = calculatePrecipitationProbability(dateFiltered, market.threshold)
    }

    if (!probabilityResult) return null

    const modelProbability = probabilityResult.probability
    const marketPrice = market.currentPrice || 0

    // Calculate edge (absolute difference)
    const edge = Math.abs(modelProbability - marketPrice)

    // Determine direction: model > market → BUY (YES), model < market → SELL (NO)
    const tradeDirection: 'YES' | 'NO' = modelProbability > marketPrice ? 'YES' : 'NO'

    // Calculate hours to resolution
    const hoursToResolution = calculateHoursToResolution(market.resolutionTime)

    // Calculate expected value
    const ev = calculateExpectedValue(
      modelProbability,
      marketPrice,
      100, // $100 position size for display
      DEFAULT_FEE_RATE
    )

    // Generate signal with direction (uses decay-adjusted minEdge)
    const signal = generateSignal(edge, probabilityResult.confidence, hoursToResolution, tradeDirection, minEdge)

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

  // Calculate opportunities and event groups
  const { opportunities, eventGroups } = useMemo(() => {
    if (!forecasts.ensemble || !markets.markets) {
      return { opportunities: [], eventGroups: [] }
    }

    // Filter to markets resolving within 48 hours with sufficient liquidity
    const MIN_VOLUME = 100   // Skip markets with <$100 volume
    const MAX_SPREAD = 0.15  // Skip markets with >15¢ bid-ask spread
    const relevantMarkets = markets.markets.filter(market => {
      const hoursToResolution = calculateHoursToResolution(market.resolutionTime)
      if (hoursToResolution < 0 || hoursToResolution > 48) return false

      // Skip illiquid markets (microstructure filter)
      if (market.volume != null && market.volume < MIN_VOLUME) return false
      if (market.spread != null && market.spread > MAX_SPREAD) return false

      return true
    })

    // Get dynamic edge threshold from performance tracker
    const snapshot = getPerformanceSnapshot()
    const minEdge = snapshot.recommendedMinEdge

    // Calculate opportunities for relevant markets
    const allOpps: WeatherOpportunity[] = []

    for (const market of relevantMarkets) {
      const opp = calculateOpportunity(market, forecasts.ensemble, minEdge)
      if (opp) {
        allOpps.push(opp)
      }
    }

    // Filtered list (edge >= 5%) for backward compat
    const opportunities = allOpps
      .filter(opp => opp.edge >= 0.05)
      .sort((a, b) => b.edge - a.edge)

    // Group all opps by eventTicker into EventGroup[]
    const groupMap = new Map<string, WeatherOpportunity[]>()
    for (const opp of allOpps) {
      const key = opp.market.eventTicker || opp.market.id
      if (!groupMap.has(key)) {
        groupMap.set(key, [])
      }
      groupMap.get(key)!.push(opp)
    }

    const eventGroups: EventGroup[] = []
    for (const [eventTicker, brackets] of groupMap) {
      // Sort brackets by threshold ascending
      brackets.sort((a, b) => a.market.threshold - b.market.threshold)

      const firstBracket = brackets[0]

      // Weather date = resolution - 1 day (markets resolve the morning AFTER the weather day)
      // Use UTC to match filterEnsembleByDate and avoid local timezone bugs
      const resolution = new Date(firstBracket.market.resolutionTime)
      resolution.setUTCDate(resolution.getUTCDate() - 1)
      const weatherDateStr = resolution.toISOString().slice(0, 10)  // "YYYY-MM-DD" in UTC

      // Relative label: "Today", "Tomorrow", or formatted date
      const now = new Date()
      const todayStr = now.toISOString().slice(0, 10)
      const tomorrow = new Date(now)
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
      const tomorrowStr = tomorrow.toISOString().slice(0, 10)

      let dateStr: string
      if (weatherDateStr === todayStr) {
        dateStr = 'Today'
      } else if (weatherDateStr === tomorrowStr) {
        dateStr = 'Tomorrow'
      } else {
        const wd = new Date(weatherDateStr + 'T12:00:00Z')
        dateStr = wd.toLocaleDateString('en-US', {
          weekday: 'short', month: 'short', day: 'numeric',
          timeZone: 'UTC',
        })
      }

      // Determine market type label
      let marketType = 'High Temperature'
      const ticker = eventTicker.toUpperCase()
      if (ticker.includes('LOW')) marketType = 'Low Temperature'
      else if (ticker.includes('RAIN')) marketType = 'Rainfall'
      else if (ticker.includes('SNOW')) marketType = 'Snowfall'

      // Find best edge bracket (edge >= 5%)
      const actionable = brackets.filter(b => b.edge >= 0.05)
      const bestEdge = actionable.length > 0
        ? actionable.reduce((best, b) => b.edge > best.edge ? b : best, actionable[0])
        : null

      // Pick the relevant forecast value for this market type
      // Filter to resolution date so modelForecast reflects that specific day
      const dateFiltered = filterEnsembleByDate(forecasts.ensemble!, firstBracket.market.resolutionTime)
      let modelForecast: number
      if (marketType === 'Low Temperature') {
        const minTemps = dateFiltered.forecasts
          .map(f => f.temperature.min)
          .filter(t => typeof t === 'number' && !isNaN(t))
        modelForecast = celsiusToFahrenheit(
          minTemps.length > 0 ? minTemps.reduce((a, b) => a + b, 0) / minTemps.length : dateFiltered.consensus.temperatureMean
        )
      } else {
        const maxTemps = dateFiltered.forecasts
          .map(f => f.temperature.max)
          .filter(t => typeof t === 'number' && !isNaN(t))
        modelForecast = celsiusToFahrenheit(
          maxTemps.length > 0 ? maxTemps.reduce((a, b) => a + b, 0) / maxTemps.length : dateFiltered.consensus.temperatureMean
        )
      }

      eventGroups.push({
        eventTicker,
        city: firstBracket.market.location.city,
        date: dateStr,
        marketType,
        modelForecast,
        brackets,
        bestEdge,
        hoursToResolution: firstBracket.hoursToResolution,
      })
    }

    // Sort: groups with best edge first, then by hours to resolution
    eventGroups.sort((a, b) => {
      const aEdge = a.bestEdge?.edge ?? 0
      const bEdge = b.bestEdge?.edge ?? 0
      if (bEdge !== aEdge) return bEdge - aEdge
      return a.hoursToResolution - b.hoursToResolution
    })

    return { opportunities, eventGroups }
  }, [forecasts.ensemble, markets.markets])

  // Log actionable signals in useEffect (not useMemo) to avoid side-effects during render
  const loggedSignalsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    for (const opp of opportunities) {
      if (opp.signal !== 'HOLD' && !loggedSignalsRef.current.has(opp.market.id)) {
        logSignal({
          marketId: opp.market.id,
          timestamp: Date.now(),
          modelProbability: opp.modelProbability,
          marketPrice: opp.marketPrice,
          edge: opp.edge,
          direction: opp.modelProbability > opp.marketPrice ? 'YES' : 'NO',
          signal: opp.signal,
        })
        loggedSignalsRef.current.add(opp.market.id)
      }
    }
  }, [opportunities])

  return {
    opportunities,
    eventGroups,
    isLoading: forecasts.isLoading || markets.isLoading,
    isError: forecasts.isError || markets.isError,
    error: forecasts.error || markets.error,
    refresh: () => {
      forecasts.refresh()
      markets.refresh()
    },
  }
}
