// National Weather Service (NWS) API client
// Free, no API key required, provides ensemble spread data
// API docs: https://www.weather.gov/documentation/services-web-api

import type { WeatherForecast } from '@/types/weather'
import { rget, rset } from '@/lib/cache/redis'

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

// NWS gridpoints endpoint returns many more series than this interface
// declares by default — see https://weather-gov.github.io/api/gridpoints for
// the full list. The fields declared here are the ones this parser extracts;
// additional series (pressure, ceilingHeight, heatIndex, windChill, snowfall,
// iceAccumulation, etc.) exist on the wire but have nowhere to land in the
// current WeatherForecast shape and are intentionally discarded.
interface NWSGridDataResponse {
  properties: {
    temperature: NWSGridSeries
    maxTemperature: NWSGridSeries
    minTemperature: NWSGridSeries
    quantitativePrecipitation: NWSGridSeries
    probabilityOfPrecipitation: NWSGridSeries
    skyCover: NWSGridSeries
    windSpeed: NWSGridSeries
    windDirection?: NWSGridSeries
    relativeHumidity?: NWSGridSeries
    apparentTemperature?: NWSGridSeries
    visibility?: NWSGridSeries
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

const REDIS_PREFIX = 'nws:'
const REDIS_TTL_S = 1800

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

function inchesFromUom(value: number, uom: string): number {
  if (uom.includes('in') || uom.includes('inch')) {
    return value // already inches
  }
  // NWS uses wmoUnit:mm for precipitation — convert to inches
  return value * 0.03937
}

function milesFromVisibilityUom(value: number, uom: string): number {
  if (uom.includes('mi') && !uom.includes('mm')) return value // already miles
  if (uom.includes('km')) return value * 0.621371
  // NWS default is wmoUnit:m
  return value * 0.000621371
}

// Circular-mean wind direction aggregation (degrees, 0-360).
// Arithmetic mean is wrong near the 0/360 wrap; this converts each bearing
// to a unit vector, averages, and converts back.
function circularMean(degrees: number[]): number | undefined {
  if (degrees.length === 0) return undefined
  let x = 0
  let y = 0
  for (const d of degrees) {
    const rad = (d * Math.PI) / 180
    x += Math.cos(rad)
    y += Math.sin(rad)
  }
  x /= degrees.length
  y /= degrees.length
  const mean = (Math.atan2(y, x) * 180) / Math.PI
  return (mean + 360) % 360
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
// Wind Unit Conversion
// ============================================================================

function mphFromWindUom(value: number, uom: string): number {
  if (uom.includes('km_h') || uom.includes('km/h')) return value * 0.621371
  if (uom.includes('m_s-1') || uom.includes('m/s')) return value * 2.23694
  if (uom.includes('kt') || uom.includes('knot')) return value * 1.15078
  return value // assume mph
}

function parseDurationHours(duration: string): number {
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?/)
  if (!match || (!match[1] && !match[2])) return 1
  const hours = match[1] ? parseInt(match[1], 10) : 0
  const minutes = match[2] ? parseInt(match[2], 10) : 0
  return hours + minutes / 60
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
  humidityAvg?: number
  windSpeedMaxMph?: number
  windDirectionAvg?: number
  apparentTempMin?: number
  apparentTempMax?: number
  visibilityMinMi?: number
}

/**
 * Aggregate NWS grid series data into daily values.
 * @param grid - NWS grid data response
 * @param timezone - IANA timezone for local-day bucketing (e.g. 'America/Los_Angeles')
 */
function aggregateGridDataByDay(grid: NWSGridDataResponse, timezone?: string): DailyAggregate[] {
  const dailyMap = new Map<string, {
    temps: number[]
    maxTemps: number[]
    minTemps: number[]
    precip: number[]
    precipProb: number[]
    skyCover: number[]
    humidity: number[]
    windSpeedMph: number[]
    windDirection: number[]
    apparent: number[]
    visibilityMi: number[]
  }>()

  const tempUom = grid.properties.temperature?.uom || 'wmoUnit:degC'
  const maxTempUom = grid.properties.maxTemperature?.uom || tempUom
  const minTempUom = grid.properties.minTemperature?.uom || tempUom
  const precipUom = grid.properties.quantitativePrecipitation?.uom || 'wmoUnit:mm'
  const windUom = grid.properties.windSpeed?.uom || 'wmoUnit:km_h-1'
  const apparentUom = grid.properties.apparentTemperature?.uom || tempUom
  const visibilityUom = grid.properties.visibility?.uom || 'wmoUnit:m'

  // Helper to extract local date from NWS validTime format.
  // NWS validTime is UTC (e.g. "2026-02-24T01:00:00+00:00/PT1H").
  // Without timezone conversion, slicing the first 10 chars gives the UTC date,
  // which is wrong for western US evening hours (past midnight UTC).
  const dateFmt = timezone
    ? new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
    : null
  function extractDate(validTime: string): string {
    if (dateFmt) {
      // Parse the datetime portion (before the '/') and format as local YYYY-MM-DD
      const timeStr = validTime.split('/')[0]
      return dateFmt.format(new Date(timeStr))
    }
    return validTime.slice(0, 10) // fallback: UTC date
  }

  function ensureDay(date: string) {
    if (!dailyMap.has(date)) {
      dailyMap.set(date, {
        temps: [], maxTemps: [], minTemps: [],
        precip: [], precipProb: [], skyCover: [],
        humidity: [], windSpeedMph: [], windDirection: [],
        apparent: [], visibilityMi: [],
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
    dailyMap.get(date)!.maxTemps.push(celsiusFromUom(v.value, maxTempUom))
  }

  // Process min temperature
  for (const v of grid.properties.minTemperature?.values || []) {
    if (v.value === null) continue
    const date = extractDate(v.validTime)
    ensureDay(date)
    dailyMap.get(date)!.minTemps.push(celsiusFromUom(v.value, minTempUom))
  }

  // Process precipitation
  for (const v of grid.properties.quantitativePrecipitation?.values || []) {
    if (v.value === null) continue
    const date = extractDate(v.validTime)
    ensureDay(date)
    dailyMap.get(date)!.precip.push(inchesFromUom(v.value, precipUom))
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

  // Process wind speed
  for (const v of grid.properties.windSpeed?.values || []) {
    if (v.value === null) continue
    const date = extractDate(v.validTime)
    ensureDay(date)
    dailyMap.get(date)!.windSpeedMph.push(mphFromWindUom(v.value, windUom))
  }

  // Process wind direction
  for (const v of grid.properties.windDirection?.values || []) {
    if (v.value === null) continue
    const date = extractDate(v.validTime)
    ensureDay(date)
    dailyMap.get(date)!.windDirection.push(v.value)
  }

  // Process relative humidity
  for (const v of grid.properties.relativeHumidity?.values || []) {
    if (v.value === null) continue
    const date = extractDate(v.validTime)
    ensureDay(date)
    dailyMap.get(date)!.humidity.push(v.value)
  }

  // Process apparent temperature
  for (const v of grid.properties.apparentTemperature?.values || []) {
    if (v.value === null) continue
    const date = extractDate(v.validTime)
    ensureDay(date)
    dailyMap.get(date)!.apparent.push(celsiusFromUom(v.value, apparentUom))
  }

  // Process visibility
  for (const v of grid.properties.visibility?.values || []) {
    if (v.value === null) continue
    const date = extractDate(v.validTime)
    ensureDay(date)
    dailyMap.get(date)!.visibilityMi.push(milesFromVisibilityUom(v.value, visibilityUom))
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
      humidityAvg: data.humidity.length > 0
        ? data.humidity.reduce((s, v) => s + v, 0) / data.humidity.length
        : undefined,
      windSpeedMaxMph: data.windSpeedMph.length > 0
        ? Math.max(...data.windSpeedMph)
        : undefined,
      windDirectionAvg: circularMean(data.windDirection),
      apparentTempMin: data.apparent.length > 0 ? Math.min(...data.apparent) : undefined,
      apparentTempMax: data.apparent.length > 0 ? Math.max(...data.apparent) : undefined,
      visibilityMinMi: data.visibilityMi.length > 0
        ? Math.min(...data.visibilityMi)
        : undefined,
    })
  }

  // Sort by date
  result.sort((a, b) => a.date.localeCompare(b.date))
  return result
}

// ============================================================================
// NWS Grid Data → Hourly Extraction
// ============================================================================

function extractHourlyFromGrid(
  grid: NWSGridDataResponse,
  lat: number,
  lng: number,
  gridPoint: NWSPointsResponse
): WeatherForecast[] {
  const now = Date.now()
  const cutoff = now + 48 * 60 * 60 * 1000
  const tempUom = grid.properties.temperature?.uom || 'wmoUnit:degC'
  const windUom = grid.properties.windSpeed?.uom || 'wmoUnit:km_h-1'
  const apparentUom = grid.properties.apparentTemperature?.uom || tempUom
  const visibilityUom = grid.properties.visibility?.uom || 'wmoUnit:m'

  const hourlyForecasts: WeatherForecast[] = []

  // Helper: find the first series value whose validTime interval contains entryTime.
  function findAtTime(series: NWSGridSeries | undefined, entryTime: number): number | null {
    if (!series?.values) return null
    for (const entry of series.values) {
      if (entry.value === null) continue
      const [tStr, dStr] = entry.validTime.split('/')
      const start = new Date(tStr).getTime()
      const hours = parseDurationHours(dStr || 'PT24H')
      const end = start + hours * 60 * 60 * 1000
      if (entryTime >= start && entryTime < end) return entry.value
    }
    return null
  }

  for (const entry of grid.properties.temperature?.values || []) {
    if (entry.value === null) continue

    const [timeStr, durationStr] = entry.validTime.split('/')
    if (!durationStr) continue

    const durationHours = parseDurationHours(durationStr)
    if (durationHours > 3) continue

    const entryTime = new Date(timeStr).getTime()
    if (entryTime < now || entryTime > cutoff) continue

    const tempC = celsiusFromUom(entry.value, tempUom)

    const precipProbRaw = findAtTime(grid.properties.probabilityOfPrecipitation, entryTime)
    const precipProb = precipProbRaw ?? 0

    const windSpeedRaw = findAtTime(grid.properties.windSpeed, entryTime)
    const windSpeedMph = windSpeedRaw != null ? mphFromWindUom(windSpeedRaw, windUom) : undefined

    const skyCoverRaw = findAtTime(grid.properties.skyCover, entryTime)
    const skyCover = skyCoverRaw != null ? skyCoverRaw : undefined

    const humidityRaw = findAtTime(grid.properties.relativeHumidity, entryTime)
    const humidity = humidityRaw != null ? humidityRaw : undefined

    const windDirRaw = findAtTime(grid.properties.windDirection, entryTime)
    const windDirection = windDirRaw != null ? windDirRaw : undefined

    const apparentRaw = findAtTime(grid.properties.apparentTemperature, entryTime)
    const apparent = apparentRaw != null ? celsiusFromUom(apparentRaw, apparentUom) : undefined

    const visibilityRaw = findAtTime(grid.properties.visibility, entryTime)
    const visibility =
      visibilityRaw != null ? milesFromVisibilityUom(visibilityRaw, visibilityUom) : undefined

    // Derive conditions from sky cover
    let conditions = 'Clear'
    if (skyCover != null) {
      if (skyCover < 20) conditions = 'Clear'
      else if (skyCover < 50) conditions = 'Partly Cloudy'
      else if (skyCover < 80) conditions = 'Mostly Cloudy'
      else conditions = 'Overcast'
    }
    if (precipProb > 60) {
      conditions = tempC < 0 ? 'Snow' : 'Rain'
    }

    hourlyForecasts.push({
      location: {
        lat,
        lng,
        city: gridPoint.properties.relativeLocation?.properties?.city,
        timezone: gridPoint.properties.timeZone,
      },
      timestamp: timeStr,
      temperature: {
        current: tempC,
        min: tempC,
        max: tempC,
        ...(apparent != null ? { apparent } : {}),
      },
      precipitation: {
        probability: precipProb / 100,
        amount: 0,
      },
      conditions,
      cloudCover: skyCover,
      humidity,
      windSpeed: windSpeedMph,
      windDirection,
      visibility,
      source: 'NWS',
      dataAge: 0,
      confidence: 80,
    })
  }

  return hourlyForecasts
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

  // L1: Check in-memory cache
  const cached = nwsCache.get(cacheKey)
  if (cached && (Date.now() - cached.timestamp) < NWS_CACHE_TTL) {
    const age = Date.now() - cached.timestamp
    const data = cached.data.map(f => ({ ...f, dataAge: age }))
    return { data, cached: true }
  }

  // L2: Check Redis
  const redisData = await rget<WeatherForecast[]>(REDIS_PREFIX + cacheKey)
  if (redisData) {
    nwsCache.set(cacheKey, { data: redisData, timestamp: Date.now() })
    return { data: redisData, cached: true }
  }

  try {
    // Step 1: Get grid point metadata
    const gridPoint = await fetchGridPoint(lat, lng)

    // Step 2: Fetch raw grid data (more useful than human-readable forecast)
    const gridData = await fetchGridData(gridPoint.properties.forecastGridData)

    // Step 3: Aggregate into daily forecasts (timezone-aware bucketing)
    const dailyData = aggregateGridDataByDay(gridData, gridPoint.properties.timeZone)

    // Step 3b: Extract hourly forecasts from grid data
    const hourlyForecasts = extractHourlyFromGrid(gridData, lat, lng, gridPoint)

    // Step 4: Convert daily to WeatherForecast format
    const fetchTime = Date.now()
    const dailyForecasts: WeatherForecast[] = dailyData.map(day => {
      const skyCover = day.skyCoverAvg
      let conditions: string
      if (skyCover < 20) conditions = 'Clear'
      else if (skyCover < 50) conditions = 'Partly Cloudy'
      else if (skyCover < 80) conditions = 'Mostly Cloudy'
      else conditions = 'Overcast'

      if (day.precipProbMax > 60) {
        conditions = day.tempMin < 0 ? 'Snow' : 'Rain'
      }

      const apparent =
        day.apparentTempMin != null && day.apparentTempMax != null
          ? (day.apparentTempMin + day.apparentTempMax) / 2
          : undefined

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
          ...(apparent != null ? { apparent } : {}),
        },
        precipitation: {
          probability: day.precipProbMax / 100, // Convert 0-100 → 0-1
          amount: day.precipSum,
        },
        conditions,
        cloudCover: day.skyCoverAvg,
        humidity: day.humidityAvg,
        windSpeed: day.windSpeedMaxMph,
        windDirection: day.windDirectionAvg,
        visibility: day.visibilityMinMi,
        source: 'NWS',
        dataAge: Date.now() - fetchTime,
        confidence: 82, // NWS is well-calibrated for US locations
      }
    })

    // Combine daily and hourly forecasts
    const forecasts = [...dailyForecasts, ...hourlyForecasts]

    // Cache the results (L1 + L2)
    nwsCache.set(cacheKey, { data: forecasts, timestamp: Date.now() })
    await rset(REDIS_PREFIX + cacheKey, forecasts, REDIS_TTL_S)

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
