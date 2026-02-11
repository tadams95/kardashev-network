// National Weather Service (NWS) API client
// Free, no API key required, provides ensemble spread data
// API docs: https://www.weather.gov/documentation/services-web-api

import type { WeatherForecast } from '@/types/weather'

const NWS_BASE_URL = 'https://api.weather.gov'
const USER_AGENT = 'KardashevNetwork/1.0 (weather-trading-model)'

// ============================================================================
// Types
// ============================================================================

interface NWSPointsResponse {
  properties: {
    gridId: string
    gridX: number
    gridY: number
    forecast: string
    forecastHourly: string
    forecastGridData: string
    relativeLocation: {
      properties: {
        city: string
        state: string
      }
    }
    timeZone: string
  }
}

interface NWSForecastResponse {
  properties: {
    updated: string
    generatedAt: string
    periods: Array<{
      number: number
      name: string
      startTime: string
      endTime: string
      isDaytime: boolean
      temperature: number
      temperatureUnit: 'F' | 'C'
      temperatureTrend: string | null
      probabilityOfPrecipitation: {
        unitCode: string
        value: number | null
      }
      windSpeed: string
      windDirection: string
      shortForecast: string
      detailedForecast: string
    }>
  }
}

interface NWSGridDataResponse {
  properties: {
    temperature: NWSGridSeries
    maxTemperature: NWSGridSeries
    minTemperature: NWSGridSeries
    quantitativePrecipitation: NWSGridSeries
    probabilityOfPrecipitation: NWSGridSeries
    skyCover: NWSGridSeries
    windSpeed: NWSGridSeries
  }
}

interface NWSGridSeries {
  uom: string
  values: Array<{
    validTime: string // ISO 8601 duration format: "2024-01-15T06:00:00+00:00/PT6H"
    value: number | null
  }>
}

// ============================================================================
// Cache
// ============================================================================

interface NWSCacheEntry {
  data: WeatherForecast[]
  timestamp: number
}

const nwsCache = new Map<string, NWSCacheEntry>()
const NWS_CACHE_TTL = 30 * 60 * 1000 // 30 minutes (NWS updates hourly)

function getCacheKey(lat: number, lng: number): string {
  return `${lat.toFixed(2)},${lng.toFixed(2)}`
}

// ============================================================================
// Unit Conversion
// ============================================================================

function fahrenheitToCelsius(f: number): number {
  return (f - 32) * 5 / 9
}

function celsiusFromUom(value: number, uom: string): number {
  if (uom.includes('degF') || uom.includes('fahrenheit')) {
    return fahrenheitToCelsius(value)
  }
  // NWS grid data uses wmoUnit:degC
  return value
}

function mmFromUom(value: number, uom: string): number {
  if (uom.includes('in') || uom.includes('inch')) {
    return value * 25.4
  }
  // NWS uses wmoUnit:mm for precipitation
  return value
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Fetch NWS grid metadata for a lat/lng point.
 * Returns grid office, grid coordinates, and forecast URLs.
 */
async function fetchGridPoint(lat: number, lng: number): Promise<NWSPointsResponse> {
  const url = `${NWS_BASE_URL}/points/${lat.toFixed(4)},${lng.toFixed(4)}`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30000)
  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'application/geo+json',
    },
    signal: controller.signal,
  })
  clearTimeout(timeout)

  if (!response.ok) {
    throw new Error(`NWS points API error: ${response.status} ${response.statusText}`)
  }

  return response.json()
}

/**
 * Fetch NWS forecast periods (human-readable, 12-hour periods).
 */
async function fetchForecast(forecastUrl: string): Promise<NWSForecastResponse> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30000)
  const response = await fetch(forecastUrl, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'application/geo+json',
    },
    signal: controller.signal,
  })
  clearTimeout(timeout)

  if (!response.ok) {
    throw new Error(`NWS forecast API error: ${response.status} ${response.statusText}`)
  }

  return response.json()
}

/**
 * Fetch NWS raw grid data (quantitative, hourly resolution).
 * Contains ensemble-derived data including probability of precipitation.
 */
async function fetchGridData(gridDataUrl: string): Promise<NWSGridDataResponse> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30000)
  const response = await fetch(gridDataUrl, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'application/geo+json',
    },
    signal: controller.signal,
  })
  clearTimeout(timeout)

  if (!response.ok) {
    throw new Error(`NWS grid data API error: ${response.status} ${response.statusText}`)
  }

  return response.json()
}

// ============================================================================
// NWS Grid Data → Daily Aggregation
// ============================================================================

interface DailyAggregate {
  date: string
  tempMax: number
  tempMin: number
  precipSum: number
  precipProbMax: number
  skyCoverAvg: number
}

/**
 * Aggregate NWS grid series data into daily values.
 */
function aggregateGridDataByDay(grid: NWSGridDataResponse): DailyAggregate[] {
  const dailyMap = new Map<string, {
    temps: number[]
    maxTemps: number[]
    minTemps: number[]
    precip: number[]
    precipProb: number[]
    skyCover: number[]
  }>()

  const tempUom = grid.properties.temperature?.uom || 'wmoUnit:degC'
  const precipUom = grid.properties.quantitativePrecipitation?.uom || 'wmoUnit:mm'

  // Helper to extract date from NWS validTime format
  function extractDate(validTime: string): string {
    return validTime.slice(0, 10) // "YYYY-MM-DD"
  }

  function ensureDay(date: string) {
    if (!dailyMap.has(date)) {
      dailyMap.set(date, {
        temps: [], maxTemps: [], minTemps: [],
        precip: [], precipProb: [], skyCover: [],
      })
    }
  }

  // Process temperature
  for (const v of grid.properties.temperature?.values || []) {
    if (v.value === null) continue
    const date = extractDate(v.validTime)
    ensureDay(date)
    dailyMap.get(date)!.temps.push(celsiusFromUom(v.value, tempUom))
  }

  // Process max temperature
  for (const v of grid.properties.maxTemperature?.values || []) {
    if (v.value === null) continue
    const date = extractDate(v.validTime)
    ensureDay(date)
    dailyMap.get(date)!.maxTemps.push(celsiusFromUom(v.value, tempUom))
  }

  // Process min temperature
  for (const v of grid.properties.minTemperature?.values || []) {
    if (v.value === null) continue
    const date = extractDate(v.validTime)
    ensureDay(date)
    dailyMap.get(date)!.minTemps.push(celsiusFromUom(v.value, tempUom))
  }

  // Process precipitation
  for (const v of grid.properties.quantitativePrecipitation?.values || []) {
    if (v.value === null) continue
    const date = extractDate(v.validTime)
    ensureDay(date)
    dailyMap.get(date)!.precip.push(mmFromUom(v.value, precipUom))
  }

  // Process precip probability
  for (const v of grid.properties.probabilityOfPrecipitation?.values || []) {
    if (v.value === null) continue
    const date = extractDate(v.validTime)
    ensureDay(date)
    dailyMap.get(date)!.precipProb.push(v.value) // Already 0-100
  }

  // Process sky cover
  for (const v of grid.properties.skyCover?.values || []) {
    if (v.value === null) continue
    const date = extractDate(v.validTime)
    ensureDay(date)
    dailyMap.get(date)!.skyCover.push(v.value)
  }

  // Convert to daily aggregates
  const result: DailyAggregate[] = []
  for (const [date, data] of dailyMap) {
    const allTemps = [...data.temps, ...data.maxTemps, ...data.minTemps]
    if (allTemps.length === 0) continue

    const tempMax = data.maxTemps.length > 0
      ? Math.max(...data.maxTemps)
      : Math.max(...allTemps)
    const tempMin = data.minTemps.length > 0
      ? Math.min(...data.minTemps)
      : Math.min(...allTemps)

    result.push({
      date,
      tempMax,
      tempMin,
      precipSum: data.precip.reduce((s, v) => s + v, 0),
      precipProbMax: data.precipProb.length > 0 ? Math.max(...data.precipProb) : 0,
      skyCoverAvg: data.skyCover.length > 0
        ? data.skyCover.reduce((s, v) => s + v, 0) / data.skyCover.length
        : 50,
    })
  }

  // Sort by date
  result.sort((a, b) => a.date.localeCompare(b.date))
  return result
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Fetch NWS weather forecasts for a location.
 * Returns normalized WeatherForecast array (one per day, up to 7 days).
 *
 * NWS is free, requires no API key, and provides ensemble-derived data
 * including probability of precipitation from the NDFD ensemble.
 *
 * @param lat - Latitude
 * @param lng - Longitude
 * @returns Array of daily weather forecasts
 */
export async function fetchNWSForecast(
  lat: number,
  lng: number
): Promise<{ data: WeatherForecast[]; cached: boolean }> {
  const cacheKey = getCacheKey(lat, lng)

  // Check cache
  const cached = nwsCache.get(cacheKey)
  if (cached && (Date.now() - cached.timestamp) < NWS_CACHE_TTL) {
    const age = Date.now() - cached.timestamp
    const data = cached.data.map(f => ({ ...f, dataAge: age }))
    return { data, cached: true }
  }

  try {
    // Step 1: Get grid point metadata
    const gridPoint = await fetchGridPoint(lat, lng)

    // Step 2: Fetch raw grid data (more useful than human-readable forecast)
    const gridData = await fetchGridData(gridPoint.properties.forecastGridData)

    // Step 3: Aggregate into daily forecasts
    const dailyData = aggregateGridDataByDay(gridData)

    // Step 4: Convert to WeatherForecast format
    const fetchTime = Date.now()
    const forecasts: WeatherForecast[] = dailyData.map(day => {
      const skyCover = day.skyCoverAvg
      let conditions: string
      if (skyCover < 20) conditions = 'Clear'
      else if (skyCover < 50) conditions = 'Partly Cloudy'
      else if (skyCover < 80) conditions = 'Mostly Cloudy'
      else conditions = 'Overcast'

      if (day.precipProbMax > 60) {
        conditions = day.tempMin < 0 ? 'Snow' : 'Rain'
      }

      return {
        location: {
          lat,
          lng,
          city: gridPoint.properties.relativeLocation?.properties?.city,
          timezone: gridPoint.properties.timeZone,
        },
        timestamp: `${day.date}T12:00:00Z`,
        temperature: {
          current: (day.tempMax + day.tempMin) / 2,
          min: day.tempMin,
          max: day.tempMax,
        },
        precipitation: {
          probability: day.precipProbMax / 100, // Convert 0-100 → 0-1
          amount: day.precipSum,
        },
        conditions,
        cloudCover: day.skyCoverAvg,
        source: 'NWS',
        dataAge: Date.now() - fetchTime,
        confidence: 82, // NWS is well-calibrated for US locations
      }
    })

    // Cache the results
    nwsCache.set(cacheKey, { data: forecasts, timestamp: Date.now() })

    return { data: forecasts, cached: false }
  } catch (error) {
    console.error('[NWS] Fetch error:', error)

    // Return cached data if available (even if stale)
    if (cached) {
      const age = Date.now() - cached.timestamp
      const data = cached.data.map(f => ({ ...f, dataAge: age }))
      return { data, cached: true }
    }

    // Return empty array on failure (graceful degradation)
    return { data: [], cached: false }
  }
}
