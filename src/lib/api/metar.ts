// METAR (Aviation Weather) API client
// Fetches ground-truth weather observations from NOAA Aviation Weather Center

import type { METARResponse, WeatherForecast } from '@/types/weather'
import { getICAOForCity, getCityForICAO } from '@/lib/utils/airports'

const METAR_BASE_URL = 'https://aviationweather.gov/api/data/metar'

// In-memory cache with TTL
interface CacheEntry {
  data: WeatherForecast
  timestamp: number
}

const cache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 30 * 60 * 1000 // 30 minutes (METAR updates hourly)
const STALE_DATA_THRESHOLD_MS = 2 * 60 * 60 * 1000 // 2 hours

function getCacheKey(icaoCode: string): string {
  return `metar:${icaoCode.toUpperCase()}`
}

function getFromCache(icaoCode: string): WeatherForecast | null {
  const key = getCacheKey(icaoCode)
  const entry = cache.get(key)

  if (!entry) return null

  const age = Date.now() - entry.timestamp
  if (age > CACHE_TTL_MS) {
    cache.delete(key)
    return null
  }

  return entry.data
}

function setCache(icaoCode: string, data: WeatherForecast): void {
  const key = getCacheKey(icaoCode)
  cache.set(key, { data, timestamp: Date.now() })

  // Prevent memory leak: limit cache size
  if (cache.size > 1000) {
    const firstKey = cache.keys().next().value
    if (firstKey) cache.delete(firstKey)
  }
}

/**
 * Parse weather conditions from METAR string
 * Extracts precipitation type and intensity
 */
function parseWeatherConditions(rawOb: string): string {
  const conditions: string[] = []

  // Common METAR weather codes
  const weatherCodes: Record<string, string> = {
    'RA': 'Rain',
    'SN': 'Snow',
    'FG': 'Fog',
    'BR': 'Mist',
    'HZ': 'Haze',
    'TS': 'Thunderstorm',
    'DZ': 'Drizzle',
    'SH': 'Showers',
    'FZ': 'Freezing',
    'GR': 'Hail',
    'GS': 'Small Hail',
    'PL': 'Ice Pellets',
    'UP': 'Unknown Precipitation',
  }

  // Intensity prefixes
  const intensityMap: Record<string, string> = {
    '-': 'Light',
    '+': 'Heavy',
    'VC': 'Nearby',
  }

  // Look for weather phenomena in METAR
  const parts = rawOb.split(/\s+/)
  for (const part of parts) {
    // Check for intensity prefix
    let intensity = ''
    let phenomenon = part

    if (part.startsWith('-') || part.startsWith('+')) {
      intensity = intensityMap[part[0]] + ' '
      phenomenon = part.slice(1)
    } else if (part.startsWith('VC')) {
      intensity = intensityMap['VC'] + ' '
      phenomenon = part.slice(2)
    }

    // Match weather codes (often combined, e.g., "TSRA" = Thunderstorm with Rain)
    for (const [code, description] of Object.entries(weatherCodes)) {
      if (phenomenon.includes(code)) {
        conditions.push(intensity + description)
        break
      }
    }
  }

  if (conditions.length === 0) {
    // Check for clear conditions
    if (rawOb.includes('CLR') || rawOb.includes('SKC') || rawOb.includes('CAVOK')) {
      return 'Clear'
    }
    if (rawOb.includes('FEW') || rawOb.includes('SCT')) {
      return 'Partly Cloudy'
    }
    if (rawOb.includes('BKN')) {
      return 'Mostly Cloudy'
    }
    if (rawOb.includes('OVC')) {
      return 'Overcast'
    }
    return 'Clear'
  }

  return conditions.join(', ')
}

/**
 * Parse METAR observation into WeatherForecast format
 */
function parseMETAR(response: METARResponse): WeatherForecast {
  const rawOb = response.rawOb || ''

  // Extract temperature from temp/dewpoint format (e.g., "22/08" = 22°C temp, 08°C dewpoint)
  const temperature = response.temp != null ? response.temp : 0

  // Extract visibility (already parsed from API response)
  const visibility = response.visib ? parseFloat(response.visib) : null

  // Parse weather conditions from raw observation
  const conditions = parseWeatherConditions(rawOb)

  // Estimate precipitation probability from conditions
  let precipProbability = 0
  const precipKeywords = ['rain', 'snow', 'drizzle', 'showers', 'hail', 'pellets', 'thunderstorm']
  const conditionsLower = conditions.toLowerCase()

  if (precipKeywords.some(keyword => conditionsLower.includes(keyword))) {
    if (conditionsLower.includes('light')) {
      precipProbability = 0.3
    } else if (conditionsLower.includes('heavy')) {
      precipProbability = 0.8
    } else {
      precipProbability = 0.5
    }
  }

  // Calculate data age (observation time to now)
  const obsTime = response.obsTime * 1000 // Convert to milliseconds
  const dataAge = Date.now() - obsTime

  // Determine confidence based on data freshness
  let confidence = 90 // METAR is ground truth, high confidence
  if (dataAge > STALE_DATA_THRESHOLD_MS) {
    confidence = 60 // Stale data, lower confidence
  }

  return {
    location: {
      lat: response.lat,
      lng: response.lon,
      city: getCityForICAO(response.icaoId) || response.name || undefined,
    },
    timestamp: new Date(obsTime).toISOString(),
    temperature: {
      current: temperature,
      min: response.minT != null ? response.minT : temperature,
      max: response.maxT != null ? response.maxT : temperature,
    },
    precipitation: {
      probability: precipProbability,
      amount: response.precip !== null ? response.precip : 0,
    },
    conditions,
    weatherCode: undefined, // METAR doesn't use WMO codes
    cloudCover: undefined,  // Could parse from cloud layers, defer to Week 2
    humidity: undefined,    // Not always available in METAR
    windSpeed: response.wspd !== null ? response.wspd : undefined,
    windDirection: response.wdir !== null ? response.wdir : undefined,
    visibility: visibility !== null ? visibility : undefined,
    source: 'METAR',
    dataAge,
    confidence,
    raw: rawOb,
  }
}

export interface FetchMETAROptions {
  bypassCache?: boolean
}

/**
 * Fetch METAR observation for a given ICAO airport code
 *
 * @param icaoCode - ICAO airport code (e.g., "KDFW", "KJFK")
 * @param options - Fetch options
 * @returns Weather forecast data and cache status
 */
export async function fetchMETAR(
  icaoCode: string,
  options: FetchMETAROptions = {}
): Promise<{ data: WeatherForecast; cached: boolean }> {
  const { bypassCache = false } = options

  // Normalize ICAO code
  const normalizedICAO = icaoCode.trim().toUpperCase()

  // Check cache first
  if (!bypassCache) {
    const cached = getFromCache(normalizedICAO)
    if (cached) {
      return { data: cached, cached: true }
    }
  }

  try {
    // Build API URL
    const url = new URL(METAR_BASE_URL)
    url.searchParams.set('ids', normalizedICAO)
    url.searchParams.set('format', 'json')
    // Note: 'taf' parameter removed - new API only returns METAR by default

    console.log(`  🔗 METAR URL: ${url.toString()}`)

    // Fetch with timeout
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000) // 10s timeout

    const response = await fetch(url.toString(), { signal: controller.signal })
    clearTimeout(timeout)

    if (!response.ok) {
      console.error(`  ❌ METAR API error: ${response.status} ${response.statusText}`)
      if (response.status === 404) {
        throw new Error(`No METAR data available for ${normalizedICAO}`)
      }
      throw new Error(`METAR API error: ${response.status} ${response.statusText}`)
    }

    const rawData = await response.json()

    // API returns array of METARs
    if (!Array.isArray(rawData) || rawData.length === 0) {
      console.warn(`  ⚠️  No METAR observations found for ${normalizedICAO}`)
      throw new Error(`No METAR observations found for ${normalizedICAO}`)
    }

    console.log(`  ✅ Received METAR data for ${normalizedICAO}`)
    const metarResponse: METARResponse = rawData[0]
    const weatherData = parseMETAR(metarResponse)

    // Store in cache
    setCache(normalizedICAO, weatherData)

    return { data: weatherData, cached: false }
  } catch (error) {
    console.error(`  ❌ METAR fetch error:`, error)
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw new Error(`METAR API request timeout for ${normalizedICAO}`)
      }
      throw error
    }
    throw new Error('Unknown error fetching METAR data')
  }
}

/**
 * Fetch METAR observation by city name
 * Looks up ICAO code from city name, then fetches METAR
 *
 * @param city - City name (e.g., "Dallas", "New York")
 * @param options - Fetch options
 * @returns Weather forecast data and cache status
 */
export async function fetchMETARByCity(
  city: string,
  options: FetchMETAROptions = {}
): Promise<{ data: WeatherForecast; cached: boolean }> {
  console.log(`🌤️  Fetching METAR for city: ${city}`)
  const icaoCode = getICAOForCity(city)

  if (!icaoCode) {
    console.error(`  ❌ No ICAO code found for city: ${city}`)
    throw new Error(
      `No ICAO airport code found for city "${city}". ` +
      `Supported cities can be found using getSupportedCities() from @/lib/utils/airports`
    )
  }

  console.log(`  📍 Using ICAO code: ${icaoCode}`)
  return fetchMETAR(icaoCode, options)
}

/**
 * Fetch multiple METAR observations in parallel
 *
 * @param icaoCodes - Array of ICAO codes
 * @param options - Fetch options
 * @returns Array of results with ICAO code, data, and error status
 */
export async function fetchMultipleMETAR(
  icaoCodes: string[],
  options: FetchMETAROptions = {}
): Promise<Array<{
  icao: string
  data?: WeatherForecast
  cached: boolean
  error?: string
}>> {
  const promises = icaoCodes.map(async (icao) => {
    try {
      const result = await fetchMETAR(icao, options)
      return {
        icao: icao.toUpperCase(),
        data: result.data,
        cached: result.cached,
      }
    } catch (error) {
      return {
        icao: icao.toUpperCase(),
        cached: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  })

  return Promise.all(promises)
}

/**
 * Clear METAR cache
 * Useful for testing or forcing fresh data
 */
export function clearMETARCache(): void {
  cache.clear()
}

/**
 * Get cache statistics
 * Useful for monitoring cache performance
 */
export function getMETARCacheStats(): {
  size: number
  entries: Array<{ icao: string; age: number }>
} {
  const entries = Array.from(cache.entries()).map(([key, entry]) => ({
    icao: key.replace('metar:', ''),
    age: Date.now() - entry.timestamp,
  }))

  return {
    size: cache.size,
    entries,
  }
}
