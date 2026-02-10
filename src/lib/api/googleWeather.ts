// Google Weather API client
// Fetches AI-powered weather forecasts using Google's MetNet model

import type { GoogleWeatherResponse, WeatherForecast } from '@/types/weather'

const GOOGLE_WEATHER_API_BASE = 'https://weather.googleapis.com/v1'
const GOOGLE_API_KEY = process.env.GOOGLE_MAPS_API_KEY

// In-memory cache with TTL
interface CacheEntry {
  data: WeatherForecast[]
  timestamp: number
}

const cache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 15 * 60 * 1000 // 15 minutes

function getCacheKey(lat: number, lng: number): string {
  // Round to 2 decimal places for cache key (~1km precision)
  return `google:${lat.toFixed(2)},${lng.toFixed(2)}`
}

function getFromCache(lat: number, lng: number): WeatherForecast[] | null {
  const key = getCacheKey(lat, lng)
  const entry = cache.get(key)

  if (!entry) return null

  const age = Date.now() - entry.timestamp
  if (age > CACHE_TTL_MS) {
    cache.delete(key)
    return null
  }

  return entry.data
}

function setCache(lat: number, lng: number, data: WeatherForecast[]): void {
  const key = getCacheKey(lat, lng)
  cache.set(key, { data, timestamp: Date.now() })

  // Prevent memory leak: limit cache size
  if (cache.size > 1000) {
    const firstKey = cache.keys().next().value
    if (firstKey) cache.delete(firstKey)
  }
}

/**
 * Map Google Weather condition codes to human-readable descriptions
 * Based on Google's weather code enumeration
 */
function mapGoogleConditionCode(code: number): string {
  const conditionMap: Record<number, string> = {
    0: 'Unknown',
    1000: 'Clear',
    1100: 'Mostly Clear',
    1101: 'Partly Cloudy',
    1102: 'Mostly Cloudy',
    1001: 'Cloudy',
    2000: 'Fog',
    2100: 'Light Fog',
    3000: 'Light Wind',
    3001: 'Wind',
    3002: 'Strong Wind',
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

  return conditionMap[code] || 'Unknown'
}

/**
 * Transform Google Weather API v1 response to WeatherForecast array
 */
function transformGoogleWeatherV1Response(
  response: any,
  lat: number,
  lng: number
): WeatherForecast[] {
  const forecasts: WeatherForecast[] = []

  if (!response.forecastHours || response.forecastHours.length === 0) {
    console.warn('No forecast hours in Google Weather v1 response')
    return forecasts
  }

  // Process hourly forecasts
  for (const hour of response.forecastHours) {
    try {
      const timestamp = hour.interval?.startTime || hour.displayDateTime
      if (!timestamp) continue

      const temp = hour.temperature?.value ?? 0
      const dataAge = Date.now() - new Date(timestamp).getTime()

      // Safely extract precipitation probability (0-100 range from API)
      const precipProb = hour.precipitation?.probability
      const precipAmount = hour.precipitation?.amount?.value

      forecasts.push({
        location: { lat, lng },
        timestamp,
        temperature: {
          current: temp,
          min: temp,
          max: temp,
          apparent: hour.feelsLikeTemperature?.value ?? temp,
        },
        precipitation: {
          probability: typeof precipProb === 'number' ? precipProb / 100 : 0,
          amount: precipAmount ?? 0,
        },
        conditions: hour.weatherCondition?.description || 'Unknown',
        weatherCode: hour.weatherCondition?.code || 0,
        cloudCover: hour.cloudCover?.value || 0,
        humidity: hour.relativeHumidity?.value || 0,
        windSpeed: hour.wind?.speed?.value || 0,
        windDirection: hour.wind?.direction?.value || 0,
        visibility: hour.visibility?.value || 0,
        source: 'Google-Weather',
        dataAge,
        confidence: 85,
      })
    } catch (err) {
      console.warn('Error processing Google Weather v1 hour:', err)
    }
  }

  return forecasts
}

/**
 * Transform Google Weather API response to WeatherForecast array
 * @deprecated Use transformGoogleWeatherV1Response for v1 API
 */
function transformGoogleWeatherResponse(
  response: GoogleWeatherResponse,
  lat: number,
  lng: number
): WeatherForecast[] {
  const forecasts: WeatherForecast[] = []

  // Process hourly forecasts (up to 240 hours / 10 days)
  if (response.hourlyForecasts && response.hourlyForecasts.length > 0) {
    for (const hourly of response.hourlyForecasts) {
      const dataAge = Date.now() - new Date(hourly.time).getTime()

      forecasts.push({
        location: {
          lat,
          lng,
        },
        timestamp: hourly.time,
        temperature: {
          current: hourly.values.temperature,
          min: hourly.values.temperature, // Hourly doesn't have min/max
          max: hourly.values.temperature,
          apparent: hourly.values.temperatureApparent,
        },
        precipitation: {
          probability: hourly.values.precipitationProbability / 100, // Convert to 0-1
          amount: hourly.values.precipitationAmount || 0,
          intensity: hourly.values.precipitationIntensity,
        },
        conditions: mapGoogleConditionCode(hourly.values.weatherCode),
        weatherCode: hourly.values.weatherCode,
        cloudCover: hourly.values.cloudCover,
        humidity: hourly.values.humidity,
        windSpeed: hourly.values.windSpeed,
        windDirection: undefined, // Hourly doesn't include wind direction
        visibility: undefined,
        source: 'Google-Weather',
        dataAge,
        confidence: 85, // Google MetNet is highly accurate AI model
      })
    }
  }

  // If we have daily forecasts, enrich with min/max temps
  if (response.dailyForecasts && response.dailyForecasts.length > 0) {
    // Create daily forecast entries
    for (const daily of response.dailyForecasts) {
      const dataAge = Date.now() - new Date(daily.date).getTime()

      forecasts.push({
        location: {
          lat,
          lng,
        },
        timestamp: daily.date,
        temperature: {
          current: daily.values.temperatureAvg,
          min: daily.values.temperatureMin,
          max: daily.values.temperatureMax,
        },
        precipitation: {
          probability: daily.values.precipitationProbabilityAvg / 100,
          amount: daily.values.precipitationAmountSum,
        },
        conditions: mapGoogleConditionCode(daily.values.weatherCodeMax),
        weatherCode: daily.values.weatherCodeMax,
        cloudCover: undefined, // Daily doesn't include cloud cover
        humidity: undefined,
        windSpeed: undefined,
        windDirection: undefined,
        visibility: undefined,
        source: 'Google-Weather',
        dataAge,
        confidence: 85,
      })
    }
  }

  // Include current conditions if available
  if (response.current) {
    const dataAge = Date.now() - new Date(response.current.time).getTime()

    forecasts.unshift({
      location: {
        lat,
        lng,
      },
      timestamp: response.current.time,
      temperature: {
        current: response.current.values.temperature,
        min: response.current.values.temperature,
        max: response.current.values.temperature,
        apparent: response.current.values.temperatureApparent,
      },
      precipitation: {
        probability: response.current.values.precipitationProbability / 100,
        amount: 0,
        intensity: response.current.values.precipitationIntensity,
      },
      conditions: mapGoogleConditionCode(response.current.values.weatherCode),
      weatherCode: response.current.values.weatherCode,
      cloudCover: response.current.values.cloudCover,
      humidity: response.current.values.humidity,
      windSpeed: response.current.values.windSpeed,
      windDirection: response.current.values.windDirection,
      visibility: response.current.values.visibility,
      source: 'Google-Weather',
      dataAge,
      confidence: 90, // Current observations are most reliable
    })
  }

  return forecasts
}

export interface FetchGoogleWeatherOptions {
  bypassCache?: boolean
  hourlyHorizon?: number  // Hours to fetch (default: 240 = 10 days)
  dailyHorizon?: number   // Days to fetch (default: 10)
  includeCurrent?: boolean // Include current conditions (default: true)
}

/**
 * Fetch weather forecasts from Google Weather API
 *
 * @param lat - Latitude
 * @param lng - Longitude
 * @param options - Fetch options
 * @returns Array of weather forecasts and cache status
 */
export async function fetchGoogleWeather(
  lat: number,
  lng: number,
  options: FetchGoogleWeatherOptions = {}
): Promise<{ data: WeatherForecast[]; cached: boolean }> {
  const {
    bypassCache = false,
    hourlyHorizon = 240, // 10 days
    dailyHorizon = 10,
    includeCurrent = true,
  } = options

  // Validate coordinates
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw new Error('Invalid coordinates: latitude must be -90 to 90, longitude -180 to 180')
  }

  // Check API key
  if (!GOOGLE_API_KEY) {
    throw new Error('Google API key not configured (GOOGLE_MAPS_API_KEY)')
  }

  // Check cache first
  if (!bypassCache) {
    const cached = getFromCache(lat, lng)
    if (cached) {
      return { data: cached, cached: true }
    }
  }

  try {
    console.log(`🌤️  Fetching Google Weather for (${lat}, ${lng})`)

    // Build API URL for hourly forecast
    const url = new URL(`${GOOGLE_WEATHER_API_BASE}/forecast/hours:lookup`)
    url.searchParams.set('location.latitude', lat.toString())
    url.searchParams.set('location.longitude', lng.toString())
    url.searchParams.set('key', GOOGLE_API_KEY)

    if (hourlyHorizon > 0) {
      url.searchParams.set('hours', Math.min(hourlyHorizon, 240).toString())
    }

    console.log(`  Endpoint: ${url.pathname}`)

    // Fetch with timeout
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30000) // 30s timeout

    const response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
      },
    })

    clearTimeout(timeout)

    // Handle error responses
    if (!response.ok) {
      console.error(`  ❌ Google Weather API error: ${response.status} ${response.statusText}`)

      if (response.status === 403) {
        throw new Error(
          'Google Weather API access denied. Please ensure the API is enabled in your Google Cloud Console. ' +
          'Visit: https://console.cloud.google.com/apis/library/weather.googleapis.com'
        )
      }

      if (response.status === 404) {
        // No weather data available for this location - return empty array
        console.warn(`  ⚠️  No Google Weather data available for (${lat}, ${lng})`)
        return { data: [], cached: false }
      }

      if (response.status === 429) {
        throw new Error('Google Weather API rate limit exceeded. Please wait and try again.')
      }

      if (response.status >= 500) {
        // Server error - retry once after short delay
        console.warn(`  ⚠️  Server error, retrying in 1s...`)
        await new Promise(resolve => setTimeout(resolve, 1000))

        const retryResponse = await fetch(url.toString(), {
          headers: {
            'Content-Type': 'application/json',
          },
        })

        if (!retryResponse.ok) {
          throw new Error(`Google Weather API server error: ${retryResponse.status}`)
        }

        const retryData = await retryResponse.json()
        console.log(`  ✅ Retry successful: ${retryData.forecastHours?.length || 0} hours`)
        const forecasts = transformGoogleWeatherV1Response(retryData, lat, lng)
        setCache(lat, lng, forecasts)
        return { data: forecasts, cached: false }
      }

      throw new Error(`Google Weather API error: ${response.status} ${response.statusText}`)
    }

    // Parse response
    const data = await response.json()
    console.log(`  ✅ Received ${data.forecastHours?.length || 0} hourly forecasts`)

    // Transform to our standard format
    const forecasts = transformGoogleWeatherV1Response(data, lat, lng)

    // Store in cache
    setCache(lat, lng, forecasts)

    return { data: forecasts, cached: false }
  } catch (error) {
    console.error(`  ❌ Google Weather fetch error:`, error)
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw new Error('Google Weather API request timeout')
      }
      throw error
    }
    throw new Error('Unknown error fetching Google Weather data')
  }
}

/**
 * Fetch current weather conditions only (no forecasts)
 * Faster and uses less API quota
 *
 * @param lat - Latitude
 * @param lng - Longitude
 * @param options - Fetch options
 * @returns Current weather forecast
 */
export async function fetchGoogleCurrentWeather(
  lat: number,
  lng: number,
  options: FetchGoogleWeatherOptions = {}
): Promise<{ data: WeatherForecast | null; cached: boolean }> {
  const result = await fetchGoogleWeather(lat, lng, {
    ...options,
    hourlyHorizon: 0,
    dailyHorizon: 0,
    includeCurrent: true,
  })

  // Return only current conditions (first entry)
  return {
    data: result.data[0] || null,
    cached: result.cached,
  }
}

/**
 * Fetch hourly forecasts only (no daily or current)
 *
 * @param lat - Latitude
 * @param lng - Longitude
 * @param hours - Number of hours to fetch (default: 168 = 7 days)
 * @param options - Fetch options
 * @returns Array of hourly forecasts
 */
export async function fetchGoogleHourlyWeather(
  lat: number,
  lng: number,
  hours = 168,
  options: FetchGoogleWeatherOptions = {}
): Promise<{ data: WeatherForecast[]; cached: boolean }> {
  return fetchGoogleWeather(lat, lng, {
    ...options,
    hourlyHorizon: hours,
    dailyHorizon: 0,
    includeCurrent: false,
  })
}

/**
 * Clear Google Weather cache
 * Useful for testing or forcing fresh data
 */
export function clearGoogleWeatherCache(): void {
  cache.clear()
}

/**
 * Get cache statistics
 * Useful for monitoring cache performance
 */
export function getGoogleWeatherCacheStats(): {
  size: number
  entries: Array<{ coords: string; age: number; forecastCount: number }>
} {
  const entries = Array.from(cache.entries()).map(([key, entry]) => ({
    coords: key.replace('google:', ''),
    age: Date.now() - entry.timestamp,
    forecastCount: entry.data.length,
  }))

  return {
    size: cache.size,
    entries,
  }
}
