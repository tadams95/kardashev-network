// Tomorrow.io API client
// Fetches daily forecasts using proprietary NWP+ML hybrid with satellite data

import type { WeatherForecast } from '@/types/weather'
import { rget, rset, rincr } from '@/lib/cache/redis'

const TOMORROW_API_KEY = process.env.TOMORROW_API_KEY
const TOMORROW_BASE_URL = 'https://api.tomorrow.io/v4/weather/forecast'

if (TOMORROW_API_KEY) {
  console.log('[Tomorrow.io] API key loaded')
} else {
  console.warn('[Tomorrow.io] No API key configured')
}

// ============================================================================
// Types
// ============================================================================

interface TomorrowDailyTimeline {
  timelines: {
    daily: Array<{
      time: string
      values: {
        temperatureMin: number
        temperatureMax: number
        precipitationProbability: number
        rainAccumulation: number
        windSpeed: number
        cloudCover: number
        humidity: number
        weatherCode: number
      }
    }>
  }
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

const REDIS_PREFIX = 'tomorrow:'
const REDIS_TTL_S = 1800

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

const DAILY_LIMIT = parseInt(process.env.TOMORROW_DAILY_LIMIT || '500', 10)
const DAILY_WARN = Math.floor(DAILY_LIMIT * 0.8)
const DAILY_STOP = Math.floor(DAILY_LIMIT * 0.9)

const HOURLY_LIMIT = parseInt(process.env.TOMORROW_HOURLY_LIMIT || '25', 10)
const HOURLY_WARN = Math.floor(HOURLY_LIMIT * 0.8) // 20
const HOURLY_REDIS_PREFIX = 'tomorrow:hourly:'

let dailyCallCount = 0
let dailyCallDate = ''

let hourlyCallCount = 0
let hourlyCallHour = ''

function getDayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

function getHourKey(): string {
  const d = new Date()
  return `${d.toISOString().slice(0, 10)}T${String(d.getUTCHours()).padStart(2, '0')}`
}

async function checkHourlyLimit(): Promise<boolean> {
  const hourKey = getHourKey()

  // In-memory counter (works even without Redis)
  if (hourlyCallHour !== hourKey) {
    hourlyCallHour = hourKey
    hourlyCallCount = 0
  }
  hourlyCallCount++

  if (hourlyCallCount === HOURLY_WARN) {
    console.warn(`[Tomorrow.io] WARNING: Approaching hourly limit (${HOURLY_WARN}/${HOURLY_LIMIT} calls, in-memory)`)
  }
  if (hourlyCallCount > HOURLY_LIMIT) {
    console.error(`[Tomorrow.io] Hourly rate limit safety valve triggered (${HOURLY_LIMIT}/hr, in-memory) — skipping fetch`)
    return false
  }

  // Cross-process gate via Redis (production with multiple PM2 workers)
  const redisCount = await rincr(HOURLY_REDIS_PREFIX + hourKey, 3600)
  if (redisCount !== null) {
    if (redisCount === HOURLY_WARN) {
      console.warn(`[Tomorrow.io] WARNING: Approaching hourly limit (${redisCount}/${HOURLY_LIMIT} calls, cross-process)`)
    }
    if (redisCount > HOURLY_LIMIT) {
      console.error(`[Tomorrow.io] Hourly rate limit safety valve triggered (${redisCount}/${HOURLY_LIMIT}/hr, cross-process) — skipping fetch`)
      return false
    }
  }

  return true
}

function incrementCallCount(): boolean {
  const today = getDayKey()
  if (dailyCallDate !== today) {
    dailyCallDate = today
    dailyCallCount = 0
  }
  dailyCallCount++
  if (dailyCallCount === DAILY_WARN) {
    console.warn(`[Tomorrow.io] WARNING: Approaching daily API limit (${DAILY_WARN}/${DAILY_LIMIT} calls)`)
  }
  if (dailyCallCount > DAILY_STOP) {
    console.error(`[Tomorrow.io] Daily API limit safety valve triggered (${DAILY_STOP}/${DAILY_LIMIT} calls) — skipping fetch`)
    return false
  }
  return true
}

// ============================================================================
// Weather Code Mapping
// ============================================================================

function mapTomorrowWeatherCode(code: number): string {
  const codeMap: Record<number, string> = {
    0: 'Unknown',
    1000: 'Clear',
    1100: 'Mostly Clear',
    1101: 'Partly Cloudy',
    1102: 'Mostly Cloudy',
    1001: 'Cloudy',
    2000: 'Fog',
    2100: 'Light Fog',
    4000: 'Drizzle',
    4001: 'Rain',
    4200: 'Light Rain',
    4201: 'Heavy Rain',
    5000: 'Snow',
    5001: 'Flurries',
    5100: 'Light Snow',
    5101: 'Heavy Snow',
    6000: 'Freezing Drizzle',
    6001: 'Freezing Rain',
    6200: 'Light Freezing Rain',
    6201: 'Heavy Freezing Rain',
    7000: 'Ice Pellets',
    7101: 'Heavy Ice Pellets',
    7102: 'Light Ice Pellets',
    8000: 'Thunderstorm',
  }
  return codeMap[code] || 'Unknown'
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Fetch Tomorrow.io daily forecasts for a location.
 * Single-step: daily forecast endpoint with metric units.
 */
export async function fetchTomorrowWeather(
  lat: number,
  lng: number,
  options?: { bypassCache?: boolean }
): Promise<{ data: WeatherForecast[]; cached: boolean }> {
  if (!TOMORROW_API_KEY) {
    console.warn('[Tomorrow.io] API key not configured (TOMORROW_API_KEY)')
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

  if (!incrementCallCount() || !(await checkHourlyLimit())) {
    // Return stale cache if available
    const stale = forecastCache.get(cacheKey)
    if (stale) {
      const age = Date.now() - stale.timestamp
      const data = stale.data.map(f => ({ ...f, dataAge: age }))
      return { data, cached: true }
    }

    // L2 retry fallback: if initial Redis path missed transiently, retry before returning empty.
    const redisStale = await getRedisStaleFallback(cacheKey)
    if (redisStale) {
      return { data: redisStale, cached: true }
    }

    return { data: [], cached: false }
  }

  try {
    const url = `${TOMORROW_BASE_URL}?location=${lat},${lng}&timesteps=1d&units=metric&apikey=${TOMORROW_API_KEY}`

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30000)

    const response = await fetch(url, { signal: controller.signal })
    clearTimeout(timeout)

    if (response.status === 404) {
      return { data: [], cached: false }
    }
    if (response.status === 429) {
      throw new Error('Tomorrow.io API rate limit exceeded')
    }
    if (!response.ok) {
      throw new Error(`Tomorrow.io API error: ${response.status} ${response.statusText}`)
    }

    const data: TomorrowDailyTimeline = await response.json()
    const fetchTime = Date.now()

    const forecasts: WeatherForecast[] = (data.timelines?.daily || []).filter(day => {
      return day.values?.temperatureMin != null && day.values?.temperatureMax != null
    }).map(day => {
      const minC = day.values.temperatureMin
      const maxC = day.values.temperatureMax
      const currentC = (minC + maxC) / 2

      return {
        location: { lat, lng },
        timestamp: day.time,
        temperature: {
          current: currentC,
          min: minC,
          max: maxC,
        },
        precipitation: {
          probability: (day.values.precipitationProbability ?? 0) / 100,
          amount: (day.values.rainAccumulation ?? 0) * 0.03937, // mm -> inches
        },
        conditions: mapTomorrowWeatherCode(day.values.weatherCode),
        weatherCode: day.values.weatherCode,
        cloudCover: day.values.cloudCover,
        humidity: day.values.humidity,
        windSpeed: (day.values.windSpeed ?? 0) * 2.23694, // m/s -> mph
        source: 'Tomorrow.io' as const,
        dataAge: Date.now() - fetchTime,
        confidence: 78,
      }
    })

    // Cache results (L1 + L2)
    forecastCache.set(cacheKey, { data: forecasts, timestamp: Date.now() })
    await rset(REDIS_PREFIX + cacheKey, forecasts, REDIS_TTL_S)

    return { data: forecasts, cached: false }
  } catch (error) {
    console.error('[Tomorrow.io] Fetch error:', error)

    // Return stale cache if available
    const stale = forecastCache.get(cacheKey)
    if (stale) {
      const age = Date.now() - stale.timestamp
      const data = stale.data.map(f => ({ ...f, dataAge: age }))
      return { data, cached: true }
    }

    // L2 retry fallback: protects against transient Redis readiness issues.
    const redisStale = await getRedisStaleFallback(cacheKey)
    if (redisStale) {
      return { data: redisStale, cached: true }
    }

    return { data: [], cached: false }
  }
}
