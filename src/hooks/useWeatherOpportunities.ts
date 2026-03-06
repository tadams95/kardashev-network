// Hook to combine weather forecasts and Kalshi markets to find trading opportunities
// Calculates edge, expected value, and generates trading signals

import { useMemo, useEffect, useRef, useState } from 'react'
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
  buildConsensus,
  DEFAULT_FEE_RATE,
  DEFAULT_WEIGHTS,
  FORECAST_SOURCES,
} from '@/lib/models/weatherProbability'
import type { WeatherMarket, WeatherEnsemble, WeatherForecast } from '@/types/weather'
import { fahrenheitToCelsius, celsiusToFahrenheit } from '@/lib/utils/temperature'
import { getCityCoordinates } from '@/lib/utils/cityCoordinates'
import { formatWeatherDateLabel } from '@/lib/utils/dailyForecasts'
import { filterEnsembleByDate } from '@/lib/utils/ensembleDateFilter'
import {
  isDynamicWeightsLiveEnabledForCity,
  isDynamicWeightsShadowModeEnabled,
  shouldFetchDynamicWeightContexts,
} from '@/lib/utils/dynamicWeightsRouting'

type ShadowContext = {
  weights?: Record<string, number>
  regime?: string
  effectiveSampleSize?: number
}

function toEnsembleWeights(weights: Record<string, number>) {
  return {
    ...DEFAULT_WEIGHTS,
    'Open-Meteo': weights['Open-Meteo'] ?? DEFAULT_WEIGHTS['Open-Meteo'],
    'Google-Weather': weights['Google-Weather'] ?? DEFAULT_WEIGHTS['Google-Weather'],
    'METAR': DEFAULT_WEIGHTS['METAR'],
    'NWS': weights['NWS'] ?? DEFAULT_WEIGHTS['NWS'] ?? 0,
    'AccuWeather': weights['AccuWeather'] ?? DEFAULT_WEIGHTS['AccuWeather'] ?? 0,
    'Tomorrow.io': weights['Tomorrow.io'] ?? DEFAULT_WEIGHTS['Tomorrow.io'] ?? 0,
  }
}

function toLeadBucket(hoursToResolution: number): 'lt12h' | '12to24h' | '24to48h' | '48to72h' | 'gt72h' {
  if (hoursToResolution < 12) return 'lt12h'
  if (hoursToResolution < 24) return '12to24h'
  if (hoursToResolution < 48) return '24to48h'
  if (hoursToResolution < 72) return '48to72h'
  return 'gt72h'
}

function getMarketTypeKey(market: WeatherMarket): 'temperature-high' | 'temperature-low' {
  return market.temperatureType === 'low' ? 'temperature-low' : 'temperature-high'
}

function pickShadowContext(
  contexts: Record<string, ShadowContext> | null,
  market: WeatherMarket,
  hoursToResolution: number
): { key: string; context: ShadowContext } | null {
  if (!contexts) return null
  const marketType = getMarketTypeKey(market)
  const leadBucket = toLeadBucket(hoursToResolution)
  const key = `${marketType}:${leadBucket}`
  const ctx = contexts[key]
  if (!ctx?.weights) return null
  return { key, context: ctx }
}

// ============================================================================
// Types
// ============================================================================

export interface WeatherOpportunity {
  market: WeatherMarket
  modelProbability: number
  baselineModelProbability?: number
  shadowModelProbability?: number
  shadowProbabilityDelta?: number
  shadowWeightRegime?: string
  shadowContextKey?: string
  shadowEffectiveSampleSize?: number
  marketPrice: number
  edge: number
  signal: 'STRONG_YES' | 'YES' | 'HOLD' | 'NO' | 'STRONG_NO'
  expectedValue: number
  confidence: number
  reasoning: string
  hoursToResolution: number
  isForecastBracket: boolean  // true if model forecast falls within this bracket
}

export interface EventGroup {
  eventTicker: string
  city: string
  date: string
  marketType: string
  modelForecast: number
  brackets: WeatherOpportunity[]
  bestEdge: WeatherOpportunity | null
  forecastBracketIndex: number | null  // index into brackets[] of the forecast bracket
  hoursToResolution: number
}

export interface BiasInfo {
  meanError: number
  sampleCount: number
  lastUpdated: number
  correction: number
  isActive: boolean
  minSamples: number
  effectiveSampleSize?: number
}

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
// Signal Generation
// ============================================================================

function generateSignal(
  edge: number,
  confidence: number,
  hoursToResolution: number,
  direction: 'YES' | 'NO',
  minEdge: number = 0.15
): 'STRONG_YES' | 'YES' | 'HOLD' | 'NO' | 'STRONG_NO' {
  // 12-hour buffer rule: never trade within 12 hours of resolution
  if (!isTradingAllowed(hoursToResolution)) {
    return 'HOLD'
  }

  // Apply time-based discount to confidence
  const timeDiscount = getTimeBasedDiscount(hoursToResolution)
  const adjustedConfidence = confidence * timeDiscount

  if (direction === 'YES') {
    // YES side: model thinks event will happen, market underpriced
    if (edge >= minEdge + 0.05 && adjustedConfidence >= 80) return 'STRONG_YES'
    if (edge >= minEdge && adjustedConfidence >= 70) return 'YES'
  } else {
    // NO side: model thinks event won't happen, market overpriced
    if (edge >= minEdge + 0.05 && adjustedConfidence >= 80) return 'STRONG_NO'
    if (edge >= minEdge && adjustedConfidence >= 70) return 'NO'
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
  return diffMs / (1000 * 60 * 60)
}

// ============================================================================
// Temporal Matching — filter forecasts to market resolution date
// ============================================================================

// ============================================================================
// Opportunity Calculation
// ============================================================================

function calculateOpportunity(
  market: WeatherMarket,
  ensemble: WeatherEnsemble,
  minEdge: number = 0.15,
  biasCorrection: number = 0,
  shadowContext?: { key: string; context: ShadowContext } | null,
  dynamicWeightsLiveEnabled: boolean = false,
  dynamicWeightsShadowEnabled: boolean = true
): WeatherOpportunity | null {
  try {
    // Require minimum 3 unique sources for actionable signals
    if (ensemble.sources.length < 3) {
      return null
    }

    // Determine market type for agreement calculation
    const isTemp = market.outcome.includes('°F') || market.outcome.includes('temperature')
    const isPrecip = market.outcome.includes('rain') || market.outcome.includes('precip') ||
      market.outcome.includes('snow') || market.outcome.includes('inch')
    const agreementMarketType: 'high' | 'low' | 'precipitation' | undefined =
      isPrecip ? 'precipitation' : isTemp ? (market.temperatureType === 'low' ? 'low' : 'high') : undefined

    // Filter ensemble to forecasts matching market resolution date
    // failClosed: skip market rather than use wrong-day data for trading decisions
    const dateFiltered = filterEnsembleByDate(ensemble, market.resolutionTime, { failClosed: true, marketType: agreementMarketType })

    if (!dateFiltered) {
      console.warn(`[opportunity] ${market.id}: no forecasts match resolution date — skipping (fail-closed)`)
      return null
    }

    // Attach lead time so probability functions can use dynamic stdDev floor
    dateFiltered.hoursToResolution = calculateHoursToResolution(market.resolutionTime)

    // Calculate model probability based on market type
    // Kalshi thresholds are in °F but ensemble forecasts are in °C — convert before comparing
    // Bias correction is in °F (a delta); convert to °C delta: ΔC = ΔF × 5/9
    const biasCorrectionC = biasCorrection * (5 / 9)
    let probabilityResult = null

    let shadowModelProbability: number | undefined
    let shadowProbabilityDelta: number | undefined
    let shadowWeightRegime: string | undefined
    let shadowContextKey: string | undefined
    let shadowEffectiveSampleSize: number | undefined
    let baselineModelProbability: number | undefined

    if (isTemp && market.direction === 'between' && market.capStrike != null && market.threshold !== undefined) {
      const floorC = fahrenheitToCelsius(market.threshold)
      const capC = fahrenheitToCelsius(market.capStrike)
      probabilityResult = calculateBracketProbability(dateFiltered, floorC, capC, market.temperatureType, biasCorrectionC)

      if (shadowContext?.context?.weights) {
        const shadowWeights = toEnsembleWeights(shadowContext.context.weights)
        const shadowResult = calculateBracketProbability(
          dateFiltered,
          floorC,
          capC,
          market.temperatureType,
          biasCorrectionC,
          shadowWeights
        )
        shadowModelProbability = shadowResult.probability
      }
    } else if (isTemp && market.threshold !== undefined && market.direction && (market.direction === 'above' || market.direction === 'below')) {
      const thresholdC = fahrenheitToCelsius(market.threshold)
      probabilityResult = calculateTemperatureProbability(dateFiltered, thresholdC, market.direction, market.temperatureType, biasCorrectionC)

      if (shadowContext?.context?.weights) {
        const shadowWeights = toEnsembleWeights(shadowContext.context.weights)
        const shadowResult = calculateTemperatureProbability(
          dateFiltered,
          thresholdC,
          market.direction,
          market.temperatureType,
          biasCorrectionC,
          shadowWeights
        )
        shadowModelProbability = shadowResult.probability
      }
    } else if (isPrecip && market.direction === 'between' && market.capStrike != null && market.threshold !== undefined) {
      probabilityResult = calculatePrecipitationBracketProbability(dateFiltered, market.threshold, market.capStrike)
    } else if (market.threshold !== undefined) {
      probabilityResult = calculatePrecipitationProbability(dateFiltered, market.threshold)
    }

    if (!probabilityResult) return null

    const baselineProbability = probabilityResult.probability
    let modelProbability = baselineProbability
    if (shadowModelProbability != null && (dynamicWeightsLiveEnabled || dynamicWeightsShadowEnabled)) {
      shadowProbabilityDelta = shadowModelProbability - baselineProbability
      shadowWeightRegime = shadowContext?.context?.regime
      shadowContextKey = shadowContext?.key
      shadowEffectiveSampleSize = shadowContext?.context?.effectiveSampleSize

      if (dynamicWeightsLiveEnabled) {
        baselineModelProbability = baselineProbability
        modelProbability = shadowModelProbability
      }
    }
    const midPrice = market.currentPrice || 0

    // Determine direction: model > market → BUY (YES), model < market → SELL (NO)
    const tradeDirection: 'YES' | 'NO' = modelProbability > midPrice ? 'YES' : 'NO'

    // marketPrice stays in YES probability space (for display, edge, and EV)
    const marketPrice = tradeDirection === 'YES'
      ? (market.yesAsk ?? midPrice)   // buying YES: use ask (slightly above mid)
      : (market.yesBid ?? midPrice)   // selling YES (betting NO): use bid (slightly below mid)

    // Edge: difference between model's YES probability and market's YES price
    const edge = Math.abs(modelProbability - marketPrice)

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
      baselineModelProbability,
      shadowModelProbability,
      shadowProbabilityDelta,
      shadowWeightRegime,
      shadowContextKey,
      shadowEffectiveSampleSize,
      marketPrice,
      edge,
      signal,
      expectedValue: ev,
      confidence: probabilityResult.confidence,
      reasoning: probabilityResult.reasoning || '',
      hoursToResolution,
      isForecastBracket: false,
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
  const dynamicWeightsLiveEnabled = isDynamicWeightsLiveEnabledForCity(cityCode)
  const dynamicWeightsShadowEnabled = isDynamicWeightsShadowModeEnabled()

  // Fetch forecasts and markets
  const forecasts = useWeatherForecasts(cityCode)
  const markets = useKalshiMarkets(cityCode, { status: 'active' })

  // Fetch performance snapshot from API (for recommendedMinEdge)
  const [recommendedMinEdge, setRecommendedMinEdge] = useState(0.15)
  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    fetch('/api/weather/performance', { signal: controller.signal })
      .then(r => r.json())
      .then(data => {
        if (data?.data?.snapshot?.recommendedMinEdge != null) {
          setRecommendedMinEdge(data.data.snapshot.recommendedMinEdge)
        }
      })
      .catch(() => { /* use default */ })
      .finally(() => clearTimeout(timer))
    return () => controller.abort()
  }, [])

  // Fetch city bias from API (pre-computed correction)
  const [biasInfo, setBiasInfo] = useState<BiasInfo | null>(null)
  const [shadowContexts, setShadowContexts] = useState<Record<string, ShadowContext> | null>(null)
  useEffect(() => {
    if (!cityCode) return
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    fetch(`/api/weather/bias?cityCode=${encodeURIComponent(cityCode)}`, { signal: controller.signal })
      .then(r => r.json())
      .then(data => {
        if (data?.bias) {
          setBiasInfo({
            meanError: data.bias.meanError,
            sampleCount: data.bias.sampleCount,
            lastUpdated: data.bias.lastUpdated,
            correction: data.correction ?? 0,
            isActive: data.isActive ?? false,
            minSamples: data.minSamples ?? 25,
            effectiveSampleSize: data.bias.effectiveSampleSize,
          })
        } else {
          setBiasInfo(null)
        }
      })
      .catch(() => { /* no correction */ })
      .finally(() => clearTimeout(timer))
    return () => controller.abort()
  }, [cityCode])

  useEffect(() => {
    if (!cityCode) return
    if (!shouldFetchDynamicWeightContexts(cityCode)) {
      setShadowContexts(null)
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    fetch(`/api/weather/weights?cityCode=${encodeURIComponent(cityCode)}&allContexts=1`, { signal: controller.signal })
      .then(r => r.json())
      .then(data => {
        if (data?.contexts && typeof data.contexts === 'object') {
          setShadowContexts(data.contexts)
        } else {
          setShadowContexts(null)
        }
      })
      .catch(() => setShadowContexts(null))
      .finally(() => clearTimeout(timer))

    return () => controller.abort()
  }, [cityCode, dynamicWeightsLiveEnabled, dynamicWeightsShadowEnabled])

  const biasCorrection = biasInfo?.correction ?? 0

  // Calculate opportunities and event groups
  const { opportunities, eventGroups, totalMarketsCount, allWithinBuffer, forecastByEvent, perSourceForecastsByEvent } = useMemo(() => {
    if (!forecasts.ensemble || !markets.markets) {
      return { opportunities: [], eventGroups: [], totalMarketsCount: 0, allWithinBuffer: false, forecastByEvent: new Map<string, number>(), perSourceForecastsByEvent: new Map<string, Record<string, number>>() }
    }

    // Diagnostic: log when markets were fetched but all get filtered out
    if (markets.markets.length === 0) {
      console.warn(`[opportunities] ${cityCode}: 0 markets returned from API`)
    }

    // Filter to markets resolving within 48 hours with sufficient liquidity
    const MIN_VOLUME = 100   // Skip markets with <$100 volume
    const MAX_SPREAD = 0.15  // Skip markets with >15¢ bid-ask spread
    const relevantMarkets = markets.markets.filter(market => {
      const hoursToResolution = calculateHoursToResolution(market.resolutionTime)
      if (hoursToResolution <= 0 || hoursToResolution > 48) return false

      // Skip illiquid markets (microstructure filter)
      if (market.volume != null && market.volume < MIN_VOLUME) return false
      if (market.spread != null && market.spread > MAX_SPREAD) return false

      return true
    })

    // Dynamic edge threshold from performance tracker
    const minEdge = recommendedMinEdge

    // Calculate opportunities for relevant markets
    const allOpps: WeatherOpportunity[] = []

    for (const market of relevantMarkets) {
      const hoursToResolution = calculateHoursToResolution(market.resolutionTime)
      const shadowContext = pickShadowContext(shadowContexts, market, hoursToResolution)
      const opp = calculateOpportunity(
        market,
        forecasts.ensemble,
        minEdge,
        biasCorrection,
        shadowContext,
        dynamicWeightsLiveEnabled,
        dynamicWeightsShadowEnabled
      )
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

    // Raw forecast maps for signal logging — built in event group loop below
    const forecastByEvent = new Map<string, number>()
    const perSourceForecastsByEvent = new Map<string, Record<string, number>>()

    const eventGroups: EventGroup[] = []
    for (const [eventTicker, brackets] of groupMap) {
      // Sort brackets by threshold ascending
      brackets.sort((a, b) => a.market.threshold - b.market.threshold)

      // Normalize bracket probabilities to sum to 1.0
      // Each bracket's probability was computed independently and may not form a valid distribution
      const betweenBrackets = brackets.filter(b => b.market.direction === 'between')
      if (betweenBrackets.length >= 2) {
        const probSum = betweenBrackets.reduce((s, b) => s + b.modelProbability, 0)
        const baselineSum = betweenBrackets.reduce((s, b) => s + (b.baselineModelProbability ?? 0), 0)
        const shadowSum = betweenBrackets.reduce((s, b) => s + (b.shadowModelProbability ?? 0), 0)
        if (probSum > 0 && Math.abs(probSum - 1.0) > 0.01) {
          for (const b of betweenBrackets) {
            b.modelProbability = b.modelProbability / probSum
            if (b.baselineModelProbability != null && baselineSum > 0) {
              b.baselineModelProbability = b.baselineModelProbability / baselineSum
            }
            if (b.shadowModelProbability != null && shadowSum > 0) {
              b.shadowModelProbability = b.shadowModelProbability / shadowSum
            }
            if (b.baselineModelProbability != null && b.shadowModelProbability != null) {
              b.shadowProbabilityDelta = b.shadowModelProbability - b.baselineModelProbability
            } else if (b.shadowModelProbability != null) {
              b.shadowProbabilityDelta = b.shadowModelProbability - b.modelProbability
            }
            // Recalculate direction, marketPrice, edge, and signal with normalized probability
            // FA-01: Decide direction against neutral midPrice, not stale b.marketPrice
            const midPrice = b.market.currentPrice || 0
            const tradeDir: 'YES' | 'NO' = b.modelProbability > midPrice ? 'YES' : 'NO'
            b.marketPrice = tradeDir === 'YES'
              ? (b.market.yesAsk ?? midPrice)
              : (b.market.yesBid ?? midPrice)
            b.edge = Math.abs(b.modelProbability - b.marketPrice)
            b.expectedValue = calculateExpectedValue(b.modelProbability, b.marketPrice, 100, DEFAULT_FEE_RATE)
            b.signal = generateSignal(b.edge, b.confidence, b.hoursToResolution, tradeDir, minEdge)
          }
        }
      }

      const firstBracket = brackets[0]

      // Timezone-aware date label: "Today", "Tomorrow", or "Wed, Feb 14"
      const cityTimezone = getCityCoordinates(cityCode)?.timezone ?? 'America/New_York'
      const dateStr = formatWeatherDateLabel(firstBracket.market.resolutionTime, cityTimezone)

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
      // Use weighted average with DEFAULT_WEIGHTS for consistency with other components
      // Display path: no failClosed — falls back to full ensemble (never null)
      const dateFiltered = filterEnsembleByDate(forecasts.ensemble!, firstBracket.market.resolutionTime)!
      // Use only forecast sources (exclude ground-truth observations like METAR)
      const forecastsOnly = dateFiltered.forecasts.filter(f => FORECAST_SOURCES.has(f.source))
      const weights = dateFiltered.activeWeights ?? DEFAULT_WEIGHTS
      let rawForecast: number
      const perSourceForecasts: Record<string, number> = {}
      if (marketType === 'Low Temperature') {
        const tempValues = forecastsOnly
          .filter(f => typeof f.temperature.min === 'number' && !isNaN(f.temperature.min))
          .map(f => ({ value: f.temperature.min, weight: weights[f.source] || 0.15, source: f.source }))
        const weightedMin = tempValues.length > 0
          ? tempValues.reduce((s, v) => s + v.value * v.weight, 0) / tempValues.reduce((s, v) => s + v.weight, 0)
          : dateFiltered.consensus.temperatureMean
        rawForecast = celsiusToFahrenheit(weightedMin)

        // Capture per-source forecast temperatures (°F)
        for (const v of tempValues) {
          perSourceForecasts[v.source] = celsiusToFahrenheit(v.value)
        }

        // Diagnostic: log per-source contributions
        console.debug(
          `[Forecast] ${cityCode} ${marketType}:`,
          tempValues.map(v => `${v.source}=${celsiusToFahrenheit(v.value).toFixed(1)}°F (w=${v.weight})`).join(', '),
          `→ weighted=${rawForecast.toFixed(1)}°F`
        )
      } else {
        const tempValues = forecastsOnly
          .filter(f => typeof f.temperature.max === 'number' && !isNaN(f.temperature.max))
          .map(f => ({ value: f.temperature.max, weight: weights[f.source] || 0.15, source: f.source }))
        const weightedMax = tempValues.length > 0
          ? tempValues.reduce((s, v) => s + v.value * v.weight, 0) / tempValues.reduce((s, v) => s + v.weight, 0)
          : dateFiltered.consensus.temperatureMean
        rawForecast = celsiusToFahrenheit(weightedMax)

        // Capture per-source forecast temperatures (°F)
        for (const v of tempValues) {
          perSourceForecasts[v.source] = celsiusToFahrenheit(v.value)
        }

        // Diagnostic: log per-source contributions
        console.debug(
          `[Forecast] ${cityCode} ${marketType}:`,
          tempValues.map(v => `${v.source}=${celsiusToFahrenheit(v.value).toFixed(1)}°F (w=${v.weight})`).join(', '),
          `→ weighted=${rawForecast.toFixed(1)}°F`
        )
      }

      // Apply bias correction to a separate display variable
      // rawForecast is logged as forecastTemp (for unbiased bias tracking)
      // displayForecast is used for UI display and bracket identification
      const displayForecast = rawForecast + biasCorrection

      // Identify which bracket contains the display forecast (bias-corrected)
      let forecastBracketIndex: number | null = null
      for (let i = 0; i < brackets.length; i++) {
        const b = brackets[i]
        if (
          b.market.direction === 'between' &&
          b.market.capStrike != null &&
          displayForecast >= b.market.threshold &&
          displayForecast < b.market.capStrike
        ) {
          forecastBracketIndex = i
          b.isForecastBracket = true
          break
        }
      }
      // Fallback: forecast in a gap between sparse brackets — pick nearest
      if (forecastBracketIndex === null && brackets.length > 0) {
        let nearestIdx = -1
        let minDist = Infinity
        for (let i = 0; i < brackets.length; i++) {
          const b = brackets[i]
          if (b.market.direction !== 'between' || b.market.capStrike == null) continue
          const mid = (b.market.threshold + b.market.capStrike) / 2
          const dist = Math.abs(displayForecast - mid)
          if (dist < minDist) {
            minDist = dist
            nearestIdx = i
          }
        }
        if (nearestIdx >= 0) {
          forecastBracketIndex = nearestIdx
          brackets[nearestIdx].isForecastBracket = true
        }
      }

      // Store raw forecast for bias tracking (unbiased) and per-source data
      forecastByEvent.set(eventTicker, rawForecast)
      perSourceForecastsByEvent.set(eventTicker, perSourceForecasts)

      eventGroups.push({
        eventTicker,
        city: firstBracket.market.location.city,
        date: dateStr,
        marketType,
        modelForecast: displayForecast,
        brackets,
        bestEdge,
        forecastBracketIndex,
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

    // Diagnostic fields for empty state
    const totalMarketsCount = relevantMarkets.length
    const allWithinBuffer = totalMarketsCount > 0 && relevantMarkets.every(m => {
      const hrs = calculateHoursToResolution(m.resolutionTime)
      return hrs < 12
    })

    if (relevantMarkets.length === 0 && markets.markets.length > 0) {
      console.warn(`[opportunities] ${cityCode}: ${markets.markets.length} markets fetched but 0 passed filters (48h window / volume / spread)`)
    }

    return { opportunities, eventGroups, totalMarketsCount, allWithinBuffer, forecastByEvent, perSourceForecastsByEvent }
  }, [
    forecasts.ensemble,
    markets.markets,
    cityCode,
    recommendedMinEdge,
    biasCorrection,
    shadowContexts,
    dynamicWeightsLiveEnabled,
    dynamicWeightsShadowEnabled,
  ])

  // Log actionable signals via API (fire-and-forget)
  const loggedSignalsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    // Skip logging when markets are revalidating — stale data from previous city
    // may still be present due to SWR's keepPreviousData: true
    if (markets.isValidating) return

    const currentCityName = getCityCoordinates(cityCode)?.name
    const controllers: AbortController[] = []
    const timers: ReturnType<typeof setTimeout>[] = []

    for (const opp of opportunities) {
      // Validate the market's city matches the current city to prevent cross-city contamination
      if (currentCityName && opp.market.location?.city !== currentCityName) continue

      if (opp.signal !== 'HOLD' && !loggedSignalsRef.current.has(opp.market.id)) {
        const eventTicker = opp.market.eventTicker || opp.market.id
        // Fire-and-forget POST to performance API
        const logController = new AbortController()
        controllers.push(logController)
        timers.push(setTimeout(() => logController.abort(), 5000))
        const srcForecasts = perSourceForecastsByEvent.get(eventTicker)
        fetch('/api/weather/performance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'log',
            marketId: opp.market.id,
            modelProbability: opp.modelProbability,
            marketPrice: opp.marketPrice,
            edge: opp.edge,
            direction: opp.modelProbability > opp.marketPrice ? 'YES' : 'NO',
            signal: opp.signal,
            cityCode,
            forecastTemp: forecastByEvent.get(eventTicker),
            hoursToResolution: opp.hoursToResolution,
            temperatureType: opp.market.temperatureType,
            rawModelProbability: opp.baselineModelProbability ?? opp.modelProbability,
            correctedModelProbability: opp.baselineModelProbability != null
              ? opp.modelProbability
              : opp.shadowModelProbability,
            probabilityDelta: opp.baselineModelProbability != null
              ? (opp.modelProbability - opp.baselineModelProbability)
              : opp.shadowProbabilityDelta,
            shadowMeta: opp.shadowContextKey ? {
              regime: opp.shadowWeightRegime,
              contextKey: opp.shadowContextKey,
              effectiveSampleSize: opp.shadowEffectiveSampleSize,
            } : undefined,
            ...(srcForecasts && Object.keys(srcForecasts).length > 0 ? { perSourceForecasts: srcForecasts } : {}),
          }),
          signal: logController.signal,
        }).catch(() => { /* best-effort */ })
        loggedSignalsRef.current.add(opp.market.id)
      }
    }

    return () => {
      timers.forEach(clearTimeout)
      controllers.forEach(c => c.abort())
    }
  }, [opportunities, forecastByEvent, perSourceForecastsByEvent, cityCode, markets.isValidating])

  return {
    opportunities,
    eventGroups,
    totalMarketsCount,
    allWithinBuffer,
    isLoading: forecasts.isLoading || markets.isLoading,
    isTransitioning: (forecasts.isValidating || markets.isValidating) && !forecasts.isLoading && !markets.isLoading,
    isError: forecasts.isError || markets.isError,
    error: forecasts.error || markets.error,
    refresh: () => {
      forecasts.refresh()
      markets.refresh()
    },
    biasInfo,
  }
}
