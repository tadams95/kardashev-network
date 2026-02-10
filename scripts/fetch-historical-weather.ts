// Pre-fetch all historical weather data for Kalshi markets
// Solves 24.1% API failure rate by fetching once with retries

import * as fs from 'fs'
import * as path from 'path'
import { loadHistoricalMarkets } from '../src/lib/backtesting/dataLoader'

interface WeatherDataPoint {
  date: string
  lat: number
  lng: number
  city: string
  tempMax: number
  tempMin: number
  precipSum: number
  fetchedAt: number
}

interface WeatherCache {
  version: string
  fetchedAt: number
  markets: number
  data: Record<string, WeatherDataPoint>  // Key: "YYYY-MM-DD_LAT_LNG"
}

// Retry logic for failed API calls
async function fetchWithRetry<T>(
  fn: () => Promise<T>,
  retries: number = 3,
  delay: number = 1000
): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    if (retries === 0) throw error

    console.log(`  Retry in ${delay}ms... (${retries} attempts left)`)
    await new Promise(resolve => setTimeout(resolve, delay))
    return fetchWithRetry(fn, retries - 1, delay * 2)  // Exponential backoff
  }
}

// Fetch single weather data point from Open-Meteo Archive API
async function fetchHistoricalWeather(
  lat: number,
  lng: number,
  date: string
): Promise<WeatherDataPoint> {
  const url = new URL('https://archive-api.open-meteo.com/v1/archive')
  url.searchParams.set('latitude', lat.toString())
  url.searchParams.set('longitude', lng.toString())
  url.searchParams.set('start_date', date)
  url.searchParams.set('end_date', date)
  url.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min,precipitation_sum')
  url.searchParams.set('temperature_unit', 'fahrenheit')  // Kalshi uses Fahrenheit
  url.searchParams.set('precipitation_unit', 'inch')      // Kalshi uses inches
  url.searchParams.set('timezone', 'auto')

  const response = await fetch(url.toString())
  if (!response.ok) {
    throw new Error(`Open-Meteo API error: ${response.status} ${response.statusText}`)
  }

  const json = await response.json()

  // Validate response structure
  if (!json.daily || !json.daily.temperature_2m_max || !json.daily.temperature_2m_min || !json.daily.precipitation_sum) {
    throw new Error(`Incomplete weather data for ${date}`)
  }

  return {
    date,
    lat,
    lng,
    city: '', // Will be filled from market data
    tempMax: json.daily.temperature_2m_max[0],
    tempMin: json.daily.temperature_2m_min[0],
    precipSum: json.daily.precipitation_sum[0] || 0,
    fetchedAt: Date.now(),
  }
}

// Main script
async function prefetchWeatherData() {
  console.log('🌤️  Historical Weather Data Pre-fetcher')
  console.log('='.repeat(70))
  console.log('Purpose: Fetch all 976 weather data points with retry logic')
  console.log('Benefit: Eliminates 24.1% API failure rate in backtests')
  console.log('')

  // Load Kalshi markets
  console.log('📊 Loading Kalshi markets from CSV...')
  const markets = await loadHistoricalMarkets('./data/weather/kalshi_real_2024.csv')
  console.log(`✅ Loaded ${markets.length} markets`)

  // Get unique date/location pairs
  const uniqueKeys = new Set<string>()
  const locationMap = new Map<string, { lat: number; lng: number; city: string }>()

  markets.forEach(m => {
    const key = `${m.date}_${m.location.lat.toFixed(4)}_${m.location.lng.toFixed(4)}`
    uniqueKeys.add(key)
    locationMap.set(key, m.location)
  })

  console.log(`📍 Found ${uniqueKeys.size} unique date/location pairs to fetch`)
  console.log('')

  // Fetch weather data for each unique pair
  const cache: WeatherCache = {
    version: '1.0',
    fetchedAt: Date.now(),
    markets: markets.length,
    data: {},
  }

  let successCount = 0
  let failCount = 0
  const failed: string[] = []

  console.log('🔄 Fetching weather data (with retries)...')
  console.log('Rate limit: 100ms between requests to respect API limits')
  console.log('')

  for (const key of Array.from(uniqueKeys)) {
    const [date, latStr, lngStr] = key.split('_')
    const location = locationMap.get(key)!

    try {
      // Fetch with retry logic
      const data = await fetchWithRetry(
        () => fetchHistoricalWeather(location.lat, location.lng, date),
        3,  // 3 retries
        1000  // 1 second initial delay
      )

      data.city = location.city
      cache.data[key] = data
      successCount++

      // Progress indicator
      if (successCount % 50 === 0) {
        console.log(`  Progress: ${successCount}/${uniqueKeys.size} (${((successCount / uniqueKeys.size) * 100).toFixed(1)}%)`)
      }
    } catch (error) {
      failCount++
      failed.push(`${date} ${location.city}`)
      console.error(`  ❌ Failed: ${date} ${location.city} - ${error}`)
    }

    // Rate limiting: 100ms between requests (max 600 requests/minute)
    await new Promise(resolve => setTimeout(resolve, 100))
  }

  console.log('')
  console.log('='.repeat(70))
  console.log(`✅ Fetch complete!`)
  console.log(`   Success: ${successCount}/${uniqueKeys.size} (${((successCount / uniqueKeys.size) * 100).toFixed(1)}%)`)
  console.log(`   Failed: ${failCount} (${((failCount / uniqueKeys.size) * 100).toFixed(1)}%)`)

  if (failed.length > 0) {
    console.log('')
    console.log('⚠️  Failed fetches:')
    failed.forEach(f => console.log(`   - ${f}`))
  }

  // Save cache to file
  const cachePath = path.join(__dirname, '../data/weather/weather_cache_2024.json')
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2))
  console.log('')
  console.log(`💾 Cache saved to: ${cachePath}`)
  console.log(`   File size: ${(fs.statSync(cachePath).size / 1024).toFixed(1)} KB`)
  console.log('')
  console.log('🎯 Next: Update backtest.ts to load from cache instead of API')
}

prefetchWeatherData()
  .then(() => {
    console.log('\n✨ Pre-fetch complete!')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n💥 Pre-fetch failed:', error)
    process.exit(1)
  })
