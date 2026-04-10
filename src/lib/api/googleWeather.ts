// Google Weather API client
// Fetches AI-powered weather forecasts using Google's MetNet model

import type { GoogleWeatherResponse, WeatherForecast } from '@/types/weather'
import { rget, rset } from '@/lib/cache/redis'

const GOOGLE_WEATHER_API_BASE = 'https://weather.googleapis.com/v1'
const GOOGLE_API_KEY = process.env.GOOGLE_MAPS_API_KEY

// In-memory cache with TTL
interface CacheEntry {
  data: WeatherForecast[]
  timestamp: number
}

const cache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 15 * 60 * 1000 // 15 minutes

// One-shot response probe: dump the full raw forecastDays response body for
// the first successful daily fetch per location. The v1 days:lookup endpoint
// is undocumented at the field level; the daily transformer currently
// hardcodes cloudCover/humidity/windSpeed/windDirection/visibility to
// undefined because we don't know whether the response contains daily
// aggregates. Capture evidence before deciding whether to expand the parser.
// See the atmospheric variable recon at .claude/plans/silly-wiggling-ocean.md.
const probedDailyLocations = new Set<string>()

function getCacheKey(lat: number, lng: number): string {
  // Round to 2 decimal places for cache key (~1km precision)
  return `google:${lat.toFixed(2)},${lng.toFixed(2)}`
}

const REDIS_PREFIX = 'gweather:'
const REDIS_TTL_S = 900

async function getFromCache(lat: number, lng: number): Promise<WeatherForecast[] | null> {
  const key = getCacheKey(lat, lng)
  // L1: in-memory Map
  const entry = cache.get(key)
  if (entry && Date.now() - entry.timestamp <= CACHE_TTL_MS) return entry.data

  // L2: Redis
  const redisData = await rget<WeatherForecast[]>(REDIS_PREFIX + key)
  if (redisData) {
    cache.set(key, { data: redisData, timestamp: Date.now() })
    return redisData
  }

  if (entry) cache.delete(key)
  return null
}

async function setCache(lat: number, lng: number, data: WeatherForecast[]): Promise<void> {
  const key = getCacheKey(lat, lng)
  cache.set(key, { data, timestamp: Date.now() })

  // Prevent memory leak: limit cache size
  if (cache.size > 1000) {
    const firstKey = cache.keys().next().value
    if (firstKey) cache.delete(firstKey)
  }

  await rset(REDIS_PREFIX + key, data, REDIS_TTL_S)
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
 * Map Google Weather v1 weatherCondition.type string to WMO numeric code
 * Used by transformGoogleWeatherV1Response since v1 returns string enums, not numeric codes
 */
function mapGoogleConditionTypeToWMO(type: string | undefined): number {
  if (!type) return 0
  const typeMap: Record<string, number> = {
    'CLEAR': 0,
    'MOSTLY_CLEAR': 1,
    'PARTLY_CLOUDY': 2,
    'CLOUDY': 3,
    'FOG': 45,
    'LIGHT_FOG': 45,
    'DRIZZLE': 51,
    'LIGHT_RAIN': 61,
    'RAIN': 63,
    'HEAVY_RAIN': 65,
    'SNOW': 71,
    'LIGHT_SNOW': 71,
    'HEAVY_SNOW': 75,
    'FLURRIES': 77,
    'FREEZING_DRIZZLE': 56,
    'FREEZING_RAIN': 66,
    'HEAVY_FREEZING_RAIN': 67,
    'ICE_PELLETS': 77,
    'THUNDERSTORM': 95,
  }
  return typeMap[type] ?? 0
}

/**
 * Transform Google Weather API v1 daily forecast response to WeatherForecast array.
 * Uses forecast/days:lookup which provides TRUE daily min/max temperatures
 * computed server-side across the full 24-hour period — unlike hourly data
 * which only covers future hours from "now" and misses past extremes.
 */
function transformGoogleWeatherDailyResponse(
  response: any,
  lat: number,
  lng: number
): WeatherForecast[] {
  const forecasts: WeatherForecast[] = []

  if (!response.forecastDays || response.forecastDays.length === 0) {
    console.warn('No forecast days in Google Weather v1 daily response')
    return forecasts
  }

  for (const day of response.forecastDays) {
    try {
      // Build timestamp from interval or displayDate
      let timestamp: string
      if (day.interval?.startTime) {
        timestamp = day.interval.startTime
      } else if (day.displayDate) {
        const { year, month, day: d } = day.displayDate
        timestamp = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}T12:00:00Z`
      } else {
        continue
      }

      const maxTemp = day.maxTemperature?.degrees
      const minTemp = day.minTemperature?.degrees
      if (maxTemp == null || minTemp == null) continue

      const dataAge = Date.now() - new Date(timestamp).getTime()

      // Use daytime forecast for conditions/precipitation, fall back to nighttime
      const dayForecast = day.daytimeForecast || day.nighttimeForecast || {}
      const precipProb = dayForecast.precipitation?.probability?.percent
      // FA-06: Google Weather v1 qpf.quantity is in mm — convert to inches for probability model
      // No unit enum observed in API responses; 0.03937 = mm → inches
      const precipAmountMm = dayForecast.precipitation?.qpf?.quantity
      const precipAmount = typeof precipAmountMm === 'number' ? precipAmountMm * 0.03937 : undefined

      forecasts.push({
        location: { lat, lng },
        timestamp,
        temperature: {
          current: (maxTemp + minTemp) / 2,
          min: minTemp,
          max: maxTemp,
        },
        precipitation: {
          probability: typeof precipProb === 'number' ? precipProb / 100 : 0,
          amount: precipAmount ?? 0,
        },
        conditions: dayForecast.weatherCondition?.description || 'Unknown',
        weatherCode: mapGoogleConditionTypeToWMO(dayForecast.weatherCondition?.type),
        cloudCover: undefined,
        humidity: undefined,
        windSpeed: undefined,
        windDirection: undefined,
        visibility: undefined,
        source: 'Google-Weather',
        dataAge,
        confidence: 85,
      })
    } catch (err) {
      console.warn('Error processing Google Weather v1 daily forecast:', err)
    }
  }

  return forecasts
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

      const temp = hour.temperature?.degrees ?? 0
      const dataAge = Date.now() - new Date(timestamp).getTime()

      // Safely extract precipitation probability (0-100 range from API)
      const precipProb = hour.precipitation?.probability?.percent
      // FA-06: Google Weather v1 qpf.quantity is in mm (no unit enum observed in responses).
      // 0.03937 = mm → inches. If unit enum is ever present, branch on it here.
      const precipAmountMm = hour.precipitation?.qpf?.quantity
      const precipAmount = typeof precipAmountMm === 'number' ? precipAmountMm * 0.03937 : undefined

      forecasts.push({
        location: { lat, lng },
        timestamp,
        temperature: {
          current: temp,
          min: temp,
          max: temp,
          apparent: hour.feelsLikeTemperature?.degrees ?? temp,
        },
        precipitation: {
          probability: typeof precipProb === 'number' ? precipProb / 100 : 0,
          amount: precipAmount ?? 0,
        },
        conditions: hour.weatherCondition?.description || 'Unknown',
        weatherCode: mapGoogleConditionTypeToWMO(hour.weatherCondition?.type),
        cloudCover: hour.cloudCover ?? 0,
        humidity: hour.relativeHumidity ?? 0,
        // FA-05: Google Weather v1 wind.speed.value is in km/h (confirmed from API responses).
        // 0.621371 = km/h → mph. If Google changes to m/s, factor would be 2.23694.
        windSpeed: hour.wind?.speed?.value != null ? hour.wind.speed.value * 0.621371 : undefined,
        windDirection: hour.wind?.direction?.degrees || 0,
        visibility: hour.visibility?.distance || 0,
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
          amount: (hourly.values.precipitationAmount || 0) * 0.03937, // mm → inches
          intensity: hourly.values.precipitationIntensity,
        },
        conditions: mapGoogleConditionCode(hourly.values.weatherCode),
        weatherCode: hourly.values.weatherCode,
        cloudCover: hourly.values.cloudCover,
        humidity: hourly.values.humidity,
        windSpeed: hourly.values.windSpeed != null ? hourly.values.windSpeed * 0.621371 : undefined,
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
          amount: daily.values.precipitationAmountSum * 0.03937, // mm → inches
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
      windSpeed: response.current.values.windSpeed != null ? response.current.values.windSpeed * 0.621371 : undefined,
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
    const cached = await getFromCache(lat, lng)
    if (cached) {
      return { data: cached, cached: true }
    }
  }

  try {
    console.log(`🌤️  Fetching Google Weather for (${lat}, ${lng})`)

    // Build API URL for hourly forecast
    const hourlyUrl = new URL(`${GOOGLE_WEATHER_API_BASE}/forecast/hours:lookup`)
    hourlyUrl.searchParams.set('location.latitude', lat.toString())
    hourlyUrl.searchParams.set('location.longitude', lng.toString())
    hourlyUrl.searchParams.set('key', GOOGLE_API_KEY)

    if (hourlyHorizon > 0) {
      hourlyUrl.searchParams.set('hours', Math.min(hourlyHorizon, 240).toString())
    }

    // Build API URL for daily forecast (true daily min/max)
    const dailyUrl = new URL(`${GOOGLE_WEATHER_API_BASE}/forecast/days:lookup`)
    dailyUrl.searchParams.set('location.latitude', lat.toString())
    dailyUrl.searchParams.set('location.longitude', lng.toString())
    dailyUrl.searchParams.set('key', GOOGLE_API_KEY)
    dailyUrl.searchParams.set('days', Math.min(dailyHorizon, 10).toString())

    console.log(`  Endpoints: hours:lookup + days:lookup`)

    // Fetch both endpoints in parallel with shared timeout
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30000) // 30s timeout

    const fetchOptions = {
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
    }

    const [hourlyResponse, dailyResponse] = await Promise.all([
      fetch(hourlyUrl.toString(), fetchOptions),
      fetch(dailyUrl.toString(), fetchOptions).catch(err => {
        // Daily endpoint failure is non-fatal — fall back to hourly-only
        console.warn(`  ⚠️  Google Weather daily fetch failed, using hourly only:`, err.message)
        return null
      }),
    ])

    clearTimeout(timeout)

    // Handle hourly error responses
    if (!hourlyResponse.ok) {
      console.error(`  ❌ Google Weather API error: ${hourlyResponse.status} ${hourlyResponse.statusText}`)

      if (hourlyResponse.status === 403) {
        throw new Error(
          'Google Weather API access denied. Please ensure the API is enabled in your Google Cloud Console. ' +
          'Visit: https://console.cloud.google.com/apis/library/weather.googleapis.com'
        )
      }

      if (hourlyResponse.status === 404) {
        // No weather data available for this location - return empty array
        console.warn(`  ⚠️  No Google Weather data available for (${lat}, ${lng})`)
        return { data: [], cached: false }
      }

      if (hourlyResponse.status === 429) {
        throw new Error('Google Weather API rate limit exceeded. Please wait and try again.')
      }

      if (hourlyResponse.status >= 500) {
        // Server error - retry once after short delay
        console.warn(`  ⚠️  Server error, retrying in 1s...`)
        await new Promise(resolve => setTimeout(resolve, 1000))

        const retryResponse = await fetch(hourlyUrl.toString(), {
          headers: { 'Content-Type': 'application/json' },
        })

        if (!retryResponse.ok) {
          throw new Error(`Google Weather API server error: ${retryResponse.status}`)
        }

        const retryData = await retryResponse.json()
        console.log(`  ✅ Retry successful: ${retryData.forecastHours?.length || 0} hours`)
        const forecasts = transformGoogleWeatherV1Response(retryData, lat, lng)
        await setCache(lat, lng, forecasts)
        return { data: forecasts, cached: false }
      }

      throw new Error(`Google Weather API error: ${hourlyResponse.status} ${hourlyResponse.statusText}`)
    }

    // Parse hourly response
    const hourlyData = await hourlyResponse.json()
    const hourlyForecasts = transformGoogleWeatherV1Response(hourlyData, lat, lng)
    console.log(`  ✅ Received ${hourlyData.forecastHours?.length || 0} hourly forecasts`)

    // Parse daily response (if available)
    let dailyForecasts: WeatherForecast[] = []
    if (dailyResponse && dailyResponse.ok) {
      const dailyData = await dailyResponse.json()

      // One-shot response probe (see probedDailyLocations comment above)
      const probeKey = `${lat.toFixed(2)},${lng.toFixed(2)}`
      if (!probedDailyLocations.has(probeKey)) {
        probedDailyLocations.add(probeKey)
        try {
          const firstDay = (dailyData as { forecastDays?: unknown[] }).forecastDays?.[0]
          console.log(
            `[google-daily-probe] loc=${probeKey} first-day-keys=${
              firstDay && typeof firstDay === 'object'
                ? Object.keys(firstDay as Record<string, unknown>).join(',')
                : 'none'
            }`
          )
          if (firstDay && typeof firstDay === 'object') {
            const fd = firstDay as Record<string, unknown>
            if (fd.daytimeForecast && typeof fd.daytimeForecast === 'object') {
              console.log(
                `[google-daily-probe] loc=${probeKey} daytimeForecast-keys=${Object.keys(
                  fd.daytimeForecast as Record<string, unknown>
                ).join(',')}`
              )
            }
            if (fd.nighttimeForecast && typeof fd.nighttimeForecast === 'object') {
              console.log(
                `[google-daily-probe] loc=${probeKey} nighttimeForecast-keys=${Object.keys(
                  fd.nighttimeForecast as Record<string, unknown>
                ).join(',')}`
              )
            }
          }
          console.log(`[google-daily-probe] loc=${probeKey} full-response=${JSON.stringify(dailyData)}`)
        } catch (probeErr) {
          console.warn(`[google-daily-probe] loc=${probeKey} dump-failed`, probeErr)
        }
      }

      dailyForecasts = transformGoogleWeatherDailyResponse(dailyData, lat, lng)
      console.log(`  ✅ Received ${dailyData.forecastDays?.length || 0} daily forecasts (true min/max)`)
    } else if (dailyResponse && !dailyResponse.ok) {
      console.warn(`  ⚠️  Google Weather daily endpoint returned ${dailyResponse.status}, using hourly only`)
    }

    // Combine: daily forecasts (true min/max) + hourly forecasts (intra-day resolution)
    // Daily aggregates take precedence in groupForecastsByDay via the min !== max check
    const forecasts = [...dailyForecasts, ...hourlyForecasts]

    // Store in cache
    await setCache(lat, lng, forecasts)

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
