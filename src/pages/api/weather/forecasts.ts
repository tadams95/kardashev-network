// Real-time weather forecasts API
// Aggregates 3 sources (Open-Meteo, Google Weather, METAR) with consensus engine

import type { NextApiRequest, NextApiResponse } from 'next'
import { fetchWeatherForecast } from '@/lib/api/openMeteo'
import { fetchGoogleWeather } from '@/lib/api/googleWeather'
import { fetchMETARByCity } from '@/lib/api/metar'
import { fetchNWSForecast } from '@/lib/api/nws'
import { buildEnsemble } from '@/lib/models/weatherProbability'
import { getCityCoordinates } from '@/lib/utils/cityCoordinates'
import type { WeatherEnsemble } from '@/types/weather'
import type { CityCoordinates } from '@/lib/utils/cityCoordinates'

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
    }
    sourceStatus: {
      'Open-Meteo': 'ok' | 'stale' | 'failed'
      'Google-Weather': 'ok' | 'stale' | 'failed'
      'METAR': 'ok' | 'stale' | 'failed'
      'NWS': 'ok' | 'stale' | 'failed'
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

function getCached(key: string): ForecastsApiResponse | null {
  const entry = forecastCache.get(key)
  if (!entry) return null

  const age = Date.now() - entry.timestamp
  if (age > CACHE_TTL) {
    forecastCache.delete(key)
    return null
  }

  return {
    ...entry.data,
    cached: true,
  }
}

function setCache(key: string, data: ForecastsApiResponse): void {
  // Evict oldest entry if cache is full
  if (forecastCache.size >= CACHE_MAX_SIZE) {
    const oldestKey = forecastCache.keys().next().value
    if (oldestKey) forecastCache.delete(oldestKey)
  }

  forecastCache.set(key, {
    data,
    timestamp: Date.now(),
  })
}

// ============================================================================
// Helper Functions
// ============================================================================

function ensureUTCTimestamp(timestamp: string | number): number {
  // If already a number, return as-is
  if (typeof timestamp === 'number') return timestamp

  // Parse ISO string to Date
  const date = new Date(timestamp)
  const timestampMs = date.getTime()

  // Validate: warn if timestamp is more than 5 minutes in future
  const now = Date.now()
  const diff = timestampMs - now
  if (diff > 5 * 60 * 1000) {
    console.warn(`⚠️  Timestamp ${Math.round(diff / 1000)}s in future: ${timestamp}`)
  }

  return timestampMs
}

function calculateFreshness(timestamp: number): number {
  return Math.max(1, Date.now() - timestamp)
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
      const cached = getCached(`forecasts:${cityCode}`)
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

    // Fetch from all 4 sources in parallel (graceful degradation)
    console.log(`🌤️  Fetching weather for ${cityCode} (${lat}, ${lng})`)
    const [openMeteoResult, googleResult, metarResult, nwsResult] = await Promise.allSettled([
      fetchWeatherForecast({ lat, lng }),
      fetchGoogleWeather(lat, lng),
      fetchMETARByCity(cityCode),
      fetchNWSForecast(lat, lng),
    ])

    // Log results
    console.log('📊 Data source results:')
    console.log('  Open-Meteo:', openMeteoResult.status, openMeteoResult.status === 'fulfilled' ? `${openMeteoResult.value.data.length} forecasts` : openMeteoResult.reason?.message)
    console.log('  Google-Weather:', googleResult.status, googleResult.status === 'fulfilled' ? `${googleResult.value.data.length} forecasts` : googleResult.reason?.message)
    console.log('  METAR:', metarResult.status, metarResult.status === 'fulfilled' ? 'success' : metarResult.reason?.message)
    console.log('  NWS:', nwsResult.status, nwsResult.status === 'fulfilled' ? `${nwsResult.value.data.length} forecasts` : nwsResult.reason?.message)

    // Extract successful results
    const openMeteoData = openMeteoResult.status === 'fulfilled' ? openMeteoResult.value.data : []
    const googleData = googleResult.status === 'fulfilled' ? googleResult.value.data : []
    const metarData = metarResult.status === 'fulfilled' ? metarResult.value.data : null
    const nwsData = nwsResult.status === 'fulfilled' ? nwsResult.value.data : []

    // Check if we have at least some data
    const totalForecasts = openMeteoData.length + googleData.length + (metarData ? 1 : 0) + nwsData.length
    if (totalForecasts === 0) {
      return res.status(500).json({
        success: false,
        error: 'All weather sources failed. Please try again later.',
        timestamp: Date.now(),
      })
    }

    // Build ensemble with available sources (including NWS)
    const ensemble = buildEnsemble(openMeteoData, googleData, metarData, {
      lat,
      lng,
      city: city.name,
    }, nwsData)

    // Calculate freshness metrics with timezone-aware timestamp handling
    const freshness = {
      'Open-Meteo': openMeteoData.length > 0
        ? calculateFreshness(ensureUTCTimestamp(openMeteoData[0].timestamp))
        : 0,
      'Google-Weather': googleData.length > 0
        ? calculateFreshness(ensureUTCTimestamp(googleData[0].timestamp))
        : 0,
      'METAR': metarData
        ? calculateFreshness(ensureUTCTimestamp(metarData.timestamp))
        : 0,
      'NWS': nwsData.length > 0
        ? Math.max(1, nwsData[0].dataAge)
        : 0,
    }

    // Calculate source status
    const sourceStatus = {
      'Open-Meteo': getSourceStatus(freshness['Open-Meteo']),
      'Google-Weather': getSourceStatus(freshness['Google-Weather']),
      'METAR': getSourceStatus(freshness['METAR']),
      'NWS': getSourceStatus(freshness['NWS']),
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
    setCache(`forecasts:${cityCode}`, response)

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
