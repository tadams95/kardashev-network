// Open-Meteo API client for solar irradiance data

import type { OpenMeteoResponse, SolarData, SolarRequestParams } from '@/types/solar'

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

function transformResponse(response: OpenMeteoResponse): SolarData {
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
  })) ?? []

  // Get today's sunrise/sunset (first entry in daily arrays)
  const sunrise = response.daily?.sunrise?.[0] ?? ''
  const sunset = response.daily?.sunset?.[0] ?? ''

  return {
    current: {
      ghi: currentGhi,
      dni: currentDni,
      cloudCover: currentCloud,
      isDay,
    },
    hourly,
    daily: {
      sunrise,
      sunset,
    },
    location: {
      latitude: response.latitude,
      longitude: response.longitude,
      timezone: response.timezone,
      elevation: response.elevation,
    },
  }
}

export async function fetchSolarData(
  params: SolarRequestParams
): Promise<{ data: SolarData; cached: boolean }> {
  const { lat, lng, hours = 24 } = params

  // Check cache first
  const cached = getFromCache(lat, lng)
  if (cached) {
    return { data: cached, cached: true }
  }

  // Build API URL
  const url = new URL(OPEN_METEO_BASE_URL)
  url.searchParams.set('latitude', lat.toString())
  url.searchParams.set('longitude', lng.toString())
  url.searchParams.set('current', 'shortwave_radiation,direct_normal_irradiance,cloud_cover,is_day')
  url.searchParams.set('hourly', 'shortwave_radiation,direct_normal_irradiance,cloud_cover')
  url.searchParams.set('daily', 'sunrise,sunset')
  url.searchParams.set('forecast_hours', hours.toString())
  url.searchParams.set('timezone', 'auto')

  const response = await fetch(url.toString())

  if (!response.ok) {
    throw new Error(`Open-Meteo API error: ${response.status} ${response.statusText}`)
  }

  const rawData: OpenMeteoResponse = await response.json()
  const solarData = transformResponse(rawData)

  // Store in cache
  setCache(lat, lng, solarData)

  return { data: solarData, cached: false }
}

// Export cache utilities for testing/debugging
export function clearCache(): void {
  cache.clear()
}

export function getCacheSize(): number {
  return cache.size
}
