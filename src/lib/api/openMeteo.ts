// Open-Meteo API client for solar irradiance data

import type { DailyForecast, OpenMeteoResponse, SolarData, SolarRequestParams } from '@/types/solar'
import { getWeatherDescription } from '@/lib/weather'

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

function getFromCache(lat: number, lng: number): SolarData | null {
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

function setCache(lat: number, lng: number, data: SolarData): void {
  const key = getCacheKey(lat, lng)
  cache.set(key, { data, timestamp: Date.now() })

  // Prevent memory leak: limit cache size
  if (cache.size > 1000) {
    const firstKey = cache.keys().next().value
    if (firstKey) cache.delete(firstKey)
  }
}

// Convert MJ/m²/day → estimated kWh using default roof assumptions
// 150m² roof × 0.65 usable fraction × 0.20 panel efficiency × 0.86 system factor / 3.6 MJ→kWh
function estimateDailyKwh(radiationSumMJ: number): number {
  return radiationSumMJ * 150 * 0.65 * 0.20 * 0.86 / 3.6
}

function transformResponse(response: OpenMeteoResponse, premium = false): SolarData {
  const now = new Date()
  const currentHourIndex = response.hourly?.time?.findIndex(time => {
    const hourTime = new Date(time)
    return hourTime.getHours() === now.getHours() &&
           hourTime.getDate() === now.getDate()
  }) ?? 0

  // Get current values (fallback to first hour if current not found)
  const idx = currentHourIndex >= 0 ? currentHourIndex : 0

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
      current.windSpeed = response.current.wind_speed_10m
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
          estimatedKwh: estimateDailyKwh(radiationSum),
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
    const cached = getFromCache(lat, lng)
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
    + (premium ? ',diffuse_radiation' : '')
  url.searchParams.set('hourly', hourlyParams)

  // Daily params
  const dailyParams = 'sunrise,sunset'
    + (premium ? ',weather_code,shortwave_radiation_sum' : '')
  url.searchParams.set('daily', dailyParams)

  url.searchParams.set('forecast_hours', hours.toString())
  if (premium) {
    url.searchParams.set('forecast_days', '7')
  }
  url.searchParams.set('timezone', 'auto')

  const response = await fetch(url.toString())

  if (!response.ok) {
    throw new Error(`Open-Meteo API error: ${response.status} ${response.statusText}`)
  }

  const rawData: OpenMeteoResponse = await response.json()
  const solarData = transformResponse(rawData, premium)

  // Store in cache
  setCache(lat, lng, solarData)

  return { data: solarData, cached: false }
}
