// Analyze a specific Kalshi weather market and get trading recommendation
// Usage: npx tsx scripts/analyze-market.ts <market_url_or_id>

import { fetchWeatherForecast } from '../src/lib/api/openMeteo'
import { fetchGoogleWeather } from '../src/lib/api/googleWeather'
import { fetchMETARByCity } from '../src/lib/api/metar'
import {
  calculateTemperatureProbability,
  calculatePrecipitationProbability,
  calculateKellyPosition,
} from '../src/lib/models/weatherProbability'
import type { WeatherForecast, WeatherEnsemble } from '../src/types/weather'

// City coordinates (reuse from existing code)
const CITY_COORDS: Record<string, { lat: number; lng: number }> = {
  'NYC': { lat: 40.7128, lng: -74.0060 },
  'NY': { lat: 40.7128, lng: -74.0060 },
  'CHI': { lat: 41.8781, lng: -87.6298 },
  'LA': { lat: 34.0522, lng: -118.2437 },
  'SF': { lat: 37.7749, lng: -122.4194 },
  'MIA': { lat: 25.7617, lng: -80.1918 },
  'DAL': { lat: 32.7767, lng: -96.7970 },
  'HOU': { lat: 29.7604, lng: -95.3698 },
  'PHX': { lat: 33.4484, lng: -112.0740 },
  'SEA': { lat: 47.6062, lng: -122.3321 },
  'BOS': { lat: 42.3601, lng: -71.0589 },
}

interface MarketDetails {
  ticker: string
  city: string
  date: string
  marketType: 'temperature' | 'precipitation'
  threshold: number
  direction: 'above' | 'below'
  marketPrice?: number
}

/**
 * Parse Kalshi market from URL or ticker
 * Example: https://kalshi.com/markets/kxhighny/highest-temperature-in-nyc/kxhighny-26feb09
 * Ticker: KXHIGHNY-26FEB09
 */
function parseKalshiMarket(input: string): MarketDetails {
  // Extract ticker from URL or use directly
  let ticker = input
  if (input.includes('kalshi.com')) {
    const parts = input.split('/')
    ticker = parts[parts.length - 1].toUpperCase()
  }

  ticker = ticker.toUpperCase()

  // Parse ticker format: KXHIGHNY-26FEB09
  // KX = Kalshi
  // HIGH = High temperature
  // NY = New York
  // 26FEB09 = 26(year) FEB(month) 09(day) → February 9, 2026

  const match = ticker.match(/KX(HIGH|LOW|RAIN|SNOW|TEMP)([A-Z]{2,3})-(\d{2})([A-Z]{3})(\d{2})/)
  if (!match) {
    throw new Error(`Cannot parse ticker: ${ticker}. Expected format like KXHIGHNY-26FEB09`)
  }

  const [, marketTypeCode, cityCode, year, month, day] = match

  // Determine market type
  let marketType: 'temperature' | 'precipitation'
  let direction: 'above' | 'below'

  if (marketTypeCode === 'HIGH') {
    marketType = 'temperature'
    direction = 'above'
  } else if (marketTypeCode === 'LOW') {
    marketType = 'temperature'
    direction = 'below'
  } else if (marketTypeCode === 'RAIN' || marketTypeCode === 'SNOW') {
    marketType = 'precipitation'
    direction = 'above'
  } else {
    marketType = 'temperature'
    direction = 'above'
  }

  // Parse date (2-digit year assumed to be 20XX)
  const monthNames = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
  const monthIndex = monthNames.indexOf(month)
  if (monthIndex === -1) {
    throw new Error(`Invalid month: ${month}`)
  }

  const fullYear = 2000 + parseInt(year)  // 26 → 2026
  const date = `${fullYear}-${String(monthIndex + 1).padStart(2, '0')}-${day}`

  // Get city coordinates
  const coords = CITY_COORDS[cityCode]
  if (!coords) {
    throw new Error(`Unknown city code: ${cityCode}. Available: ${Object.keys(CITY_COORDS).join(', ')}`)
  }

  return {
    ticker,
    city: cityCode,
    date,
    marketType,
    threshold: 0, // Will be determined from market data or user input
    direction,
  }
}

/**
 * Fetch weather ensemble from all sources
 */
async function fetchWeatherEnsemble(
  lat: number,
  lng: number,
  city: string
): Promise<WeatherEnsemble> {
  console.log(`\n🌐 Fetching weather data for ${city}...`)

  const forecasts: WeatherForecast[] = []

  // 1. Open-Meteo (always works)
  try {
    console.log('  📡 Open-Meteo...')
    const openMeteo = await fetchWeatherForecast({ lat, lng, hours: 168 })
    forecasts.push(...openMeteo.data)
    console.log(`  ✅ Open-Meteo: ${openMeteo.data.length} forecasts`)
  } catch (error) {
    console.log(`  ⚠️  Open-Meteo failed: ${error instanceof Error ? error.message : error}`)
  }

  // 2. Google Weather (if API key configured)
  try {
    console.log('  📡 Google Weather...')
    const google = await fetchGoogleWeather(lat, lng)
    forecasts.push(...google.data)
    console.log(`  ✅ Google Weather: ${google.data.length} forecasts`)
  } catch (error) {
    console.log(`  ⚠️  Google Weather unavailable: ${error instanceof Error ? error.message : error}`)
  }

  // 3. METAR (for current conditions)
  try {
    console.log('  📡 METAR...')
    const metar = await fetchMETARByCity(city)
    if (metar.data) {
      // Convert METAR to forecast format (current conditions only)
      const metarForecast: WeatherForecast = {
        location: { lat, lng },
        timestamp: new Date().toISOString(),
        temperature: {
          current: metar.data.temperature.current || 0,
          min: metar.data.temperature.min || 0,
          max: metar.data.temperature.max || 0,
        },
        precipitation: {
          probability: metar.data.conditions.includes('RA') ? 1.0 : 0.0,
          amount: 0,
        },
        conditions: metar.data.conditions,
        source: 'METAR',
        dataAge: 0,
        confidence: 90,
      }
      forecasts.push(metarForecast)
      console.log(`  ✅ METAR: Current conditions`)
    }
  } catch (error) {
    console.log(`  ⚠️  METAR unavailable: ${error instanceof Error ? error.message : error}`)
  }

  if (forecasts.length === 0) {
    throw new Error('Failed to fetch weather from any source')
  }

  // Build consensus
  const sources = [...new Set(forecasts.map(f => f.source))]
  const weights = {
    'Open-Meteo': 0.40,
    'Google-Weather': 0.40,
    'METAR': 0.20,
  }

  // Calculate weighted consensus
  const precipProbs = forecasts.map(f => ({
    prob: f.precipitation.probability,
    weight: weights[f.source] || 0.33,
  }))
  const totalWeight = precipProbs.reduce((sum, p) => sum + p.weight, 0)
  const precipProbability = precipProbs.reduce((sum, p) => sum + p.prob * p.weight, 0) / totalWeight

  const temps = forecasts.flatMap(f => [f.temperature.min, f.temperature.max])
  const temperatureRange: [number, number] = [
    Math.min(...temps),
    Math.max(...temps),
  ]

  // Model agreement (inverse of std deviation)
  const tempStdDev = Math.sqrt(
    temps.reduce((sum, t) => sum + Math.pow(t - temps.reduce((a, b) => a + b) / temps.length, 2), 0) / temps.length
  )
  const modelAgreement = Math.max(0, 100 - tempStdDev * 10)

  // Calculate temperature mean
  const temperatureMean = temps.reduce((sum, t) => sum + t, 0) / temps.length

  // Calculate data quality based on source availability (3 sources max)
  const dataQuality = Math.round((forecasts.length / 3) * 100)

  return {
    location: { lat, lng },
    forecasts,
    consensus: {
      temperatureRange,
      temperatureMean,
      precipProbability,
      modelAgreement,
      dataQuality,
    },
    sources,
    timestamp: Date.now(),
  }
}

/**
 * Analyze market and provide recommendation
 */
async function analyzeMarket(marketInput: string, threshold?: number, marketPrice?: number) {
  console.log('🎯 Kalshi Market Analyzer')
  console.log('='.repeat(70))

  // Parse market
  const market = parseKalshiMarket(marketInput)
  console.log(`\n📊 Market Details:`)
  console.log(`   Ticker: ${market.ticker}`)
  console.log(`   City: ${market.city}`)
  console.log(`   Date: ${market.date}`)
  console.log(`   Type: ${market.marketType}`)
  console.log(`   Direction: ${market.direction}`)

  // Get coordinates
  const coords = CITY_COORDS[market.city]

  // Fetch weather ensemble
  const ensemble = await fetchWeatherEnsemble(coords.lat, coords.lng, market.city)

  console.log(`\n📈 Weather Consensus:`)
  console.log(`   Sources: ${ensemble.sources.join(', ')}`)
  console.log(`   Temperature Range: ${ensemble.consensus.temperatureRange[0].toFixed(1)}°F - ${ensemble.consensus.temperatureRange[1].toFixed(1)}°F`)
  console.log(`   Precipitation Probability: ${(ensemble.consensus.precipProbability * 100).toFixed(1)}%`)
  console.log(`   Model Agreement: ${ensemble.consensus.modelAgreement.toFixed(1)}%`)

  // Calculate model probability
  let modelProbability: number

  if (market.marketType === 'temperature') {
    // If threshold not provided, ask user or use median
    const actualThreshold = threshold || (ensemble.consensus.temperatureRange[0] + ensemble.consensus.temperatureRange[1]) / 2

    console.log(`\n🎲 Calculating probability for: Temperature ${market.direction} ${actualThreshold.toFixed(1)}°F`)

    const weatherProb = calculateTemperatureProbability(
      ensemble,
      actualThreshold,
      market.direction
    )
    modelProbability = weatherProb.probability
  } else {
    // Precipitation
    const actualThreshold = threshold || 0.1 // Default: any measurable rain

    console.log(`\n🎲 Calculating probability for: Precipitation ${market.direction} ${actualThreshold}\"`)

    const weatherProb = calculatePrecipitationProbability(
      ensemble,
      actualThreshold
    )
    modelProbability = weatherProb.probability
  }

  console.log(`\n✅ Model Probability: ${(modelProbability * 100).toFixed(1)}%`)

  // If market price provided, calculate edge
  if (marketPrice !== undefined) {
    const edge = Math.abs(modelProbability - marketPrice)
    const direction = modelProbability > marketPrice ? 'YES' : 'NO'
    const expectedValue = modelProbability > marketPrice
      ? modelProbability * (1 - marketPrice) - (1 - modelProbability) * marketPrice
      : (1 - modelProbability) * marketPrice - modelProbability * (1 - marketPrice)

    console.log(`\n💰 Market Price: ${(marketPrice * 100).toFixed(1)}%`)
    console.log(`\n📊 Trading Analysis:`)
    console.log(`   Edge: ${(edge * 100).toFixed(1)}%`)
    console.log(`   Recommendation: ${edge > 0.15 ? '🟢 TRADE' : '🔴 SKIP'}`)
    console.log(`   Direction: BET ${direction}`)
    console.log(`   Expected Value: ${expectedValue > 0 ? '+' : ''}${(expectedValue * 100).toFixed(2)}%`)

    if (edge > 0.15) {
      const kellySize = calculateKellyPosition(modelProbability, marketPrice, 100, 0.25)
      console.log(`   Suggested Position: $${kellySize.toFixed(2)} (25% fractional Kelly on $100 bankroll)`)
    }
  } else {
    console.log(`\n💡 Provide market price with --price flag to get trading recommendation`)
  }

  console.log('\n' + '='.repeat(70))
}

// CLI interface
const args = process.argv.slice(2)
if (args.length === 0) {
  console.log(`
Usage: npx tsx scripts/analyze-market.ts <market_url_or_ticker> [--threshold N] [--price P]

Examples:
  npx tsx scripts/analyze-market.ts KXHIGHNY-26FEB09
  npx tsx scripts/analyze-market.ts KXHIGHNY-26FEB09 --threshold 37 --price 0.45
  npx tsx scripts/analyze-market.ts https://kalshi.com/markets/kxhighny/highest-temperature-in-nyc/kxhighny-26feb09 --threshold 37 --price 0.45

Options:
  --threshold N    Temperature threshold in °F or precipitation in inches
  --price P        Market price (0-1) for trading analysis
  `)
  process.exit(1)
}

const marketInput = args[0]
const thresholdIdx = args.indexOf('--threshold')
const priceIdx = args.indexOf('--price')

const threshold = thresholdIdx !== -1 ? parseFloat(args[thresholdIdx + 1]) : undefined
const marketPrice = priceIdx !== -1 ? parseFloat(args[priceIdx + 1]) : undefined

analyzeMarket(marketInput, threshold, marketPrice)
  .then(() => {
    console.log('✨ Analysis complete!')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n❌ Error:', error instanceof Error ? error.message : error)
    process.exit(1)
  })
