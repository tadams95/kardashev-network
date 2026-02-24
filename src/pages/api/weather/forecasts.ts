// Real-time weather forecasts API
// Aggregates 6 sources (Open-Meteo, Google Weather, METAR, NWS, AccuWeather, Tomorrow.io) with consensus engine

import type { NextApiRequest, NextApiResponse } from 'next'
import { fetchWeatherForecast } from '@/lib/api/openMeteo'
import { fetchGoogleWeather } from '@/lib/api/googleWeather'
import { fetchMETARByCity } from '@/lib/api/metar'
import { fetchNWSForecast } from '@/lib/api/nws'
import { fetchAccuWeather } from '@/lib/api/accuweather'
import { fetchTomorrowWeather } from '@/lib/api/tomorrow'
import { buildEnsemble } from '@/lib/models/weatherProbability'
import { getCityCoordinates } from '@/lib/utils/cityCoordinates'
import type { WeatherEnsemble } from '@/types/weather'
import type { CityCoordinates } from '@/lib/utils/cityCoordinates'
import { rget, rset } from '@/lib/cache/redis'

// ============================================================================
// Types
// ============================================================================

interface ForecastsApiResponse {
  success: boolean
  data?: {
    ensemble: WeatherEnsemble
    city: CityCoordinates
    freshness: {
      'Open-Meteo': number
      'Google-Weather': number
      'METAR': number
      'NWS': number
      'AccuWeather': number
      'Tomorrow.io': number
    }
    sourceStatus: {
      'Open-Meteo': 'ok' | 'stale' | 'failed'
      'Google-Weather': 'ok' | 'stale' | 'failed'
      'METAR': 'ok' | 'stale' | 'failed'
      'NWS': 'ok' | 'stale' | 'failed'
      'AccuWeather': 'ok' | 'stale' | 'failed'
      'Tomorrow.io': 'ok' | 'stale' | 'failed'
    }
  }
  error?: string
  cached?: boolean
  timestamp: number
}

// ============================================================================
// In-Memory Cache
// ============================================================================

interface CacheEntry {
  data: ForecastsApiResponse
  timestamp: number
}

const forecastCache = new Map<string, CacheEntry>()
const CACHE_TTL = 15 * 60 * 1000 // 15 minutes
const CACHE_MAX_SIZE = 100 // Max 100 cities

const REDIS_PREFIX = 'forecasts:'
const REDIS_TTL_S = 900

async function getCached(key: string): Promise<ForecastsApiResponse | null> {
  // L1: in-memory Map
  const entry = forecastCache.get(key)
  if (entry && Date.now() - entry.timestamp <= CACHE_TTL) {
    return { ...entry.data, cached: true }
  }

  // L2: Redis
  const redisData = await rget<ForecastsApiResponse>(REDIS_PREFIX + key)
  if (redisData) {
    forecastCache.set(key, { data: redisData, timestamp: Date.now() })
    return { ...redisData, cached: true }
  }

  if (entry) forecastCache.delete(key)
  return null
}

async function setCache(key: string, data: ForecastsApiResponse): Promise<void> {
  // Evict oldest entry if cache is full
  if (forecastCache.size >= CACHE_MAX_SIZE) {
    const oldestKey = forecastCache.keys().next().value
    if (oldestKey) forecastCache.delete(oldestKey)
  }

  forecastCache.set(key, {
    data,
    timestamp: Date.now(),
  })

  await rset(REDIS_PREFIX + key, data, REDIS_TTL_S)
}

// ============================================================================
// Helper Functions
// ============================================================================

function calculateSourceFreshness(forecasts: Array<{ timestamp: string | number; dataAge?: number }>): number {
  if (forecasts.length === 0) return 0

  const now = Date.now()

  // Prefer already-computed dataAge values when present.
  // Keep only non-future points so daily aggregates don't mark a source stale.
  const nonFutureAges = forecasts
    .map((f) => {
      if (typeof f.dataAge === 'number' && Number.isFinite(f.dataAge)) {
        return f.dataAge
      }

      const ts = typeof f.timestamp === 'number' ? f.timestamp : new Date(f.timestamp).getTime()
      if (!Number.isFinite(ts)) return NaN
      return now - ts
    })
    .filter((age) => Number.isFinite(age) && age >= 0) as number[]

  // If all points are future-dated forecasts, source is fresh by definition.
  if (nonFutureAges.length === 0) return 1

  return Math.max(1, Math.min(...nonFutureAges))
}

function getSourceStatus(freshness: number): 'ok' | 'stale' | 'failed' {
  if (freshness === 0) return 'failed' // No data
  if (freshness > 6 * 3600000) return 'stale' // >6 hours old
  return 'ok'
}

// ============================================================================
// API Handler
// ============================================================================

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ForecastsApiResponse>
) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed',
      timestamp: Date.now(),
    })
  }

  try {
    // Parse query parameters
    const { city: cityCode, bypassCache } = req.query

    if (!cityCode || typeof cityCode !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Missing or invalid city parameter. Expected city code (e.g., NY, CHI, LA)',
        timestamp: Date.now(),
      })
    }

    // Check cache unless bypassed
    if (!bypassCache) {
      const cached = await getCached(`forecasts:${cityCode}`)
      if (cached) {
        return res.status(200).json(cached)
      }
    }

    // Get city coordinates
    const city = getCityCoordinates(cityCode)
    if (!city) {
      return res.status(400).json({
        success: false,
        error: `Unknown city code: ${cityCode}. Available: NY, CHI, LA, SF, MIA, DAL, HOU, PHX, SEA, BOS, DEN, ATL, PHI, DC, LV, AUS`,
        timestamp: Date.now(),
      })
    }

    const { lat, lng } = city

    // Fetch from all 6 sources in parallel (graceful degradation)
    console.log(`🌤️  Fetching weather for ${cityCode} (${lat}, ${lng})`)
    const [openMeteoResult, googleResult, metarResult, nwsResult, accuResult, tomorrowResult] = await Promise.allSettled([
      fetchWeatherForecast({ lat, lng }),
      fetchGoogleWeather(lat, lng),
      fetchMETARByCity(cityCode),
      fetchNWSForecast(lat, lng),
      fetchAccuWeather(lat, lng),
      fetchTomorrowWeather(lat, lng),
    ])

    // Log results
    console.log('📊 Data source results:')
    console.log('  Open-Meteo:', openMeteoResult.status, openMeteoResult.status === 'fulfilled' ? `${openMeteoResult.value.data.length} forecasts` : openMeteoResult.reason?.message)
    console.log('  Google-Weather:', googleResult.status, googleResult.status === 'fulfilled' ? `${googleResult.value.data.length} forecasts` : googleResult.reason?.message)
    console.log('  METAR:', metarResult.status, metarResult.status === 'fulfilled' ? 'success' : metarResult.reason?.message)
    console.log('  NWS:', nwsResult.status, nwsResult.status === 'fulfilled' ? `${nwsResult.value.data.length} forecasts` : nwsResult.reason?.message)
    console.log('  AccuWeather:', accuResult.status, accuResult.status === 'fulfilled' ? `${accuResult.value.data.length} forecasts` : accuResult.reason?.message)
    console.log('  Tomorrow.io:', tomorrowResult.status, tomorrowResult.status === 'fulfilled' ? `${tomorrowResult.value.data.length} forecasts` : tomorrowResult.reason?.message)

    // Extract successful results
    const openMeteoData = openMeteoResult.status === 'fulfilled' ? openMeteoResult.value.data : []
    const googleData = googleResult.status === 'fulfilled' ? googleResult.value.data : []
    const metarData = metarResult.status === 'fulfilled' ? metarResult.value.data : null
    const nwsData = nwsResult.status === 'fulfilled' ? nwsResult.value.data : []
    const accuData = accuResult.status === 'fulfilled' ? accuResult.value.data : []
    const tomorrowData = tomorrowResult.status === 'fulfilled' ? tomorrowResult.value.data : []

    // Check if we have at least some data
    const totalForecasts = openMeteoData.length + googleData.length + (metarData ? 1 : 0) + nwsData.length + accuData.length + tomorrowData.length
    if (totalForecasts === 0) {
      return res.status(500).json({
        success: false,
        error: 'All weather sources failed. Please try again later.',
        timestamp: Date.now(),
      })
    }

    // Build ensemble with available sources (all 6)
    const ensemble = buildEnsemble(openMeteoData, googleData, metarData, {
      lat,
      lng,
      city: city.name,
    }, nwsData, accuData, tomorrowData)

    // Calculate freshness metrics with timezone-aware timestamp handling
    const freshness = {
      'Open-Meteo': calculateSourceFreshness(openMeteoData),
      'Google-Weather': calculateSourceFreshness(googleData),
      'METAR': metarData ? calculateSourceFreshness([metarData]) : 0,
      'NWS': calculateSourceFreshness(nwsData),
      'AccuWeather': calculateSourceFreshness(accuData),
      'Tomorrow.io': calculateSourceFreshness(tomorrowData),
    }

    // Calculate source status
    const sourceStatus = {
      'Open-Meteo': getSourceStatus(freshness['Open-Meteo']),
      'Google-Weather': getSourceStatus(freshness['Google-Weather']),
      'METAR': getSourceStatus(freshness['METAR']),
      'NWS': getSourceStatus(freshness['NWS']),
      'AccuWeather': getSourceStatus(freshness['AccuWeather']),
      'Tomorrow.io': getSourceStatus(freshness['Tomorrow.io']),
    }

    // Build response
    const response: ForecastsApiResponse = {
      success: true,
      data: {
        ensemble,
        city,
        freshness,
        sourceStatus,
      },
      timestamp: Date.now(),
    }

    // Cache response
    await setCache(`forecasts:${cityCode}`, response)

    // Return response
    return res.status(200).json(response)

  } catch (error) {
    console.error('❌ Forecasts API error:', error)
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
      timestamp: Date.now(),
    })
  }
}
