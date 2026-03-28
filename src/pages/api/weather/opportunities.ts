// Server-side opportunity computation endpoint
// Replaces client-side useWeatherOpportunities useMemo with cached server computation
//
// GET /api/weather/opportunities?city={code}
// Returns pre-computed opportunities with L1+L2 caching (300s TTL, market-aligned)

import type { NextApiRequest, NextApiResponse } from 'next'
import { getCityCoordinates } from '@/lib/utils/cityCoordinates'
import { getCityBias } from '@/lib/models/temperatureBias'
import { getPerformanceSnapshot, logSignal } from '@/lib/models/performanceTracker'
import type { SignalRecord } from '@/lib/models/performanceTracker'
import { getCityWeightContexts } from '@/lib/models/sourceAccuracy'
import { getForecastsForCity } from '@/pages/api/weather/forecasts'
import { getMarketsForCity } from '@/pages/api/kalshi/markets'
import {
  computeOpportunities,
  type ComputeOpportunitiesResult,
  type ShadowContext,
  type BiasInfo,
} from '@/lib/computeOpportunities'
import {
  isDynamicWeightsLiveEnabledForCity,
  isDynamicWeightsShadowModeEnabled,
  shouldFetchDynamicWeightContexts,
} from '@/lib/utils/dynamicWeightsRouting'
import { rget, rset } from '@/lib/cache/redis'
import { ensureCalibrationLoaded } from '@/lib/models/calibrationLoader'

// ============================================================================
// Types
// ============================================================================

interface OpportunitiesApiResponse {
  success: boolean
  data?: {
    opportunities: ComputeOpportunitiesResult['opportunities']
    eventGroups: ComputeOpportunitiesResult['eventGroups']
    totalMarketsCount: number
    allWithinBuffer: boolean
    biasInfo: BiasInfo | null
    cityCode: string
    cityName: string
    // Maps serialized as objects for JSON transport
    forecastByEvent: Record<string, number>
    perSourceForecastsByEvent: Record<string, Record<string, number>>
  }
  error?: string
  cached?: boolean
  timestamp: number
}

// ============================================================================
// In-Memory Cache (L1)
// ============================================================================

interface CacheEntry {
  data: OpportunitiesApiResponse
  timestamp: number
}

const opportunitiesCache = new Map<string, CacheEntry>()
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes (market-aligned)
const CACHE_MAX_SIZE = 50

const REDIS_PREFIX = 'opportunities:'
const REDIS_TTL_S = 300

async function getCached(key: string): Promise<OpportunitiesApiResponse | null> {
  const entry = opportunitiesCache.get(key)
  if (entry && Date.now() - entry.timestamp <= CACHE_TTL) {
    return { ...entry.data, cached: true }
  }

  const redisData = await rget<OpportunitiesApiResponse>(REDIS_PREFIX + key)
  if (redisData) {
    opportunitiesCache.set(key, { data: redisData, timestamp: Date.now() })
    return { ...redisData, cached: true }
  }

  if (entry) opportunitiesCache.delete(key)
  return null
}

async function setCache(key: string, data: OpportunitiesApiResponse): Promise<void> {
  if (opportunitiesCache.size >= CACHE_MAX_SIZE) {
    const oldestKey = opportunitiesCache.keys().next().value
    if (oldestKey) opportunitiesCache.delete(oldestKey)
  }

  opportunitiesCache.set(key, { data, timestamp: Date.now() })
  await rset(REDIS_PREFIX + key, data, REDIS_TTL_S)
}

// ============================================================================
// Bias Correction (mirrors bias.ts handler logic)
// ============================================================================

const MIN_EFFECTIVE_N = 30
const MAX_CORRECTION_F = 5
const CORRECTION_GAIN = 0.5

async function getBiasForCity(cityCode: string): Promise<{ biasInfo: BiasInfo | null; correction: number }> {
  try {
    const bias = await getCityBias(cityCode)
    if (!bias) return { biasInfo: null, correction: 0 }

    const isActive = bias.effectiveSampleSize >= MIN_EFFECTIVE_N
    const rawCorrection = isActive ? -CORRECTION_GAIN * bias.meanError : 0
    const correction = isActive
      ? Math.max(-MAX_CORRECTION_F, Math.min(MAX_CORRECTION_F, rawCorrection))
      : 0
    const capped = isActive && Math.abs(correction) >= MAX_CORRECTION_F

    return {
      biasInfo: {
        meanError: bias.meanError,
        sampleCount: bias.sampleCount,
        lastUpdated: bias.lastUpdated,
        correction,
        isActive,
        capped,
        minSamples: MIN_EFFECTIVE_N,
        effectiveSampleSize: bias.effectiveSampleSize,
      },
      correction,
    }
  } catch (err) {
    console.warn(`[opportunities] bias fetch failed for ${cityCode}:`, err)
    return { biasInfo: null, correction: 0 }
  }
}

// ============================================================================
// Signal Logging (server-side, replaces browser fire-and-forget POSTs)
// ============================================================================

async function logOpportunitySignals(
  result: ComputeOpportunitiesResult,
  cityCode: string,
  cityName: string,
): Promise<void> {
  const { opportunities, eventGroups, forecastByEvent, perSourceForecastsByEvent } = result

  // Log model signals (non-HOLD only)
  for (const opp of opportunities) {
    if (opp.signal === 'HOLD') continue

    const eventTicker = opp.market.eventTicker || opp.market.id
    const srcForecasts = perSourceForecastsByEvent.get(eventTicker)

    const record: Omit<SignalRecord, 'id'> = {
      marketId: opp.market.id,
      timestamp: Date.now(),
      modelProbability: opp.modelProbability,
      marketPrice: opp.marketPrice,
      edge: opp.edge,
      direction: opp.modelProbability > opp.marketPrice ? 'YES' : 'NO',
      signal: opp.signal,
      cityCode,
      forecastTemp: forecastByEvent.get(eventTicker),
      hoursToResolution: opp.hoursToResolution,
      temperatureType: opp.market.temperatureType,
      rawModelProbability: opp.uncalibratedProbability ?? opp.baselineModelProbability ?? opp.modelProbability,
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
      calibrationModelId: opp.calibrationModelId,
      perSourceForecasts: (srcForecasts && Object.keys(srcForecasts).length > 0) ? srcForecasts : undefined,
      forecastCityName: cityName,
    }

    logSignal(record).catch(err => {
      console.warn(`[opportunities] signal log failed for ${opp.market.id}:`, err)
    })
  }

  // Log disagreement detector signals
  for (const group of eventGroups) {
    for (const bracket of group.brackets) {
      if (!bracket.disagreementSignal) continue
      const sig = bracket.disagreementSignal

      const record: Omit<SignalRecord, 'id'> = {
        marketId: sig.marketId,
        timestamp: Date.now(),
        modelProbability: sig.sourceBracketProb,
        marketPrice: sig.marketPrice,
        edge: sig.edge,
        direction: 'YES',
        signal: sig.isPrimary ? 'YES' : 'HOLD',
        signalSource: 'disagreement-detector',
        cityCode,
        forecastTemp: sig.sourceConsensusTemp,
        hoursToResolution: sig.hoursToResolution,
        temperatureType: bracket.market.temperatureType,
        perSourceForecasts: sig.sources,
        forecastCityName: cityName,
      }

      logSignal(record).catch(err => {
        console.warn(`[opportunities] disagreement log failed for ${sig.marketId}:`, err)
      })
    }
  }
}

// ============================================================================
// Core: Compute Opportunities for a City
// ============================================================================

/**
 * Compute opportunities for a city with L1+L2 caching.
 * Callable from API handler and warmup.
 */
export async function getOpportunitiesForCity(
  cityCode: string,
  options?: { bypassCache?: boolean }
): Promise<OpportunitiesApiResponse> {
  // Ensure calibration model is loaded in THIS module instance (not instrumentation's)
  await ensureCalibrationLoaded()

  const cacheKey = cityCode

  // Check cache
  if (!options?.bypassCache) {
    const cached = await getCached(cacheKey)
    if (cached) return cached
  }

  const city = getCityCoordinates(cityCode)
  if (!city) {
    return {
      success: false,
      error: `Unknown city code: ${cityCode}`,
      timestamp: Date.now(),
    }
  }

  // Fetch all inputs in parallel
  const [forecastsResponse, marketsResponse, biasResult, snapshot, shadowContexts] = await Promise.all([
    getForecastsForCity(cityCode),
    getMarketsForCity(cityCode),
    getBiasForCity(cityCode),
    getPerformanceSnapshot().catch(() => null),
    shouldFetchDynamicWeightContexts(cityCode)
      ? getCityWeightContexts(cityCode).catch(() => null)
      : Promise.resolve(null),
  ])

  // Validate inputs
  if (!forecastsResponse.success || !forecastsResponse.data) {
    return {
      success: false,
      error: forecastsResponse.error || 'Failed to fetch forecasts',
      timestamp: Date.now(),
    }
  }

  const ensemble = forecastsResponse.data.ensemble
  const markets = marketsResponse.data?.markets ?? []
  const recommendedMinEdge = snapshot?.recommendedMinEdge ?? 0.15

  // Guard: 0 markets is almost always a transient rate-limit failure, not reality.
  // Return without caching so the next request retries.
  if (markets.length === 0) {
    console.warn(`[opportunities] ${cityCode}: 0 markets returned from API`)
    return {
      success: true,
      data: {
        opportunities: [],
        eventGroups: [],
        totalMarketsCount: 0,
        allWithinBuffer: false,
        biasInfo: biasResult.biasInfo,
        cityCode,
        cityName: city.name,
        forecastByEvent: {},
        perSourceForecastsByEvent: {},
      },
      timestamp: Date.now(),
      // NOT cached — will retry on next request
    }
  }

  const dynamicWeightsLiveEnabled = isDynamicWeightsLiveEnabledForCity(cityCode)
  const dynamicWeightsShadowEnabled = isDynamicWeightsShadowModeEnabled()

  // Run computation
  const result = computeOpportunities({
    ensemble,
    markets,
    cityCode,
    // No cross-city guard needed server-side — we fetched fresh data for this city
    forecastCityName: undefined,
    marketCityName: undefined,
    recommendedMinEdge,
    biasCorrection: biasResult.correction,
    shadowContexts: shadowContexts as Record<string, ShadowContext> | null,
    dynamicWeightsLiveEnabled,
    dynamicWeightsShadowEnabled,
  })

  // Log signals (fire-and-forget, non-blocking)
  logOpportunitySignals(result, cityCode, city.name).catch(err => {
    console.warn(`[opportunities] signal logging failed for ${cityCode}:`, err)
  })

  // Serialize Maps to plain objects for JSON
  const forecastByEvent: Record<string, number> = {}
  for (const [k, v] of result.forecastByEvent) forecastByEvent[k] = v
  const perSourceForecastsByEvent: Record<string, Record<string, number>> = {}
  for (const [k, v] of result.perSourceForecastsByEvent) perSourceForecastsByEvent[k] = v

  const response: OpportunitiesApiResponse = {
    success: true,
    data: {
      opportunities: result.opportunities,
      eventGroups: result.eventGroups,
      totalMarketsCount: result.totalMarketsCount,
      allWithinBuffer: result.allWithinBuffer,
      biasInfo: biasResult.biasInfo,
      cityCode,
      cityName: city.name,
      forecastByEvent,
      perSourceForecastsByEvent,
    },
    timestamp: Date.now(),
  }

  await setCache(cacheKey, response)
  return response
}

// ============================================================================
// API Handler
// ============================================================================

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<OpportunitiesApiResponse>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed',
      timestamp: Date.now(),
    })
  }

  try {
    const { city: cityCode, bypassCache } = req.query

    if (!cityCode || typeof cityCode !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Missing or invalid city parameter. Expected city code (e.g., NY, CHI, LA)',
        timestamp: Date.now(),
      })
    }

    const response = await getOpportunitiesForCity(cityCode, { bypassCache: !!bypassCache })
    return res.status(response.success ? 200 : 500).json(response)

  } catch (error) {
    console.error('[opportunities] API error:', error)
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
      timestamp: Date.now(),
    })
  }
}
