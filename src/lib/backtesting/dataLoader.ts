// Historical market data loader for backtesting
// Loads CSV data and fetches historical weather from Open-Meteo Archive API

import * as fs from 'fs'
import { parse } from 'csv-parse/sync'
import { getCityCoordinates } from '@/lib/utils/cityCoordinates'

export interface HistoricalMarket {
  date: string
  location: { lat: number; lng: number; city: string }
  marketType: 'temperature' | 'precipitation'
  threshold: number
  direction: 'above' | 'below'
  outcome: boolean
  marketPrice: number
  kalshiId?: string
}

/**
 * Load historical markets from CSV file
 * Uses Node.js fs module for synchronous file reading
 *
 * @param csvPath - Path to CSV file (e.g., './data/weather/historical_markets_2024.csv')
 * @returns Array of historical market data
 */
export async function loadHistoricalMarkets(
  csvPath: string
): Promise<HistoricalMarket[]> {
  try {
    const content = fs.readFileSync(csvPath, 'utf-8')
    const records = parse(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    })

    return records.map((r: any) => {
      // Handle coordinates: either explicit or from city mapping
      let lat: number
      let lng: number
      let city: string

      if (r.lat && r.lng) {
        // CSV has explicit coordinates (old format)
        lat = parseFloat(r.lat)
        lng = parseFloat(r.lng)
        city = r.city || r.location
      } else if (r.location) {
        // CSV has city code only (new Kalshi format) - lookup coordinates
        const coords = getCityCoordinates(r.location)
        if (!coords) {
          throw new Error(`Cannot find coordinates for city code: ${r.location}`)
        }
        lat = coords.lat
        lng = coords.lng
        city = r.city || coords.name
      } else {
        throw new Error('CSV must have either (lat, lng) or (location) columns')
      }

      return {
        date: r.date,
        location: { lat, lng, city },
        marketType: r.market_type as 'temperature' | 'precipitation',
        threshold: parseFloat(r.threshold),
        direction: r.direction as 'above' | 'below',
        outcome: r.outcome === '1' || r.outcome === 'true',
        marketPrice: parseFloat(r.market_price),
        kalshiId: r.kalshi_id || undefined,
      }
    })
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to load historical markets: ${error.message}`)
    }
    throw new Error('Unknown error loading historical markets')
  }
}

/**
 * Fetch historical weather data from Open-Meteo Archive API
 * Free tier: no API key required, 10,000 requests/day
 *
 * @param lat - Latitude
 * @param lng - Longitude
 * @param date - ISO date string (YYYY-MM-DD)
 * @returns Historical weather observation
 */
export async function fetchHistoricalWeather(
  lat: number,
  lng: number,
  date: string
): Promise<{
  tempMax: number
  tempMin: number
  precipSum: number
  tempAvg: number
}> {
  // Validate coordinates
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw new Error('Invalid coordinates: latitude must be -90 to 90, longitude -180 to 180')
  }

  // Validate date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid date format: ${date}. Expected YYYY-MM-DD`)
  }

  try {
    const url = new URL('https://archive-api.open-meteo.com/v1/archive')
    url.searchParams.set('latitude', lat.toString())
    url.searchParams.set('longitude', lng.toString())
    url.searchParams.set('start_date', date)
    url.searchParams.set('end_date', date)
    url.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min,precipitation_sum')
    url.searchParams.set('temperature_unit', 'celsius')
    url.searchParams.set('precipitation_unit', 'mm')
    url.searchParams.set('timezone', 'auto')

    const response = await fetch(url.toString())

    if (!response.ok) {
      throw new Error(`Open-Meteo Archive API error: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()

    // Validate response structure
    if (!data.daily || !data.daily.temperature_2m_max || !data.daily.temperature_2m_min) {
      throw new Error('Invalid response from Open-Meteo Archive API')
    }

    const tempMax = data.daily.temperature_2m_max[0]
    const tempMin = data.daily.temperature_2m_min[0]
    const precipSum = data.daily.precipitation_sum?.[0] || 0

    return {
      tempMax,
      tempMin,
      precipSum,
      tempAvg: (tempMax + tempMin) / 2,
    }
  } catch (error) {
    if (error instanceof Error) {
      throw error
    }
    throw new Error('Unknown error fetching historical weather')
  }
}

/**
 * Fetch what weather models ACTUALLY PREDICTED on a past date
 * Uses Open-Meteo Historical Forecast API (not archive/actual outcomes)
 * This gives us the real forecast that would have been available for trading.
 *
 * @param lat - Latitude
 * @param lng - Longitude
 * @param date - ISO date string (YYYY-MM-DD) — the weather date being predicted
 * @param forecastLeadDays - How many days before `date` the forecast was issued (default: 1 = day-before forecast)
 * @returns What the model predicted for that date
 */
export async function fetchHistoricalForecast(
  lat: number,
  lng: number,
  date: string,
  forecastLeadDays: number = 1
): Promise<{
  forecastTempMax: number
  forecastTempMin: number
  forecastPrecipSum: number
  forecastTempAvg: number
}> {
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw new Error('Invalid coordinates')
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid date format: ${date}. Expected YYYY-MM-DD`)
  }

  // The forecast was issued `forecastLeadDays` before the weather date
  const weatherDate = new Date(date)
  const forecastIssueDate = new Date(weatherDate)
  forecastIssueDate.setDate(forecastIssueDate.getDate() - forecastLeadDays)
  const issueStr = forecastIssueDate.toISOString().slice(0, 10)

  try {
    const url = new URL('https://historical-forecast-api.open-meteo.com/v1/forecast')
    url.searchParams.set('latitude', lat.toString())
    url.searchParams.set('longitude', lng.toString())
    url.searchParams.set('start_date', date)
    url.searchParams.set('end_date', date)
    url.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min,precipitation_sum')
    url.searchParams.set('temperature_unit', 'celsius')
    url.searchParams.set('precipitation_unit', 'mm')
    url.searchParams.set('timezone', 'auto')
    // past_days parameter tells the API to use the forecast model run from N days before
    url.searchParams.set('past_days', forecastLeadDays.toString())

    const response = await fetch(url.toString())

    if (!response.ok) {
      throw new Error(`Open-Meteo Historical Forecast API error: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()

    if (!data.daily || !data.daily.temperature_2m_max || !data.daily.temperature_2m_min) {
      throw new Error('Invalid response from Open-Meteo Historical Forecast API')
    }

    // Find the entry matching our target date
    const dateIndex = data.daily.time.indexOf(date)
    const idx = dateIndex >= 0 ? dateIndex : 0

    const forecastTempMax = data.daily.temperature_2m_max[idx]
    const forecastTempMin = data.daily.temperature_2m_min[idx]
    const forecastPrecipSum = data.daily.precipitation_sum?.[idx] || 0

    return {
      forecastTempMax,
      forecastTempMin,
      forecastPrecipSum,
      forecastTempAvg: (forecastTempMax + forecastTempMin) / 2,
    }
  } catch (error) {
    if (error instanceof Error) throw error
    throw new Error('Unknown error fetching historical forecast')
  }
}

/**
 * Batch fetch historical weather for multiple markets
 * Includes rate limiting to respect API limits
 *
 * @param markets - Array of historical markets
 * @param delayMs - Delay between requests (default: 100ms)
 * @returns Map of date+location to weather data
 */
export async function batchFetchHistoricalWeather(
  markets: HistoricalMarket[],
  delayMs: number = 100
): Promise<Map<string, {
  tempMax: number
  tempMin: number
  precipSum: number
  tempAvg: number
}>> {
  const cache = new Map<string, any>()

  for (const market of markets) {
    const key = `${market.date}-${market.location.lat.toFixed(2)}-${market.location.lng.toFixed(2)}`

    // Skip if already fetched
    if (cache.has(key)) {
      continue
    }

    try {
      const weather = await fetchHistoricalWeather(
        market.location.lat,
        market.location.lng,
        market.date
      )

      cache.set(key, weather)

      // Rate limiting delay
      if (delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs))
      }
    } catch (error) {
      console.error(`Failed to fetch weather for ${key}:`, error)
      // Continue with other markets even if one fails
    }
  }

  return cache
}
