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
  THRESHOLD_WEIGHTS,
  FORECAST_SOURCES,
  applyCalibration,
} from '@/lib/models/weatherProbability'
import type { WeatherMarket, WeatherEnsemble, WeatherProbability } from '@/types/weather'
import { buildForecastDistribution } from '@/lib/models/forecastDistribution'
import type { ForecastDistribution } from '@/lib/models/forecastDistribution'
import { fahrenheitToCelsius, celsiusToFahrenheit } from '@/lib/utils/temperature'
import { getCityCoordinates } from '@/lib/utils/cityCoordinates'
import { formatWeatherDateLabel } from '@/lib/utils/dailyForecasts'
import { filterEnsembleByDate } from '@/lib/utils/ensembleDateFilter'

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
  marketPrice: number
  edge: number
  signal: 'STRONG_YES' | 'YES' | 'HOLD' | 'NO' | 'STRONG_NO'
  expectedValue: number
  confidence: number
  reasoning: string
  hoursToResolution: number
  isForecastBracket: boolean  // true if model forecast falls within this bracket
  uncalibratedProbability?: number
  calibrationModelId?: string
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
  forecastBracketExact: boolean        // true = forecast falls within bracket, false = nearest fallback
  hoursToResolution: number
}

// ============================================================================
// Tail Sell Types & Constants
// ============================================================================

/** NE corridor cities — correlated weather, capped at 5 simultaneous tail sells */
const NE_CORRIDOR_CITIES = new Set(['BOS', 'NY', 'NYC', 'PHI', 'PHIL', 'DC'])

/** Hard gate: cold-side only. Warm-side tail sells are never generated. */
const TAIL_SELL_DIRECTION = 'cold' as const

/** Minimum distance: bracket cap must be ≥ this many °F below forecast */
const TAIL_MIN_DISTANCE_F = 6.0  // 3 brackets at 2°F each

/** Minimum distance for threshold brackets: boundary must be ≥ this many °F below forecast */
const TAIL_THRESHOLD_MIN_DISTANCE_F = 3.0

/** YES price range for tail sells */
const TAIL_YES_MIN = 0.05
const TAIL_YES_MAX = 0.20

/** Lead time window */
const TAIL_LEAD_MIN_H = 12
const TAIL_LEAD_MAX_H = 48
const TAIL_LEAD_HIGH_MIN_H = 18   // high confidence lower bound (24 in spec, widened to 18)
const TAIL_LEAD_HIGH_MAX_H = 36   // high confidence upper bound

/** Source spread threshold — suppress when sources disagree wildly */
const TAIL_MAX_SPREAD_C = 3.0  // °C ≈ 5.4°F

/** Minimum source count */
const TAIL_MIN_SOURCES = 3

/** Stale ensemble guard — suppress if ensemble older than 2 hours */
const TAIL_MAX_ENSEMBLE_AGE_MS = 2 * 60 * 60 * 1000

// ============================================================================
// Threshold-Event City Blacklist (Item A 2026-04-08)
// ============================================================================

/**
 * Cities where threshold-bracket forecasts are unreliable — see Item A backfill 2026-04-08.
 * 429 NOAA-anchored rows quantified RMSE inflation on threshold events across all sources.
 * These cities exhibit RMSE and/or bias that make threshold-event signals uneconomic until
 * regime-dependent σ + μ corrections ship. Inner brackets (direction === 'between') are
 * unaffected and continue to trade normally.
 *
 * Citations (threshold subset, n=88 events):
 *   PHI/PHIL  RMSE 11.41°F  bias -6.20°F  (NE corridor cold bust)
 *   SEA       RMSE  9.60°F  bias -6.67°F  (marine advection bust)
 *   DC        RMSE  9.13°F  bias -4.23°F  (NE corridor cold bust)
 *   DEN       RMSE  7.29°F  bias +4.03°F  (lee cyclogenesis warm bust — 'below' only;
 *                                          'above' may be tradeable for future warm-side tail)
 *
 * Watch list — NOT blacklisted yet, revisit when Item B5 regime detection lands:
 *   NY        RMSE  8.95°F  bias -1.92°F  (NE corridor, borderline; smaller bias than DC)
 *   BOS       RMSE  4.84°F  bias -1.36°F  (NE corridor tail, much milder)
 * Principled cutoff belongs in regime gate, not blacklist.
 *
 * Removal criteria: either (a) regime-dependent fixes deploy AND backtest shows per-city
 * threshold BSS > 0, or (b) ≥30 post-fix clean threshold observations per city demonstrate
 * signal reliability.
 */
type ThresholdBlacklistEntry = {
  cities: string[]
  directions: Array<'above' | 'below'>
  reason: string
}

const THRESHOLD_EVENT_BLACKLIST: ThresholdBlacklistEntry[] = [
  {
    cities: ['PHI', 'PHIL', 'DC'],
    directions: ['above', 'below'],
    reason: 'NE corridor cold-bust regime, RMSE >9°F both directions (Item A 2026-04-08)',
  },
  {
    cities: ['SEA'],
    directions: ['above', 'below'],
    reason: 'Marine advection bust, RMSE 9.6°F bias -6.67°F (Item A 2026-04-08)',
  },
  {
    cities: ['DEN'],
    directions: ['below'],
    reason: 'Lee cyclogenesis warm bust amplifies cold-tail underforecasting; above-threshold may be tradeable (Item A 2026-04-08)',
  },
]

/**
 * True when a market's threshold-direction signal should be suppressed for the given city.
 * Returns false for inner brackets (`direction === 'between'`) and non-blacklisted cities.
 */
export function isThresholdSignalBlacklisted(
  cityCode: string,
  direction: 'above' | 'below' | 'between' | undefined,
): boolean {
  if (direction !== 'above' && direction !== 'below') return false
  return THRESHOLD_EVENT_BLACKLIST.some(
    entry => entry.cities.includes(cityCode) && entry.directions.includes(direction),
  )
}

// ============================================================================
// Low-Temperature Signal Generation Gate (Low-Temp Recon 2026-04-08)
// ============================================================================

/**
 * Low-temperature signal generation is globally disabled pending the
 * coordinated Item B deployment that will ship:
 *   - DEFAULT_WEIGHTS_LOW (empirical, regime-aware)
 *   - SIGMA_SOURCE_TABLE_LOW (empirical per source × lead)
 *   - marketType branching in computeWeights() and defaultForecastWeights()
 *   - Brier compression parameter refit (BRIER_TEMP_SCALE_F, MAE_EPSILON)
 *   - Per-market-type μ corrections for the shared warm-bias pattern
 *   - Low-temp calibration decision (identity model vs dedicated retrain)
 *
 * Data capture (source_accuracy, market_predictions, resolver) continues
 * normally — only signal emission is suppressed. This preserves all
 * diagnostic data needed by Item B while preventing any accidental trading
 * against the current broken infrastructure.
 *
 * Re-enablement should be STAGED across cities when the coordinated fix
 * ships — start with stable-climate cities (LV, MIA, ATL) and expand based
 * on post-fix observation quality. Do not flip to true for all cities
 * simultaneously.
 */
const LOW_TEMP_SIGNAL_GENERATION_ENABLED = false

/**
 * True when a low-temp signal should be suppressed entirely. Applies to both
 * inner brackets and threshold brackets. Returns false for high-temp markets
 * and for markets where marketType is undefined (rain/snow/other markets
 * traverse this path and must not be suppressed).
 */
export function isLowTempSignalBlacklisted(
  marketType: 'high' | 'low' | undefined,
): boolean {
  if (marketType !== 'low') return false
  return !LOW_TEMP_SIGNAL_GENERATION_ENABLED
}

export interface TailSellSignal {
  signalType: 'TAIL_SELL_NO'
  ticker: string                    // Kalshi market ticker
  eventTicker: string
  cityCode: string
  forecastF: number                 // point forecast at signal time
  bracketFloorF: number | null       // bracket lower bound (null for threshold brackets)
  bracketCapF: number               // bracket upper bound
  bracketDistance: number            // how many 2°F brackets from forecast (3, 4, 5, etc.)
  direction: 'cold'
  yesPrice: number                  // market YES price (what we collect on win)
  noSellPrice: number               // 1 - yesPrice (our exposure on loss)
  expectedProfit: number            // yesPrice * (1 - fee) per contract on win
  leadHours: number
  spreadF: number                   // inter-source spread in °F
  confidence: 'high' | 'medium'    // high = 18-36h, medium = 12-18h or 36-48h
  sourceCount: number
  temperatureType: 'high'           // only high-temp markets
  perSourceForecastsF: Record<string, number>  // source → bias-corrected forecast °F at signal time (forensic)
  timestamp: number
}

/**
 * Generate tail sell signals for cold-side brackets far below the forecast.
 *
 * Separate from generateSignal() — tail sells are distance-based, not edge-based.
 * One signal per qualifying bracket per event.
 */
export function generateTailSellSignals(
  distribution: ForecastDistribution,
  markets: WeatherMarket[],
  leadHours: number,
  cityCode: string,
  ensembleTimestamp: number,
): TailSellSignal[] {
  const signals: TailSellSignal[] = []

  // ── Safety guards (suppress all signals if any fail) ──

  // Stale ensemble guard
  if (Date.now() - ensembleTimestamp > TAIL_MAX_ENSEMBLE_AGE_MS) {
    return signals
  }

  // Minimum source count
  if (distribution.sourceCount < TAIL_MIN_SOURCES) {
    return signals
  }

  // Extreme spread guard (sources disagree by > 5.4°F)
  if (distribution.spreadC > TAIL_MAX_SPREAD_C) {
    return signals
  }

  // Lead time window
  if (leadHours < TAIL_LEAD_MIN_H || leadHours > TAIL_LEAD_MAX_H) {
    return signals
  }

  // High-temp only — low-temp cold bias data doesn't exist
  if (distribution.temperatureType !== 'high') {
    return signals
  }

  const forecastF = distribution.pointForecastF
  const confidence: 'high' | 'medium' =
    (leadHours >= TAIL_LEAD_HIGH_MIN_H && leadHours <= TAIL_LEAD_HIGH_MAX_H)
      ? 'high'
      : 'medium'

  const spreadF = distribution.spreadC * 9 / 5

  for (const market of markets) {
    // === Between-type inner brackets ===
    if (market.direction === 'between') {
      if (market.capStrike == null || market.threshold == null) continue

      // COLD-SIDE ONLY: bracket's upper boundary must be below forecast - 6°F
      // This means the entire bracket is at least 3 brackets (6°F) below the point forecast
      if (market.capStrike >= forecastF - TAIL_MIN_DISTANCE_F) continue

      // Market must be open and tradeable
      if (market.tradingStatus === 'closed') continue
      if (market.status !== 'active') continue

      // YES price range: 5-20¢
      const yesPrice = market.currentPrice ?? 0
      if (yesPrice < TAIL_YES_MIN || yesPrice > TAIL_YES_MAX) continue

      // Minimum volume check (same as main pipeline)
      if (market.volume != null && market.volume < 100) continue

      // Compute bracket distance in 2°F units
      const bracketMidF = (market.threshold + market.capStrike) / 2
      const bracketDistance = Math.round((forecastF - bracketMidF) / 2)

      signals.push({
        signalType: 'TAIL_SELL_NO',
        ticker: market.id,
        eventTicker: market.eventTicker || '',
        cityCode,
        forecastF,
        bracketFloorF: market.threshold,
        bracketCapF: market.capStrike,
        bracketDistance,
        direction: TAIL_SELL_DIRECTION,
        yesPrice,
        noSellPrice: 1 - yesPrice,
        expectedProfit: yesPrice * (1 - DEFAULT_FEE_RATE),
        leadHours,
        spreadF,
        confidence,
        sourceCount: distribution.sourceCount,
        temperatureType: 'high',
        perSourceForecastsF: { ...distribution.perSourceForecastsF },
        timestamp: Date.now(),
      })
    }
    // === Cold-side threshold brackets ("below X°F") ===
    else if (market.direction === 'below') {
      // Item A 2026-04-08: suppress threshold tail-sell signals in blacklisted cities.
      if (isThresholdSignalBlacklisted(cityCode, 'below')) continue

      // threshold = boundary temperature (Kalshi's cap_strike)
      if (market.threshold == null) continue

      // Distance: forecast must be ≥ TAIL_THRESHOLD_MIN_DISTANCE_F above the boundary
      const distanceF = forecastF - market.threshold
      if (distanceF < TAIL_THRESHOLD_MIN_DISTANCE_F) continue

      // Market must be open and tradeable
      if (market.tradingStatus === 'closed') continue
      if (market.status !== 'active') continue

      // YES price range: 5-20¢
      const yesPrice = market.currentPrice ?? 0
      if (yesPrice < TAIL_YES_MIN || yesPrice > TAIL_YES_MAX) continue

      // Minimum volume check (same as main pipeline)
      if (market.volume != null && market.volume < 100) continue

      // Distance in bracket units (2°F each), rounded up
      const bracketDistance = Math.ceil(distanceF / 2)

      signals.push({
        signalType: 'TAIL_SELL_NO',
        ticker: market.id,
        eventTicker: market.eventTicker || '',
        cityCode,
        forecastF,
        bracketFloorF: null,                    // open-ended below
        bracketCapF: market.threshold,          // boundary temperature
        bracketDistance,
        direction: TAIL_SELL_DIRECTION,
        yesPrice,
        noSellPrice: 1 - yesPrice,
        expectedProfit: yesPrice * (1 - DEFAULT_FEE_RATE),
        leadHours,
        spreadF,
        confidence,
        sourceCount: distribution.sourceCount,
        temperatureType: 'high',
        perSourceForecastsF: { ...distribution.perSourceForecastsF },
        timestamp: Date.now(),
      })
    }
  }

  // Sort by bracket distance ascending (closest tail first)
  signals.sort((a, b) => a.bracketDistance - b.bracketDistance)

  return signals
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
// Only competitive range is 20-40¢ (BSS ~ -0.15, 71% NO win rate).
// YES signals KILLED until BMA Phase 2 fixes the probability model.
const YES_SIGNALS_ENABLED = false   // MORATORIUM: 0/56 STRONG_YES wins, inverted confidence above 40%
const TAIL_MARKET_THRESHOLD = 0.20  // Only trade markets priced 20-40¢
const TAIL_UPPER_THRESHOLD = 0.40   // Competitive range ceiling — 40-50¢ BSS=-0.65 (coin flip)
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
  distribution?: ForecastDistribution
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
    let probabilityResult: WeatherProbability | null = null

    let shadowModelProbability: number | undefined

    if (distribution && isTemp) {
      // ── Distribution path (primary for temperature) ──
      let rawP: number | undefined
      if (market.direction === 'between' && market.capStrike != null && market.threshold !== undefined) {
        rawP = distribution.pBracket(fahrenheitToCelsius(market.threshold), fahrenheitToCelsius(market.capStrike))
      } else if (market.threshold !== undefined && (market.direction === 'above' || market.direction === 'below')) {
        rawP = market.direction === 'above'
          ? distribution.pAbove(fahrenheitToCelsius(market.threshold))
          : distribution.pBelow(fahrenheitToCelsius(market.threshold))
      }
      if (rawP != null) {
        let calibrated = rawP
        let calibrationModelId = 'none'

        // Only apply calibration to inner brackets (direction === 'between').
        // Calibration was trained on inner bracket probabilities (raw 0.02-0.14).
        // Threshold brackets (above/below) produce raw probs in 0.15-0.30 range,
        // outside the training data — calibration extrapolation inflates them.
        if (market.direction === 'between') {
          const cal = applyCalibration(rawP, {
            marketType: market.temperatureType === 'low' ? 'temperature-low' : 'temperature-high',
            hoursToResolution: dateFiltered.hoursToResolution ?? 36,
          })
          calibrated = cal.calibrated
          calibrationModelId = cal.modelId
        }

        probabilityResult = {
          outcome: `temperature ${market.direction} ${market.threshold}°F`,
          probability: Math.min(Math.max(calibrated, 0.02), 0.95),
          confidence: dateFiltered.consensus.modelAgreement,
          sources: dateFiltered.forecasts,
          calculatedAt: Date.now(),
          reasoning: `BMA-dist: ${distribution.sourceCount} sources (forecast: ${distribution.pointForecastF.toFixed(1)}°F, spread: ${(distribution.spreadC * 9 / 5).toFixed(1)}°F)`,
          uncalibratedProbability: rawP,
          calibrationModelId,
        }
      }
      // Dynamic weights shadow: still uses old functions (proven identical to distribution)
      if (shadowContext?.context?.weights) {
        const shadowWeights = toEnsembleWeights(shadowContext.context.weights)
        if (market.direction === 'between' && market.capStrike != null && market.threshold !== undefined) {
          const shadowResult = calculateBracketProbability(
            dateFiltered,
            fahrenheitToCelsius(market.threshold),
            fahrenheitToCelsius(market.capStrike),
            market.temperatureType,
            biasCorrectionC,
            shadowWeights
          )
          shadowModelProbability = shadowResult.probability
        } else if (market.threshold !== undefined && (market.direction === 'above' || market.direction === 'below')) {
          const shadowResult = calculateTemperatureProbability(
            dateFiltered,
            fahrenheitToCelsius(market.threshold),
            market.direction,
            market.temperatureType,
            biasCorrectionC,
            shadowWeights,
            true // skipCalibration — threshold brackets outside training domain
          )
          shadowModelProbability = shadowResult.probability
        }
      }
    } else if (isTemp && market.direction === 'between' && market.capStrike != null && market.threshold !== undefined) {
      // ── Fallback: temperature without distribution (edge case) ──
      const floorC = fahrenheitToCelsius(market.threshold)
      const capC = fahrenheitToCelsius(market.capStrike)
      probabilityResult = calculateBracketProbability(dateFiltered, floorC, capC, market.temperatureType, biasCorrectionC)

      if (shadowContext?.context?.weights) {
        const shadowWeights = toEnsembleWeights(shadowContext.context.weights)
        const shadowResult = calculateBracketProbability(
          dateFiltered, floorC, capC, market.temperatureType, biasCorrectionC, shadowWeights
        )
        shadowModelProbability = shadowResult.probability
      }
    } else if (isTemp && market.threshold !== undefined && market.direction && (market.direction === 'above' || market.direction === 'below')) {
      // ── Fallback: temperature above/below without distribution ──
      const thresholdC = fahrenheitToCelsius(market.threshold)
      probabilityResult = calculateTemperatureProbability(dateFiltered, thresholdC, market.direction, market.temperatureType, biasCorrectionC, undefined, true)

      if (shadowContext?.context?.weights) {
        const shadowWeights = toEnsembleWeights(shadowContext.context.weights)
        const shadowResult = calculateTemperatureProbability(
          dateFiltered, thresholdC, market.direction, market.temperatureType, biasCorrectionC, shadowWeights, true
        )
        shadowModelProbability = shadowResult.probability
      }
    } else if (isPrecip && market.direction === 'between' && market.capStrike != null && market.threshold !== undefined) {
      // ── Precipitation bracket (UNCHANGED) ──
      probabilityResult = calculatePrecipitationBracketProbability(dateFiltered, market.threshold, market.capStrike)
    } else if (market.threshold !== undefined) {
      // ── Precipitation threshold (UNCHANGED) ──
      probabilityResult = calculatePrecipitationProbability(dateFiltered, market.threshold)
    }

    if (!probabilityResult) return null

    const uncalibratedProbability = probabilityResult.uncalibratedProbability ?? probabilityResult.probability
    const calibrationModelId = probabilityResult.calibrationModelId

    let modelProbability = probabilityResult.probability
    if (shadowModelProbability != null && dynamicWeightsLiveEnabled) {
      modelProbability = shadowModelProbability
    }
    const midPrice = market.currentPrice || 0

    // Hard gate: skip all computation on extreme markets (≤10¢ and >40¢)
    // Clean-era audit (189 trades, Mar 21-24):
    //   30-40¢: BSS -0.15, 71% NO win — competitive
    //   40-50¢: BSS -0.65, 52% NO win — coin flip, destroying value
    //   Upper gate tightened from 50¢ to 40¢ (2026-03-24)
    if (midPrice <= 0.10 || midPrice > 0.40) {
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
      marketPrice,
      edge,
      signal,
      expectedValue: ev,
      confidence: probabilityResult.confidence,
      reasoning: probabilityResult.reasoning || '',
      hoursToResolution,
      isForecastBracket: false,
      uncalibratedProbability,
      calibrationModelId,
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
}

export interface ComputeOpportunitiesResult {
  opportunities: WeatherOpportunity[]
  eventGroups: EventGroup[]
  tailSellSignals: TailSellSignal[]
  totalMarketsCount: number
  allWithinBuffer: boolean
  forecastByEvent: Map<string, number>
  perSourceForecastsByEvent: Map<string, Record<string, number>>
}

const EMPTY_RESULT: ComputeOpportunitiesResult = {
  opportunities: [],
  eventGroups: [],
  tailSellSignals: [],
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

  // Pre-build ForecastDistribution per event (one distribution serves all
  // brackets in the same event). Primary path for temperature markets.
  const biasCorrectionC = biasCorrection * (5 / 9)
  const distributionByEvent = new Map<string, ForecastDistribution>()
  const thresholdDistributionByEvent = new Map<string, ForecastDistribution>()
  {
    const eventMarketGroups = new Map<string, WeatherMarket[]>()
    for (const market of relevantMarkets) {
      const key = market.eventTicker || market.id
      if (!eventMarketGroups.has(key)) eventMarketGroups.set(key, [])
      eventMarketGroups.get(key)!.push(market)
    }
    for (const [eventKey, eventMarkets] of eventMarketGroups) {
      const rep = eventMarkets[0]
      const isTemp = rep.outcome.includes('°F') || rep.outcome.includes('temperature')
      if (!isTemp) continue
      const temperatureType: 'high' | 'low' = rep.temperatureType === 'low' ? 'low' : 'high'
      const dateFiltered = filterEnsembleByDate(ensemble, rep.resolutionTime, {
        failClosed: true,
        marketType: temperatureType,
      })
      if (!dateFiltered) continue
      dateFiltered.hoursToResolution = calculateHoursToResolution(rep.resolutionTime)

      // Inner distribution (DEFAULT_WEIGHTS, inner regime σ)
      const dist = buildForecastDistribution({
        ensemble: dateFiltered,
        temperatureType,
        biasCorrection: biasCorrectionC,
        cityCode,
        date: rep.resolutionTime,
        bracketRegime: 'inner',
      })
      if (dist) distributionByEvent.set(eventKey, dist)

      // Threshold distribution: uniform weights + threshold regime σ
      // Only built when the event contains threshold brackets (above/below direction)
      const hasThreshold = eventMarkets.some(m => m.direction === 'above' || m.direction === 'below')
      if (hasThreshold) {
        const threshDist = buildForecastDistribution({
          ensemble: dateFiltered,
          temperatureType,
          biasCorrection: biasCorrectionC,
          cityCode,
          date: rep.resolutionTime,
          weightsOverride: THRESHOLD_WEIGHTS,
          bracketRegime: 'threshold',
        })
        if (threshDist) thresholdDistributionByEvent.set(eventKey, threshDist)
      }
    }
  }

  for (const market of relevantMarkets) {
    const hoursToResolution = hoursMap.get(market.id)!
    const eventKey = market.eventTicker || market.id
    const isClosed = market.tradingStatus === 'closed'
    const inBuffer = !isTradingAllowed(hoursToResolution)

    // For closed/buffer markets, still calculate opportunity but force HOLD
    // so they appear in event groups (visible in UI) without generating trade signals
    if (!isClosed && inBuffer) continue
    const shadowContext = pickShadowContext(shadowContexts, market, hoursToResolution)
    // Item B Phase 1: threshold brackets use separate distribution with uniform weights + threshold σ
    const isThresholdBracket = market.direction === 'above' || market.direction === 'below'
    const distribution = isThresholdBracket
      ? thresholdDistributionByEvent.get(eventKey)
      : distributionByEvent.get(eventKey)
    const opp = calculateOpportunity(
      market,
      ensemble,
      minEdge,
      biasCorrection,
      shadowContext,
      dynamicWeightsLiveEnabled,
      distribution
    )
    if (opp) {
      if (isClosed || inBuffer) opp.signal = 'HOLD'
      // Item A 2026-04-08: suppress threshold-bracket trade signals in blacklisted cities.
      // The opportunity is kept for UI display but cannot generate a trade.
      if (isThresholdSignalBlacklisted(cityCode, opp.market.direction)) {
        opp.signal = 'HOLD'
      }
      // Low-Temp Recon 2026-04-08: suppress ALL low-temp signals globally
      // pending the coordinated Item B deployment. Data capture continues
      // normally upstream; only the emitted signal is forced to HOLD.
      if (isLowTempSignalBlacklisted(opp.market.temperatureType)) {
        opp.signal = 'HOLD'
      }
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
    // When a ForecastDistribution exists, use its consistent point forecast and per-source data.
    // Otherwise fall back to ensemble-based computation.
    const eventDist = distributionByEvent.get(eventTicker)
    let rawForecast: number
    let perSourceForecasts: Record<string, number> = {}

    if (eventDist) {
      // Distribution path: point forecast and per-source data are derived from the same
      // BMA mixture, guaranteeing consistency between displayed forecast and bracket probs.
      rawForecast = eventDist.rawPointForecastF
      perSourceForecasts = { ...eventDist.perSourceForecastsF }
    } else {
      // Fallback: compute from ensemble directly
      // Display path: no failClosed — falls back to full ensemble (never null)
      const dateFiltered = filterEnsembleByDate(ensemble, firstBracket.market.resolutionTime)!
      const forecastsOnly = dateFiltered.forecasts.filter(f => FORECAST_SOURCES.has(f.source))
      const weights = dateFiltered.activeWeights ?? DEFAULT_WEIGHTS
      // Per-source forecasts for accuracy tracking: use fail-closed date filter
      // to prevent wrong-day forecast temps from poisoning source_accuracy data.
      const strictDateFiltered = filterEnsembleByDate(ensemble, firstBracket.market.resolutionTime, { failClosed: true, marketType: marketType === 'Low Temperature' ? 'low' : 'high' })
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

        console.debug(
          `[Forecast] ${cityCode} ${marketType}:`,
          tempValues.map(v => `${v.source}=${celsiusToFahrenheit(v.value).toFixed(1)}°F (w=${v.weight})`).join(', '),
          `→ weighted=${rawForecast.toFixed(1)}°F`
        )
      }
    }

    // Apply bias correction to a separate display variable
    // rawForecast is logged as forecastTemp (for unbiased bias tracking)
    // displayForecast is used for UI display and bracket identification
    const displayForecast = eventDist ? eventDist.pointForecastF : rawForecast + biasCorrection

    // Identify which bracket contains the display forecast (bias-corrected)
    let forecastBracketIndex: number | null = null
    let forecastBracketExact = false
    for (let i = 0; i < brackets.length; i++) {
      const b = brackets[i]
      if (
        b.market.direction === 'between' &&
        b.market.capStrike != null &&
        displayForecast >= b.market.threshold &&
        displayForecast < b.market.capStrike
      ) {
        forecastBracketIndex = i
        forecastBracketExact = true
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

    // Forecast-consistency check: warn when peak probability bracket doesn't contain
    // the model forecast. Only meaningful when the forecast bracket was an exact match —
    // sparse brackets (forecastBracketExact=false) are expected to not contain the forecast.
    if (brackets.length >= 2 && forecastBracketExact) {
      let peakIdx = 0
      for (let i = 1; i < brackets.length; i++) {
        if (brackets[i].modelProbability > brackets[peakIdx].modelProbability) {
          peakIdx = i
        }
      }
      const peak = brackets[peakIdx]
      if (peak.market.direction === 'between' && peak.market.capStrike != null) {
        const forecastInPeak = displayForecast >= peak.market.threshold && displayForecast < peak.market.capStrike
        if (!forecastInPeak) {
          console.log(
            `[forecast-consistency] WARNING: peak bracket [${peak.market.threshold}-${peak.market.capStrike}°F] ` +
            `does not contain model forecast [${displayForecast.toFixed(1)}°F] for ${eventTicker}`
          )
        }
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
      forecastBracketExact,
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

  // ── Tail Sell Signal Generation ──
  // Runs per-event alongside existing opportunities. Uses the same distributions
  // already built above. Tail sells target cold-side brackets far from forecast
  // that the existing pipeline skips (≤10¢ hard gate).
  const tailSellSignals: TailSellSignal[] = []
  const ensembleTimestamp = ensemble.timestamp ?? Date.now()
  for (const [eventKey, dist] of distributionByEvent) {
    // Collect all relevant markets for this event
    const eventMarkets = relevantMarkets.filter(
      m => (m.eventTicker || m.id) === eventKey
    )
    if (eventMarkets.length === 0) continue

    const leadHours = hoursMap.get(eventMarkets[0].id) ?? 0
    const eventTailSignals = generateTailSellSignals(
      dist,
      eventMarkets,
      leadHours,
      cityCode,
      ensembleTimestamp,
    )
    tailSellSignals.push(...eventTailSignals)
  }

  if (tailSellSignals.length > 0) {
    console.log(
      `[tail-sell] ${cityCode}: ${tailSellSignals.length} signal(s) — ` +
      tailSellSignals.map(s => `${s.ticker} ±${s.bracketDistance} YES=${(s.yesPrice * 100).toFixed(0)}¢`).join(', ')
    )
  }

  return { opportunities, eventGroups, tailSellSignals, totalMarketsCount, allWithinBuffer, forecastByEvent, perSourceForecastsByEvent }
}
