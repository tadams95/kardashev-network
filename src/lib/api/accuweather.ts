// AccuWeather API client
// Fetches daily forecasts via 2-step flow: geoposition lookup + 5-day forecast
// Post-processed statistical blend methodology

import type { WeatherForecast } from '@/types/weather'
import { rget, rset } from '@/lib/cache/redis'

const ACCUWEATHER_API_KEY = process.env.ACCUWEATHER_CORE_API_KEY || process.env.ACCUWEATHER_API_KEY
const ACCUWEATHER_BASE_URL = 'https://dataservice.accuweather.com'

if (ACCUWEATHER_API_KEY) {
  const keySource = process.env.ACCUWEATHER_CORE_API_KEY ? 'Core' : 'Legacy'
  console.log(`[AccuWeather] API key loaded (${keySource})`)
} else {
  console.warn('[AccuWeather] No API key configured')
}

// ============================================================================
// Types
// ============================================================================

interface AccuWeatherLocationResponse {
  Key: string
  LocalizedName: string
  Country: { ID: string; LocalizedName: string }
  AdministrativeArea: { ID: string; LocalizedName: string }
  TimeZone: { Name: string }
  GeoPosition: { Latitude: number; Longitude: number }
}

interface AccuWeatherDailyResponse {
  Headline: { Text: string }
  DailyForecasts: Array<{
    Date: string
    Temperature: {
      Minimum: { Value: number; Unit: string }
      Maximum: { Value: number; Unit: string }
    }
    Day: {
      PrecipitationProbability: number
      Rain: { Value: number; Unit: string }
      Wind: { Speed: { Value: number; Unit: string } }
      CloudCover: number
      RelativeHumidity?: { Average: number }
      IconPhrase: string
    }
    Night: {
      PrecipitationProbability: number
      IconPhrase: string
    }
  }>
}

// ============================================================================
// Cache
// ============================================================================

interface CacheEntry {
  data: WeatherForecast[]
  timestamp: number
}

const forecastCache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 30 * 60 * 1000 // 30 minutes

const locationKeyCache = new Map<string, string>() // Permanent in-memory cache

const REDIS_PREFIX = 'accuweather:'
const REDIS_TTL_S = 1800
const REDIS_LOC_PREFIX = 'accuweather:loc:'
const REDIS_LOC_TTL_S = 30 * 24 * 60 * 60 // 30 days

function getCacheKey(lat: number, lng: number): string {
  return `${lat.toFixed(2)},${lng.toFixed(2)}`
}

async function getRedisStaleFallback(cacheKey: string): Promise<WeatherForecast[] | null> {
  const redisData = await rget<WeatherForecast[]>(REDIS_PREFIX + cacheKey)
  if (!redisData || redisData.length === 0) return null

  forecastCache.set(cacheKey, { data: redisData, timestamp: Date.now() })
  return redisData
}

// ============================================================================
// Rate Limit Safety Valve
// ============================================================================

const DAILY_LIMIT = parseInt(process.env.ACCUWEATHER_DAILY_LIMIT || '500', 10)
const WARN_THRESHOLD = Math.floor(DAILY_LIMIT * 0.8)
const STOP_THRESHOLD = Math.floor(DAILY_LIMIT * 0.9)

let dailyCallCount = 0
let dailyCallDate = ''

function getDayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

function incrementCallCount(): boolean {
  const today = getDayKey()
  if (dailyCallDate !== today) {
    dailyCallDate = today
    dailyCallCount = 0
  }
  dailyCallCount++
  if (dailyCallCount === WARN_THRESHOLD) {
    console.warn(`[AccuWeather] WARNING: Approaching daily API limit (${WARN_THRESHOLD}/${DAILY_LIMIT} calls)`)
  }
  if (dailyCallCount > STOP_THRESHOLD) {
    console.error(`[AccuWeather] Daily API limit safety valve triggered (${STOP_THRESHOLD}/${DAILY_LIMIT} calls) — skipping fetch`)
    return false
  }
  return true
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Look up AccuWeather locationKey for a lat/lng pair.
 * Result is cached permanently in L1 (coordinates don't change).
 */
async function getLocationKey(lat: number, lng: number): Promise<string> {
  const coordKey = getCacheKey(lat, lng)
  const l1Key = `accuweather-loc:${coordKey}`

  // L1: in-memory cache
  const cached = locationKeyCache.get(l1Key)
  if (cached) return cached

  // L2: Redis
  const redisKey = await rget<string>(REDIS_LOC_PREFIX + coordKey)
  if (redisKey) {
    locationKeyCache.set(l1Key, redisKey)
    return redisKey
  }

  if (!incrementCallCount()) {
    throw new Error('AccuWeather daily rate limit exceeded')
  }

  const url = `${ACCUWEATHER_BASE_URL}/locations/v1/cities/geoposition/search?q=${lat},${lng}&apikey=${ACCUWEATHER_API_KEY}`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30000)

  const response = await fetch(url, { signal: controller.signal })
  clearTimeout(timeout)

  if (response.status === 404) {
    throw new Error(`AccuWeather: No location found for (${lat}, ${lng})`)
  }
  if (response.status === 429) {
    throw new Error('AccuWeather API rate limit exceeded')
  }
  if (!response.ok) {
    throw new Error(`AccuWeather location API error: ${response.status} ${response.statusText}`)
  }

  const data: AccuWeatherLocationResponse = await response.json()
  const locationKey = data.Key

  // Cache in L1 + L2
  locationKeyCache.set(l1Key, locationKey)
  await rset(REDIS_LOC_PREFIX + coordKey, locationKey, REDIS_LOC_TTL_S)

  return locationKey
}

/**
 * Fetch 5-day daily forecast from AccuWeather.
 */
async function fetchDailyForecast(
  locationKey: string,
  lat: number,
  lng: number
): Promise<WeatherForecast[]> {
  if (!incrementCallCount()) {
    throw new Error('AccuWeather daily rate limit exceeded')
  }

  const url = `${ACCUWEATHER_BASE_URL}/forecasts/v1/daily/5day/${locationKey}?apikey=${ACCUWEATHER_API_KEY}&details=true&metric=true`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30000)

  const response = await fetch(url, { signal: controller.signal })
  clearTimeout(timeout)

  if (response.status === 404) {
    return []
  }
  if (response.status === 429) {
    throw new Error('AccuWeather API rate limit exceeded')
  }
  if (!response.ok) {
    throw new Error(`AccuWeather forecast API error: ${response.status} ${response.statusText}`)
  }

  const data: AccuWeatherDailyResponse = await response.json()
  const fetchTime = Date.now()

  return (data.DailyForecasts || []).filter(day => {
    return day.Temperature?.Minimum?.Value != null && day.Temperature?.Maximum?.Value != null
  }).map(day => {
    const minC = day.Temperature.Minimum.Value
    const maxC = day.Temperature.Maximum.Value
    const currentC = (minC + maxC) / 2

    return {
      location: { lat, lng },
      timestamp: day.Date,
      temperature: {
        current: currentC,
        min: minC,
        max: maxC,
      },
      precipitation: {
        probability: day.Day.PrecipitationProbability / 100,
        amount: (day.Day.Rain?.Value ?? 0) * 0.03937, // mm -> inches
      },
      conditions: day.Day.IconPhrase || 'Unknown',
      cloudCover: day.Day.CloudCover,
      humidity: day.Day.RelativeHumidity?.Average,
      windSpeed: (day.Day.Wind?.Speed?.Value ?? 0) * 0.621371, // km/h -> mph
      source: 'AccuWeather' as const,
      dataAge: Date.now() - fetchTime,
      confidence: 80,
    }
  })
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Fetch AccuWeather daily forecasts for a location.
 * 2-step: geoposition lookup (cached permanently) + 5-day daily forecast.
 */
export async function fetchAccuWeather(
  lat: number,
  lng: number,
  options?: { bypassCache?: boolean }
): Promise<{ data: WeatherForecast[]; cached: boolean }> {
  if (!ACCUWEATHER_API_KEY) {
    console.warn('[AccuWeather] API key not configured (ACCUWEATHER_CORE_API_KEY / ACCUWEATHER_API_KEY)')
    return { data: [], cached: false }
  }

  const cacheKey = getCacheKey(lat, lng)

  // L1: in-memory cache
  if (!options?.bypassCache) {
    const entry = forecastCache.get(cacheKey)
    if (entry && Date.now() - entry.timestamp < CACHE_TTL_MS) {
      const age = Date.now() - entry.timestamp
      const data = entry.data.map(f => ({ ...f, dataAge: age }))
      return { data, cached: true }
    }

    // L2: Redis
    const redisData = await rget<WeatherForecast[]>(REDIS_PREFIX + cacheKey)
    if (redisData) {
      forecastCache.set(cacheKey, { data: redisData, timestamp: Date.now() })
      return { data: redisData, cached: true }
    }
  }

  try {
    // Step 1: Get location key (permanently cached)
    const locationKey = await getLocationKey(lat, lng)

    // Step 2: Fetch 5-day daily forecast
    const forecasts = await fetchDailyForecast(locationKey, lat, lng)

    // Cache results (L1 + L2)
    forecastCache.set(cacheKey, { data: forecasts, timestamp: Date.now() })
    await rset(REDIS_PREFIX + cacheKey, forecasts, REDIS_TTL_S)

    return { data: forecasts, cached: false }
  } catch (error) {
    console.error('[AccuWeather] Fetch error:', error)

    // Return stale cache if available
    const stale = forecastCache.get(cacheKey)
    if (stale) {
      const age = Date.now() - stale.timestamp
      const data = stale.data.map(f => ({ ...f, dataAge: age }))
      return { data, cached: true }
    }

    // L2 retry fallback: protects against transient Redis read misses on initial path.
    const redisStale = await getRedisStaleFallback(cacheKey)
    if (redisStale) {
      return { data: redisStale, cached: true }
    }

    return { data: [], cached: false }
  }
}
