// Server-portable opportunity computation extracted from useWeatherOpportunities hook.
// All functions in this module are pure (no React, no browser APIs).

import {
  calculateTemperatureProbability,
  calculateBracketProbability,
  calculatePrecipitationProbability,
  calculatePrecipitationBracketProbability,
  calculateExpectedValue,
  isTradingAllowed,
  getTimeBasedDiscount,
  DEFAULT_FEE_RATE,
  DEFAULT_WEIGHTS,
  FORECAST_SOURCES,
} from '@/lib/models/weatherProbability'
import type { WeatherMarket, WeatherEnsemble } from '@/types/weather'
import { fahrenheitToCelsius, celsiusToFahrenheit } from '@/lib/utils/temperature'
import { getCityCoordinates } from '@/lib/utils/cityCoordinates'
import { formatWeatherDateLabel } from '@/lib/utils/dailyForecasts'
import { filterEnsembleByDate } from '@/lib/utils/ensembleDateFilter'
import { detectDisagreements } from '@/lib/models/disagreementDetector'
import type { EventBracket, DisagreementSignal } from '@/lib/models/disagreementDetector'

// ============================================================================
// Types
// ============================================================================

export type ShadowContext = {
  weights?: Record<string, number>
  regime?: string
  effectiveSampleSize?: number
}

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
  disagreementSignal?: DisagreementSignal
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
  capped: boolean
  minSamples: number
  effectiveSampleSize?: number
}

// ============================================================================
// Helpers
// ============================================================================

export function toEnsembleWeights(weights: Record<string, number>) {
  return {
    ...DEFAULT_WEIGHTS,
    'Open-Meteo': weights['Open-Meteo'] ?? DEFAULT_WEIGHTS['Open-Meteo'],
    'Google-Weather': weights['Google-Weather'] ?? DEFAULT_WEIGHTS['Google-Weather'],
    'NWS': weights['NWS'] ?? DEFAULT_WEIGHTS['NWS'] ?? 0,
    'AccuWeather': weights['AccuWeather'] ?? DEFAULT_WEIGHTS['AccuWeather'] ?? 0,
    'Tomorrow.io': weights['Tomorrow.io'] ?? DEFAULT_WEIGHTS['Tomorrow.io'] ?? 0,
  }
}

export function toLeadBucket(hoursToResolution: number): 'lt12h' | '12to24h' | '24to48h' | '48to72h' | 'gt72h' {
  if (hoursToResolution < 12) return 'lt12h'
  if (hoursToResolution < 24) return '12to24h'
  if (hoursToResolution < 48) return '24to48h'
  if (hoursToResolution < 72) return '48to72h'
  return 'gt72h'
}

export function getMarketTypeKey(market: WeatherMarket): 'temperature-high' | 'temperature-low' {
  return market.temperatureType === 'low' ? 'temperature-low' : 'temperature-high'
}

export function pickShadowContext(
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
// Cross-City Contamination Guard
// ============================================================================

/** Returns true if data should be rejected as cross-city stale */
export function isCrossCityStale(
  cityCode: string,
  forecastCityName: string | undefined,
  marketCityName: string | undefined
): boolean {
  const expectedCity = getCityCoordinates(cityCode)?.name
  if (!expectedCity) return false
  if (forecastCityName && forecastCityName !== expectedCity) return true
  if (marketCityName && marketCityName !== expectedCity) return true
  return false
}

// ============================================================================
// Signal Generation
// ============================================================================

// Tail contract guard: markets at extreme prices are well-calibrated by the market
// but the model's compressed probabilities create phantom edges.
// Brier audit (2026-03-14): STRONG_YES 0/56 wins, YES 5/94 wins (5.3%).
// Only competitive range is 20-50¢ (BSS ~ -0.35, ~52% win rate).
// YES signals KILLED until BMA Phase 2 fixes the probability model.
const YES_SIGNALS_ENABLED = false   // MORATORIUM: 0/56 STRONG_YES wins, inverted confidence above 40%
const TAIL_MARKET_THRESHOLD = 0.20  // Only trade markets priced 20-50¢
const TAIL_UPPER_THRESHOLD = 0.50   // Competitive range ceiling — everything above is BSS < -1
const TAIL_REQUIRED_EDGE = 0.40     // Require 40% edge on tail contracts vs standard 15%

export function generateSignal(
  edge: number,
  confidence: number,
  hoursToResolution: number,
  direction: 'YES' | 'NO',
  minEdge: number = 0.15,
  marketPrice?: number,
  marketId?: string
): 'STRONG_YES' | 'YES' | 'HOLD' | 'NO' | 'STRONG_NO' {
  // 12-hour buffer rule: never trade within 12 hours of resolution
  if (!isTradingAllowed(hoursToResolution)) {
    return 'HOLD'
  }

  // YES signal moratorium: model confidence is inverted above 40% predicted probability.
  // Re-enable after BMA Phase 2 fixes the probability model.
  if (direction === 'YES' && !YES_SIGNALS_ENABLED) {
    return 'HOLD'
  }

  // Tail contract guard: only trade in the 20-50¢ competitive range
  const isTailContract = marketPrice != null &&
    (marketPrice < TAIL_MARKET_THRESHOLD || marketPrice > TAIL_UPPER_THRESHOLD)
  const requiredEdge = isTailContract ? Math.max(minEdge, TAIL_REQUIRED_EDGE) : minEdge

  // Apply time-based discount to confidence
  const timeDiscount = getTimeBasedDiscount(hoursToResolution)
  const adjustedConfidence = confidence * timeDiscount

  if (direction === 'YES') {
    // YES side: model thinks event will happen, market underpriced
    if (edge >= requiredEdge + 0.05 && adjustedConfidence >= 80) return 'STRONG_YES'
    if (edge >= requiredEdge && adjustedConfidence >= 70) return 'YES'
  } else {
    // NO side: model thinks event won't happen, market overpriced
    if (edge >= requiredEdge + 0.05 && adjustedConfidence >= 80) return 'STRONG_NO'
    if (edge >= requiredEdge && adjustedConfidence >= 70) return 'NO'
  }

  // Log when tail guard specifically prevented a trade that would pass standard threshold
  if (isTailContract && edge >= minEdge && edge < requiredEdge) {
    console.log(`[tail-guard] skipped ${marketId || 'unknown'}: marketPrice=${marketPrice!.toFixed(3)} edge=${edge.toFixed(3)} < required ${requiredEdge.toFixed(3)}`)
  }

  return 'HOLD'
}

// ============================================================================
// Hours to Resolution
// ============================================================================

export function calculateHoursToResolution(resolutionTime: string): number {
  const resolution = new Date(resolutionTime).getTime()
  const now = Date.now()
  const diffMs = resolution - now
  return diffMs / (1000 * 60 * 60)
}

// ============================================================================
// Opportunity Calculation
// ============================================================================

export function calculateOpportunity(
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

    // Hard gate: skip all computation on extreme markets (≤10¢ and >50¢)
    // BMA-era Brier audit (568 trades, Mar 7-21):
    //   90-100¢ BSS=-1648, 50-70¢ BSS=-1.03, 70-90¢ BSS=-6.78, 0-10¢ BSS=-60
    //   Competitive range is 20-50¢ only. 45-50¢ is best sub-range (BSS -0.19, 63% win).
    if (midPrice <= 0.10 || midPrice > 0.50) {
      return null
    }

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

    // Generate signal with direction (uses decay-adjusted minEdge + tail guard)
    const signal = generateSignal(edge, probabilityResult.confidence, hoursToResolution, tradeDirection, minEdge, marketPrice, market.id)

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
// Main Computation
// ============================================================================

export interface ComputeOpportunitiesInput {
  ensemble: WeatherEnsemble | undefined | null
  markets: WeatherMarket[] | undefined | null
  cityCode: string
  forecastCityName?: string
  marketCityName?: string
  recommendedMinEdge: number
  biasCorrection: number
  shadowContexts: Record<string, ShadowContext> | null
  dynamicWeightsLiveEnabled: boolean
  dynamicWeightsShadowEnabled: boolean
}

export interface ComputeOpportunitiesResult {
  opportunities: WeatherOpportunity[]
  eventGroups: EventGroup[]
  totalMarketsCount: number
  allWithinBuffer: boolean
  forecastByEvent: Map<string, number>
  perSourceForecastsByEvent: Map<string, Record<string, number>>
}

const EMPTY_RESULT: ComputeOpportunitiesResult = {
  opportunities: [],
  eventGroups: [],
  totalMarketsCount: 0,
  allWithinBuffer: false,
  forecastByEvent: new Map(),
  perSourceForecastsByEvent: new Map(),
}

export function computeOpportunities(input: ComputeOpportunitiesInput): ComputeOpportunitiesResult {
  const {
    ensemble,
    markets,
    cityCode,
    forecastCityName,
    marketCityName,
    recommendedMinEdge,
    biasCorrection,
    shadowContexts,
    dynamicWeightsLiveEnabled,
    dynamicWeightsShadowEnabled,
  } = input

  if (!ensemble || !markets) {
    return EMPTY_RESULT
  }

  // Guard against stale cross-city data from SWR keepPreviousData
  if (isCrossCityStale(cityCode, forecastCityName, marketCityName)) {
    return EMPTY_RESULT
  }

  // Diagnostic: log when markets were fetched but all get filtered out
  if (markets.length === 0) {
    console.warn(`[opportunities] ${cityCode}: 0 markets returned from API`)
  }

  // Filter to markets resolving within 48 hours with sufficient liquidity
  // Compute hoursToResolution once per market and cache it to avoid clock-skew
  // between the filter pass and the opportunity loop.
  const MIN_VOLUME = 100   // Skip markets with <$100 volume
  const MAX_SPREAD = 0.15  // Skip markets with >15¢ bid-ask spread
  const hoursMap = new Map<string, number>()
  const relevantMarkets = markets.filter(market => {
    const hoursToResolution = calculateHoursToResolution(market.resolutionTime)
    if (hoursToResolution <= 0 || hoursToResolution > 48) return false

    // Skip illiquid markets (microstructure filter)
    if (market.volume != null && market.volume < MIN_VOLUME) return false
    if (market.spread != null && market.spread > MAX_SPREAD) return false

    hoursMap.set(market.id, hoursToResolution)
    return true
  })

  // Dynamic edge threshold from performance tracker
  const minEdge = recommendedMinEdge

  // Calculate opportunities for relevant markets
  const allOpps: WeatherOpportunity[] = []
  // Track events where the hard gate (≤10¢/>50¢) removed brackets.
  // These events have incomplete probability mass in their surviving brackets,
  // so normalization would inflate all survivors by 1/probSum — a systematic bias.
  const hardGatedEvents = new Set<string>()

  for (const market of relevantMarkets) {
    const hoursToResolution = hoursMap.get(market.id)!
    const isClosed = market.tradingStatus === 'closed'
    const inBuffer = !isTradingAllowed(hoursToResolution)

    // Detect hard-gated brackets before calling calculateOpportunity
    // so gate detection is independent of other null-return reasons
    const midPrice = market.currentPrice || 0
    if (midPrice <= 0.10 || midPrice > 0.50) {
      const eventKey = market.eventTicker || market.id
      hardGatedEvents.add(eventKey)
    }

    // For closed/buffer markets, still calculate opportunity but force HOLD
    // so they appear in event groups (visible in UI) without generating trade signals
    if (!isClosed && inBuffer) continue
    const shadowContext = pickShadowContext(shadowContexts, market, hoursToResolution)
    const opp = calculateOpportunity(
      market,
      ensemble,
      minEdge,
      biasCorrection,
      shadowContext,
      dynamicWeightsLiveEnabled,
      dynamicWeightsShadowEnabled
    )
    if (opp) {
      if (isClosed || inBuffer) opp.signal = 'HOLD'
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

    // Normalize ALL bracket probabilities (including above/below tails) to sum to 1.0
    // Each bracket's probability was computed independently and may not form a valid distribution
    if (brackets.length >= 2) {
      // Hard-gate takes precedence: when price-filtered brackets were removed from this event,
      // the probSum denominator is invalid (missing mass from gated tails).
      if (hardGatedEvents.has(eventTicker)) {
        console.log(`[normalization] skipped for ${eventTicker}: hard-gated brackets removed from partition`)
      } else {
        const probSum = brackets.reduce((s, b) => s + b.modelProbability, 0)
        const baselineSum = brackets.reduce((s, b) => s + (b.baselineModelProbability ?? 0), 0)
        const shadowSum = brackets.reduce((s, b) => s + (b.shadowModelProbability ?? 0), 0)
        // Only normalize when brackets form a substantially complete partition.
        // When Kalshi lists non-contiguous brackets (gaps in the temperature range),
        // probSum << 1.0 and normalization inflates all brackets by 1/probSum.
        // Threshold 0.85: complete partitions with 2-95% clamping sum to ~0.90-1.05.
        // Below 0.85, missing brackets hold too much mass for normalization to be safe.
        const NORMALIZATION_THRESHOLD = 0.85
        if (probSum >= NORMALIZATION_THRESHOLD && Math.abs(probSum - 1.0) > 0.01) {
          for (const b of brackets) {
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
            b.signal = generateSignal(b.edge, b.confidence, b.hoursToResolution, tradeDir, minEdge, b.marketPrice, b.market.id)
          }
        } else if (probSum < NORMALIZATION_THRESHOLD) {
          const ticker = brackets[0]?.market?.eventTicker || brackets[0]?.market?.id || 'unknown'
          console.log(`[normalization] skipped for ${ticker}: probSum=${probSum.toFixed(3)}, ${brackets.length} brackets (partition incomplete)`)
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
    const dateFiltered = filterEnsembleByDate(ensemble, firstBracket.market.resolutionTime)!
    // Use only forecast sources (exclude ground-truth observations like METAR)
    const forecastsOnly = dateFiltered.forecasts.filter(f => FORECAST_SOURCES.has(f.source))
    const weights = dateFiltered.activeWeights ?? DEFAULT_WEIGHTS
    let rawForecast: number
    // Per-source forecasts for accuracy tracking: use fail-closed date filter
    // to prevent wrong-day forecast temps from poisoning source_accuracy data.
    // Display path above can fall back to full ensemble, but logged data must not.
    const strictDateFiltered = filterEnsembleByDate(ensemble, firstBracket.market.resolutionTime, { failClosed: true, marketType: marketType === 'Low Temperature' ? 'low' : 'high' })
    const perSourceForecasts: Record<string, number> = {}
    if (strictDateFiltered) {
      const strictForecasts = strictDateFiltered.forecasts.filter(f => FORECAST_SOURCES.has(f.source))
      if (marketType === 'Low Temperature') {
        for (const f of strictForecasts) {
          if (typeof f.temperature.min === 'number' && !isNaN(f.temperature.min)) {
            perSourceForecasts[f.source] = celsiusToFahrenheit(f.temperature.min)
          }
        }
      } else {
        for (const f of strictForecasts) {
          if (typeof f.temperature.max === 'number' && !isNaN(f.temperature.max)) {
            perSourceForecasts[f.source] = celsiusToFahrenheit(f.temperature.max)
          }
        }
      }
    }
    if (marketType === 'Low Temperature') {
      const tempValues = forecastsOnly
        .filter(f => typeof f.temperature.min === 'number' && !isNaN(f.temperature.min))
        .map(f => ({ value: f.temperature.min, weight: weights[f.source] || 0.15, source: f.source }))
      const weightedMin = tempValues.length > 0
        ? tempValues.reduce((s, v) => s + v.value * v.weight, 0) / tempValues.reduce((s, v) => s + v.weight, 0)
        : dateFiltered.consensus.temperatureMean
      rawForecast = celsiusToFahrenheit(weightedMin)

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

    // Run disagreement detector on temperature events with per-source data
    const isTemperatureEvent = marketType === 'High Temperature' || marketType === 'Low Temperature'
    if (isTemperatureEvent && Object.keys(perSourceForecasts).length >= 2) {
      const detectorBrackets: EventBracket[] = brackets
        .filter(b => b.market.direction === 'between' && b.market.capStrike != null)
        .map(b => ({
          marketId: b.market.id,
          eventTicker: b.market.eventTicker || eventTicker,
          floor: b.market.threshold,
          cap: b.market.capStrike!,
          marketPrice: b.market.currentPrice || 0,
          yesAsk: b.market.yesAsk,
          volume: b.market.volume,
        }))

      if (detectorBrackets.length >= 5) {
        const tempType = marketType === 'Low Temperature' ? 'low' as const : 'high' as const
        const disagreements = detectDisagreements(
          perSourceForecasts,
          detectorBrackets,
          firstBracket.hoursToResolution,
          tempType,
        )

        // Attach disagreement signals to matching brackets
        for (const sig of disagreements) {
          const matchingBracket = brackets.find(b =>
            b.market.id === sig.marketId
          )
          if (matchingBracket) {
            matchingBracket.disagreementSignal = sig
          }
        }

        if (disagreements.length > 0) {
          console.log(
            `[disagreement-detector] ${cityCode} ${eventTicker}: delta=${disagreements[0].temperatureDelta.toFixed(1)}°F ` +
            `T_sources=${disagreements[0].sourceConsensusTemp.toFixed(1)} T_market=${disagreements[0].marketImpliedTemp.toFixed(1)} ` +
            `${disagreements.length} bracket(s) flagged`
          )
        }
      }
    }

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
    return m.tradingStatus === 'closed' || (hoursMap.get(m.id)! < 12)
  })

  if (relevantMarkets.length === 0 && markets.length > 0) {
    console.warn(`[opportunities] ${cityCode}: ${markets.length} markets fetched but 0 passed filters (48h window / volume / spread)`)
  }

  return { opportunities, eventGroups, totalMarketsCount, allWithinBuffer, forecastByEvent, perSourceForecastsByEvent }
}
