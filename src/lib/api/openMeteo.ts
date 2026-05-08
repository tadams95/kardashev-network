// Open-Meteo API client for solar irradiance and weather forecast data

import type { DailyForecast, OpenMeteoResponse, SolarData, SolarRequestParams } from '@/types/solar'
import type { OpenMeteoWeatherResponse, WeatherForecast } from '@/types/weather'
import { getWeatherDescription } from '@/lib/weather'
import { estimateKwhFromRadiation } from '@/lib/calculations/solarValue'
import { rget, rset } from '@/lib/cache/redis'

const OPEN_METEO_BASE_URL = 'https://api.open-meteo.com/v1/forecast'

// Simple in-memory cache with TTL
interface CacheEntry {
  data: SolarData
  timestamp: number
}

const cache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

function getCacheKey(lat: number, lng: number): string {
  // Round to 2 decimal places for cache key (roughly ~1km precision)
  return `${lat.toFixed(2)},${lng.toFixed(2)}`
}

const REDIS_SOLAR_PREFIX = 'solar:'
const REDIS_SOLAR_TTL_S = 300

async function getFromCache(lat: number, lng: number): Promise<SolarData | null> {
  const key = getCacheKey(lat, lng)
  // L1: in-memory Map
  const entry = cache.get(key)
  if (entry && Date.now() - entry.timestamp <= CACHE_TTL_MS) return entry.data

  // L2: Redis
  const redisData = await rget<SolarData>(REDIS_SOLAR_PREFIX + key)
  if (redisData) {
    cache.set(key, { data: redisData, timestamp: Date.now() })
    return redisData
  }

  // Expired L1 entry — clean up
  if (entry) cache.delete(key)
  return null
}

async function setCache(lat: number, lng: number, data: SolarData): Promise<void> {
  const key = getCacheKey(lat, lng)
  cache.set(key, { data, timestamp: Date.now() })

  // Prevent memory leak: limit cache size
  if (cache.size > 1000) {
    const firstKey = cache.keys().next().value
    if (firstKey) cache.delete(firstKey)
  }

  await rset(REDIS_SOLAR_PREFIX + key, data, REDIS_SOLAR_TTL_S)
}

function transformResponse(response: OpenMeteoResponse, premium = false): SolarData {
  // Open-Meteo returns current.time and hourly.time in the location's timezone.
  // Direct string match by hour prefix avoids all timezone parsing pitfalls.
  let currentHourIndex = 0
  if (response.current?.time && response.hourly?.time) {
    const currentHourPrefix = response.current.time.slice(0, 13) // "2024-01-15T14"
    const found = response.hourly.time.findIndex(t => t.slice(0, 13) === currentHourPrefix)
    if (found >= 0) currentHourIndex = found
  }

  // Get current values (fallback to first hour if current not found)
  const idx = currentHourIndex

  const currentGhi = response.current?.shortwave_radiation ??
                     response.hourly?.shortwave_radiation?.[idx] ?? 0
  const currentDni = response.current?.direct_normal_irradiance ??
                     response.hourly?.direct_normal_irradiance?.[idx] ?? 0
  const currentCloud = response.current?.cloud_cover ??
                       response.hourly?.cloud_cover?.[idx] ?? 0
  const isDay = response.current?.is_day === 1 || currentGhi > 0

  // Transform hourly data
  const hourly = response.hourly?.time?.map((time, i) => ({
    time,
    ghi: response.hourly?.shortwave_radiation?.[i] ?? 0,
    dni: response.hourly?.direct_normal_irradiance?.[i] ?? 0,
    cloudCover: response.hourly?.cloud_cover?.[i] ?? 0,
    ...(premium && response.hourly?.diffuse_radiation ? {
      diffuseRadiation: response.hourly.diffuse_radiation[i] ?? 0,
    } : {}),
    ...(premium && response.hourly?.temperature_2m ? {
      temperature: response.hourly.temperature_2m[i],
    } : {}),
  })) ?? []

  // Get today's sunrise/sunset (first entry in daily arrays)
  const sunrise = response.daily?.sunrise?.[0] ?? ''
  const sunset = response.daily?.sunset?.[0] ?? ''

  // Build current object with optional premium fields
  const current: SolarData['current'] = {
    ghi: currentGhi,
    dni: currentDni,
    cloudCover: currentCloud,
    isDay,
  }

  if (premium) {
    if (response.current?.weather_code !== undefined) {
      current.weatherCode = response.current.weather_code
      current.weatherDescription = getWeatherDescription(response.current.weather_code)
    }
    if (response.current?.temperature_2m !== undefined) {
      current.temperature = response.current.temperature_2m
      // Thermal efficiency: -0.4% per °C above 25°C, capped at 0-100%
      current.thermalEfficiency = Math.min(100, Math.max(0, 100 - (response.current.temperature_2m - 25) * 0.4))
    }
    if (response.current?.wind_speed_10m !== undefined) {
      current.windSpeed = response.current.wind_speed_10m * 0.621371
    }
    if (response.current?.diffuse_radiation !== undefined) {
      current.diffuseRadiation = response.current.diffuse_radiation
    }
  }

  // Build 7-day forecast from daily data when premium
  let forecast: DailyForecast[] | undefined
  if (premium && response.daily?.time && response.daily.time.length > 0) {
    const dailyTimes = response.daily.time
    const dailyWeatherCodes = response.daily.weather_code
    const dailyRadiationSums = response.daily.shortwave_radiation_sum
    const dailySunrises = response.daily.sunrise
    const dailySunsets = response.daily.sunset

    if (dailyWeatherCodes && dailyRadiationSums) {
      forecast = dailyTimes.map((date, i) => {
        const radiationSum = dailyRadiationSums[i] ?? 0
        return {
          date,
          weatherCode: dailyWeatherCodes[i] ?? 0,
          weatherDescription: getWeatherDescription(dailyWeatherCodes[i] ?? 0),
          radiationSum,
          estimatedKwh: estimateKwhFromRadiation(radiationSum),
          sunrise: dailySunrises?.[i] ?? '',
          sunset: dailySunsets?.[i] ?? '',
        }
      })
    }
  }

  return {
    current,
    hourly,
    daily: {
      sunrise,
      sunset,
    },
    ...(forecast ? { forecast } : {}),
    currentDate: response.current?.time?.slice(0, 10),
    location: {
      latitude: response.latitude,
      longitude: response.longitude,
      timezone: response.timezone,
      elevation: response.elevation,
    },
  }
}

export interface FetchSolarOptions {
  bypassCache?: boolean
  premium?: boolean
}

export async function fetchSolarData(
  params: SolarRequestParams,
  options: FetchSolarOptions = {}
): Promise<{ data: SolarData; cached: boolean }> {
  const { lat, lng, hours = 24 } = params
  const { bypassCache = false, premium = false } = options

  // Check cache first (skip for paid tier requests)
  if (!bypassCache) {
    const cached = await getFromCache(lat, lng)
    if (cached) {
      return { data: cached, cached: true }
    }
  }

  // Build API URL
  const url = new URL(OPEN_METEO_BASE_URL)
  url.searchParams.set('latitude', lat.toString())
  url.searchParams.set('longitude', lng.toString())

  // Current params
  const currentParams = 'shortwave_radiation,direct_normal_irradiance,cloud_cover,is_day'
    + (premium ? ',weather_code,temperature_2m,wind_speed_10m,diffuse_radiation' : '')
  url.searchParams.set('current', currentParams)

  // Hourly params
  const hourlyParams = 'shortwave_radiation,direct_normal_irradiance,cloud_cover'
    + (premium ? ',diffuse_radiation,temperature_2m' : '')
  url.searchParams.set('hourly', hourlyParams)

  // Daily params
  const dailyParams = 'sunrise,sunset'
    + (premium ? ',weather_code,shortwave_radiation_sum' : '')
  url.searchParams.set('daily', dailyParams)

  url.searchParams.set('precipitation_unit', 'inch')
  url.searchParams.set('forecast_hours', hours.toString())
  if (premium) {
    url.searchParams.set('forecast_days', '7')
  }
  url.searchParams.set('timezone', 'auto')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30000)
  const response = await fetch(url.toString(), { signal: controller.signal })
  clearTimeout(timeout)

  if (!response.ok) {
    throw new Error(`Open-Meteo API error: ${response.status} ${response.statusText}`)
  }

  const rawData: OpenMeteoResponse = await response.json()
  const solarData = transformResponse(rawData, premium)

  // Store in cache
  await setCache(lat, lng, solarData)

  return { data: solarData, cached: false }
}

// ============================================================================
// Weather Forecast Extension
// ============================================================================

// Separate cache for weather forecast data
interface WeatherCacheEntry {
  data: WeatherForecast[]
  timestamp: number
}

const weatherCache = new Map<string, WeatherCacheEntry>()

function getWeatherCacheKey(lat: number, lng: number): string {
  return `${lat.toFixed(2)},${lng.toFixed(2)}`
}

const REDIS_WEATHER_PREFIX = 'weather:'
const REDIS_WEATHER_TTL_S = 300

async function getWeatherFromCache(lat: number, lng: number): Promise<WeatherForecast[] | null> {
  const key = getWeatherCacheKey(lat, lng)
  // L1: in-memory Map
  const entry = weatherCache.get(key)
  if (entry && Date.now() - entry.timestamp <= CACHE_TTL_MS) return entry.data

  // L2: Redis
  const redisData = await rget<WeatherForecast[]>(REDIS_WEATHER_PREFIX + key)
  if (redisData) {
    weatherCache.set(key, { data: redisData, timestamp: Date.now() })
    return redisData
  }

  if (entry) weatherCache.delete(key)
  return null
}

async function setWeatherCache(lat: number, lng: number, data: WeatherForecast[]): Promise<void> {
  const key = getWeatherCacheKey(lat, lng)
  weatherCache.set(key, { data, timestamp: Date.now() })

  // Prevent memory leak: limit cache size
  if (weatherCache.size > 1000) {
    const firstKey = weatherCache.keys().next().value
    if (firstKey) weatherCache.delete(firstKey)
  }

  await rset(REDIS_WEATHER_PREFIX + key, data, REDIS_WEATHER_TTL_S)
}

/**
 * Transform Open-Meteo weather response to WeatherForecast array
 */
function transformWeatherResponse(
  response: OpenMeteoWeatherResponse,
  lat: number,
  lng: number
): WeatherForecast[] {
  const forecasts: WeatherForecast[] = []

  // Compute timezone offset string from utc_offset_seconds
  const offsetSec = response.utc_offset_seconds
  const sign = offsetSec >= 0 ? '+' : '-'
  const absOff = Math.abs(offsetSec)
  const hh = String(Math.floor(absOff / 3600)).padStart(2, '0')
  const mm = String(Math.floor((absOff % 3600) / 60)).padStart(2, '0')
  const tzOffset = `${sign}${hh}:${mm}`

  // Add current conditions if available
  if (response.current) {
    const currentTimestamp = response.current.time.length === 16
      ? response.current.time + ':00' + tzOffset
      : response.current.time + tzOffset
    const dataAge = Date.now() - new Date(currentTimestamp).getTime()

    forecasts.push({
      location: {
        lat,
        lng,
        timezone: response.timezone,
      },
      timestamp: currentTimestamp,
      temperature: {
        current: response.current.temperature_2m,
        min: response.current.temperature_2m,
        max: response.current.temperature_2m,
      },
      precipitation: {
        probability: response.current.precipitation_probability !== undefined
          ? response.current.precipitation_probability / 100
          : 0,
        amount: response.current.precipitation,
      },
      conditions: getWeatherDescription(response.current.weather_code),
      weatherCode: response.current.weather_code,
      cloudCover: response.current.cloud_cover,
      cloudCoverLow: response.current.cloud_cover_low,
      cloudCoverMid: response.current.cloud_cover_mid,
      cloudCoverHigh: response.current.cloud_cover_high,
      humidity: response.current.relative_humidity_2m,
      dewPoint: response.current.dew_point_2m,
      pressure: response.current.pressure_msl,
      uvIndex: response.current.uv_index,
      windSpeed: response.current.wind_speed_10m != null
        ? response.current.wind_speed_10m * 0.621371 // km/h -> mph
        : undefined,
      windGust: response.current.wind_gusts_10m != null
        ? response.current.wind_gusts_10m * 0.621371 // km/h -> mph
        : undefined,
      windDirection: undefined,
      visibility: undefined,
      source: 'Open-Meteo',
      dataAge,
      confidence: 80, // Open-Meteo is reliable but not ground truth
    })
  }

  // Add hourly forecasts
  if (response.hourly?.time && response.hourly.time.length > 0) {
    for (let i = 0; i < response.hourly.time.length; i++) {
      const rawTime = response.hourly.time[i]
      const time = rawTime.length === 16 ? rawTime + ':00' + tzOffset : rawTime + tzOffset
      const dataAge = Date.now() - new Date(time).getTime()

      forecasts.push({
        location: {
          lat,
          lng,
          timezone: response.timezone,
        },
        timestamp: time,
        temperature: {
          current: response.hourly.temperature_2m[i],
          min: response.hourly.temperature_2m[i],
          max: response.hourly.temperature_2m[i],
        },
        precipitation: {
          probability: response.hourly.precipitation_probability[i] / 100,
          amount: response.hourly.precipitation[i],
        },
        conditions: getWeatherDescription(response.hourly.weather_code[i]),
        weatherCode: response.hourly.weather_code[i],
        cloudCover: response.hourly.cloud_cover?.[i],
        cloudCoverLow: response.hourly.cloud_cover_low?.[i],
        cloudCoverMid: response.hourly.cloud_cover_mid?.[i],
        cloudCoverHigh: response.hourly.cloud_cover_high?.[i],
        humidity: response.hourly.relative_humidity_2m?.[i],
        dewPoint: response.hourly.dew_point_2m?.[i],
        pressure: response.hourly.pressure_msl?.[i],
        uvIndex: response.hourly.uv_index?.[i],
        windSpeed: response.hourly.wind_speed_10m?.[i] != null
          ? (response.hourly.wind_speed_10m[i] as number) * 0.621371 // km/h -> mph
          : undefined,
        windGust: response.hourly.wind_gusts_10m?.[i] != null
          ? (response.hourly.wind_gusts_10m[i] as number) * 0.621371 // km/h -> mph
          : undefined,
        windDirection: undefined,
        visibility: undefined,
        source: 'Open-Meteo',
        dataAge,
        confidence: 75, // Forecast confidence decreases with time
      })
    }
  }

  // Add daily forecasts with min/max temperatures
  if (response.daily?.time && response.daily.time.length > 0) {
    for (let i = 0; i < response.daily.time.length; i++) {
      const rawDate = response.daily.time[i]
      const date = rawDate.length === 10 ? rawDate + 'T12:00:00' + tzOffset : rawDate + tzOffset
      const dataAge = Date.now() - new Date(date).getTime()

      forecasts.push({
        location: {
          lat,
          lng,
          timezone: response.timezone,
        },
        timestamp: date,
        temperature: {
          current: (response.daily.temperature_2m_max[i] + response.daily.temperature_2m_min[i]) / 2,
          min: response.daily.temperature_2m_min[i],
          max: response.daily.temperature_2m_max[i],
        },
        precipitation: {
          probability: response.daily.precipitation_probability_max[i] / 100,
          amount: response.daily.precipitation_sum[i],
        },
        conditions: getWeatherDescription(response.daily.weather_code[i]),
        weatherCode: response.daily.weather_code[i],
        cloudCover: response.daily.cloud_cover_mean?.[i],
        humidity: response.daily.relative_humidity_2m_mean?.[i],
        dewPoint: response.daily.dew_point_2m_mean?.[i],
        pressure: response.daily.pressure_msl_mean?.[i],
        uvIndex: response.daily.uv_index_max?.[i],
        windSpeed: response.daily.wind_speed_10m_max?.[i] != null
          ? (response.daily.wind_speed_10m_max[i] as number) * 0.621371 // km/h -> mph
          : undefined,
        windGust: response.daily.wind_gusts_10m_max?.[i] != null
          ? (response.daily.wind_gusts_10m_max[i] as number) * 0.621371 // km/h -> mph
          : undefined,
        windDirection: undefined,
        visibility: undefined,
        source: 'Open-Meteo',
        dataAge,
        confidence: 70, // Daily forecasts are less precise
      })
    }
  }

  return forecasts
}

export interface WeatherForecastParams {
  lat: number
  lng: number
  hours?: number  // Forecast horizon in hours (default: 168 = 7 days)
}

export interface FetchWeatherOptions {
  bypassCache?: boolean
}

/**
 * Fetch weather forecasts from Open-Meteo
 * Returns hourly and daily forecasts with temperature and precipitation data
 *
 * @param params - Coordinates and forecast horizon
 * @param options - Fetch options
 * @returns Array of weather forecasts
 */
export async function fetchWeatherForecast(
  params: WeatherForecastParams,
  options: FetchWeatherOptions = {}
): Promise<{ data: WeatherForecast[]; cached: boolean }> {
  const { lat, lng, hours = 168 } = params // Default 7 days
  const { bypassCache = false } = options

  // Validate coordinates
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw new Error('Invalid coordinates: latitude must be -90 to 90, longitude -180 to 180')
  }

  // Check cache first
  if (!bypassCache) {
    const cached = await getWeatherFromCache(lat, lng)
    if (cached) {
      return { data: cached, cached: true }
    }
  }

  // Build API URL
  const url = new URL(OPEN_METEO_BASE_URL)
  url.searchParams.set('latitude', lat.toString())
  url.searchParams.set('longitude', lng.toString())

  // Current weather parameters
  url.searchParams.set(
    'current',
    'temperature_2m,precipitation,precipitation_probability,weather_code,cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,relative_humidity_2m,dew_point_2m,pressure_msl,uv_index,wind_speed_10m,wind_gusts_10m'
  )

  // Hourly forecast parameters
  url.searchParams.set(
    'hourly',
    'temperature_2m,precipitation_probability,precipitation,weather_code,cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,relative_humidity_2m,dew_point_2m,pressure_msl,uv_index,wind_speed_10m,wind_gusts_10m'
  )

  // Daily forecast parameters
  url.searchParams.set(
    'daily',
    'temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,weather_code,cloud_cover_mean,relative_humidity_2m_mean,dew_point_2m_mean,pressure_msl_mean,uv_index_max,wind_speed_10m_max,wind_gusts_10m_max'
  )

  // Precipitation in inches (probability model expects inches)
  url.searchParams.set('precipitation_unit', 'inch')

  // Forecast horizon
  url.searchParams.set('forecast_hours', hours.toString())
  url.searchParams.set('forecast_days', Math.ceil(hours / 24).toString())
  // past_days=1 captures the prior 24h of hourly data so the atmospheric
  // pre-peak 24h precipitation window is fully populated even for short-lead
  // snapshots (target = today/tomorrow). Without this, captures close to peak
  // hour saw the pre-peak window mostly in the past — Open-Meteo only returns
  // future hourly forecasts by default — so prePeakPrecip24h was undefined on
  // ~half of snapshots. Verified empirically 2026-05-07: 51% precip coverage.
  url.searchParams.set('past_days', '1')
  url.searchParams.set('timezone', 'auto')

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30000)
    const response = await fetch(url.toString(), { signal: controller.signal })
    clearTimeout(timeout)

    if (!response.ok) {
      throw new Error(`Open-Meteo API error: ${response.status} ${response.statusText}`)
    }

    const rawData: OpenMeteoWeatherResponse = await response.json()
    const forecasts = transformWeatherResponse(rawData, lat, lng)

    // Store in cache
    await setWeatherCache(lat, lng, forecasts)

    return { data: forecasts, cached: false }
  } catch (error) {
    if (error instanceof Error) {
      throw error
    }
    throw new Error('Unknown error fetching Open-Meteo weather data')
  }
}
