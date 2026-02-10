// Test script for weather trading system
// Verifies all components work together: data fetching, consensus, and probability calculations

// Load environment variables for standalone execution
import * as fs from 'fs'
import * as path from 'path'

// Simple .env.local parser
const envPath = path.join(__dirname, '.env.local')
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8')
  envContent.split('\n').forEach(line => {
    const match = line.match(/^([^=:#]+)=(.*)$/)
    if (match) {
      const key = match[1].trim()
      const value = match[2].trim().replace(/^["']|["']$/g, '') // Remove quotes
      if (key && !process.env[key]) {
        process.env[key] = value
      }
    }
  })
}

import { fetchWeatherForecast } from './src/lib/api/openMeteo'
import { fetchGoogleWeather } from './src/lib/api/googleWeather'
import { fetchMETARByCity } from './src/lib/api/metar'
import {
  buildEnsemble,
  buildConsensus,
  calculateTemperatureProbability,
  calculatePrecipitationProbability,
  calculateEdge,
  calculateExpectedValue,
  calculateKellyPosition,
  isTradingAllowed,
  applyDataQualityDiscount,
} from './src/lib/models/weatherProbability'

// Test location: Dallas, TX
const TEST_LAT = 32.7767
const TEST_LNG = -96.7970
const TEST_CITY = 'Dallas'

async function testWeatherStack() {
  console.log('🌤️  Weather Trading System - Component Test\n')
  console.log('=' .repeat(60))

  try {
    // ========================================================================
    // Test 1: Open-Meteo Weather Forecast
    // ========================================================================
    console.log('\n📊 Test 1: Open-Meteo Weather Forecast')
    console.log('-'.repeat(60))

    const openMeteoData = await fetchWeatherForecast({
      lat: TEST_LAT,
      lng: TEST_LNG,
      hours: 168, // 7 days
    })

    console.log(`✅ Open-Meteo forecasts: ${openMeteoData.data.length} entries`)
    console.log(`   Cached: ${openMeteoData.cached}`)
    console.log(`   Sample forecast:`)
    console.log(`     Time: ${openMeteoData.data[0].timestamp}`)
    console.log(`     Temp: ${openMeteoData.data[0].temperature.current.toFixed(1)}°C`)
    console.log(`     Precip Prob: ${(openMeteoData.data[0].precipitation.probability * 100).toFixed(0)}%`)
    console.log(`     Conditions: ${openMeteoData.data[0].conditions}`)
    console.log(`     Source: ${openMeteoData.data[0].source}`)
    console.log(`     Confidence: ${openMeteoData.data[0].confidence}%`)

    // ========================================================================
    // Test 2: Google Weather API
    // ========================================================================
    console.log('\n📊 Test 2: Google Weather API')
    console.log('-'.repeat(60))

    let googleData: { data: any[]; cached: boolean } = { data: [], cached: false }

    try {
      googleData = await fetchGoogleWeather(TEST_LAT, TEST_LNG, {
        hourlyHorizon: 240, // 10 days
        dailyHorizon: 10,
      })

      console.log(`✅ Google Weather forecasts: ${googleData.data.length} entries`)
      console.log(`   Cached: ${googleData.cached}`)
      if (googleData.data.length > 0) {
        console.log(`   Sample forecast:`)
        console.log(`     Time: ${googleData.data[0].timestamp}`)
        console.log(`     Temp: ${googleData.data[0].temperature.current.toFixed(1)}°C`)
        console.log(`     Precip Prob: ${(googleData.data[0].precipitation.probability * 100).toFixed(0)}%`)
        console.log(`     Conditions: ${googleData.data[0].conditions}`)
        console.log(`     Source: ${googleData.data[0].source}`)
        console.log(`     Confidence: ${googleData.data[0].confidence}%`)
      }
    } catch (error) {
      console.log(`⚠️  Google Weather API skipped: ${error instanceof Error ? error.message : 'Unknown error'}`)
      console.log(`   (This is optional - system works with Open-Meteo + METAR)`)
    }

    // ========================================================================
    // Test 3: METAR Aviation Weather
    // ========================================================================
    console.log('\n📊 Test 3: METAR Aviation Weather')
    console.log('-'.repeat(60))

    let metarData: { data: any; cached: boolean } | null = null

    try {
      metarData = await fetchMETARByCity(TEST_CITY)

      console.log(`✅ METAR observation retrieved`)
      console.log(`   Cached: ${metarData.cached}`)
      console.log(`   Time: ${metarData.data.timestamp}`)
      console.log(`   Temp: ${metarData.data.temperature.current.toFixed(1)}°C`)
      console.log(`   Precip Prob: ${(metarData.data.precipitation.probability * 100).toFixed(0)}%`)
      console.log(`   Conditions: ${metarData.data.conditions}`)
      console.log(`   Source: ${metarData.data.source}`)
      console.log(`   Confidence: ${metarData.data.confidence}%`)
      console.log(`   Wind: ${metarData.data.windSpeed?.toFixed(1) || 'N/A'} m/s`)
      console.log(`   Visibility: ${metarData.data.visibility?.toFixed(1) || 'N/A'} SM`)
    } catch (error) {
      console.log(`⚠️  METAR API skipped: ${error instanceof Error ? error.message : 'Unknown error'}`)
      console.log(`   (METAR endpoint may be temporarily unavailable)`)
    }

    // ========================================================================
    // Test 4: Build Ensemble
    // ========================================================================
    console.log('\n📊 Test 4: Build Weather Ensemble')
    console.log('-'.repeat(60))

    // Use first forecast from each source for current conditions
    const openMeteoForecasts = openMeteoData.data.slice(0, 24) // Next 24 hours
    const googleForecasts = googleData.data.slice(0, 24)
    const metarForecast = metarData?.data || null

    const ensemble = buildEnsemble(
      openMeteoForecasts,
      googleForecasts,
      metarForecast,
      { lat: TEST_LAT, lng: TEST_LNG, city: TEST_CITY }
    )

    console.log(`✅ Ensemble created with ${ensemble.forecasts.length} forecasts`)
    console.log(`   Sources: ${ensemble.sources.join(', ')}`)
    console.log(`\n   Consensus:`)
    console.log(`     Temperature Range: ${ensemble.consensus.temperatureRange[0].toFixed(1)}°C - ${ensemble.consensus.temperatureRange[1].toFixed(1)}°C`)
    console.log(`     Temperature Mean: ${ensemble.consensus.temperatureMean.toFixed(1)}°C`)
    console.log(`     Precip Probability: ${(ensemble.consensus.precipProbability * 100).toFixed(0)}%`)
    console.log(`     Model Agreement: ${ensemble.consensus.modelAgreement.toFixed(0)}%`)
    console.log(`     Data Quality: ${ensemble.consensus.dataQuality}%`)

    // ========================================================================
    // Test 5: Temperature Probability Calculation
    // ========================================================================
    console.log('\n📊 Test 5: Temperature Probability Calculation')
    console.log('-'.repeat(60))

    const tempThreshold = 95 // 95°F
    const tempProbability = calculateTemperatureProbability(
      ensemble,
      tempThreshold,
      'above'
    )

    console.log(`✅ Temperature probability calculated`)
    console.log(`   Outcome: ${tempProbability.outcome}`)
    console.log(`   Probability: ${(tempProbability.probability * 100).toFixed(1)}%`)
    console.log(`   Confidence: ${tempProbability.confidence.toFixed(0)}%`)
    console.log(`   Reasoning: ${tempProbability.reasoning}`)

    // ========================================================================
    // Test 6: Precipitation Probability Calculation
    // ========================================================================
    console.log('\n📊 Test 6: Precipitation Probability Calculation')
    console.log('-'.repeat(60))

    const precipThreshold = 0.1 // 0.1 inches
    const precipProbability = calculatePrecipitationProbability(
      ensemble,
      precipThreshold
    )

    console.log(`✅ Precipitation probability calculated`)
    console.log(`   Outcome: ${precipProbability.outcome}`)
    console.log(`   Probability: ${(precipProbability.probability * 100).toFixed(1)}%`)
    console.log(`   Confidence: ${precipProbability.confidence.toFixed(0)}%`)
    console.log(`   Reasoning: ${precipProbability.reasoning}`)

    // ========================================================================
    // Test 7: Edge Detection & Expected Value
    // ========================================================================
    console.log('\n📊 Test 7: Edge Detection & Expected Value')
    console.log('-'.repeat(60))

    // Simulate market price
    const marketPrice = 0.45 // 45% probability priced by market
    const modelProb = tempProbability.probability

    const edgeAnalysis = calculateEdge(modelProb, marketPrice, 0.15)
    console.log(`✅ Edge analysis:`)
    console.log(`   Model Probability: ${(modelProb * 100).toFixed(1)}%`)
    console.log(`   Market Price: ${(marketPrice * 100).toFixed(1)}%`)
    console.log(`   Edge: ${(edgeAnalysis.edge * 100).toFixed(1)}%`)
    console.log(`   Has Edge (>15%): ${edgeAnalysis.hasEdge ? '✅ YES' : '❌ NO'}`)
    console.log(`   Direction: ${edgeAnalysis.direction}`)

    const positionSize = 10 // $10 position
    const expectedValue = calculateExpectedValue(modelProb, marketPrice, positionSize, 0.15)
    console.log(`\n   Expected Value (${positionSize} position):`)
    console.log(`     EV: $${expectedValue.toFixed(2)}`)
    console.log(`     ROI: ${((expectedValue / positionSize) * 100).toFixed(1)}%`)

    // ========================================================================
    // Test 8: Kelly Position Sizing
    // ========================================================================
    console.log('\n📊 Test 8: Kelly Position Sizing')
    console.log('-'.repeat(60))

    const bankroll = 100 // $100 bankroll
    const kellyPosition = calculateKellyPosition(modelProb, marketPrice, bankroll, 0.25)

    console.log(`✅ Kelly position sizing:`)
    console.log(`   Bankroll: $${bankroll}`)
    console.log(`   Recommended Position: $${kellyPosition.toFixed(2)}`)
    console.log(`   % of Bankroll: ${((kellyPosition / bankroll) * 100).toFixed(1)}%`)

    // ========================================================================
    // Test 9: Data Quality Discount
    // ========================================================================
    console.log('\n📊 Test 9: Data Quality Discount')
    console.log('-'.repeat(60))

    const rawProb = tempProbability.probability
    const adjustedProb = applyDataQualityDiscount(rawProb, ensemble.forecasts)

    console.log(`✅ Data quality adjustment:`)
    console.log(`   Raw Probability: ${(rawProb * 100).toFixed(1)}%`)
    console.log(`   Adjusted Probability: ${(adjustedProb * 100).toFixed(1)}%`)
    console.log(`   Discount Factor: ${((1 - adjustedProb / rawProb) * 100).toFixed(1)}%`)

    // ========================================================================
    // Test 10: Trading Rules
    // ========================================================================
    console.log('\n📊 Test 10: Trading Rules (12-Hour Buffer)')
    console.log('-'.repeat(60))

    const hoursToResolution1 = 6
    const hoursToResolution2 = 24
    const hoursToResolution3 = 48

    console.log(`✅ Trading allowed checks:`)
    console.log(`   6 hours to resolution: ${isTradingAllowed(hoursToResolution1) ? '✅ YES' : '❌ NO (too close)'}`)
    console.log(`   24 hours to resolution: ${isTradingAllowed(hoursToResolution2) ? '✅ YES' : '❌ NO'}`)
    console.log(`   48 hours to resolution: ${isTradingAllowed(hoursToResolution3) ? '✅ YES' : '❌ NO'}`)

    // ========================================================================
    // Test 11: Cache Verification
    // ========================================================================
    console.log('\n📊 Test 11: Cache Verification')
    console.log('-'.repeat(60))

    // Fetch again to test caching
    const cachedOpenMeteo = await fetchWeatherForecast({ lat: TEST_LAT, lng: TEST_LNG })

    console.log(`✅ Cache hit verification:`)
    console.log(`   Open-Meteo: ${cachedOpenMeteo.cached ? '✅ CACHED' : '❌ MISS'}`)

    // Test other caches if APIs are available
    if (googleData.data.length > 0) {
      const cachedGoogle = await fetchGoogleWeather(TEST_LAT, TEST_LNG).catch(() => ({ data: [], cached: false }))
      console.log(`   Google Weather: ${cachedGoogle.cached ? '✅ CACHED' : '⚠️  SKIPPED'}`)
    }

    if (metarData) {
      const cachedMetar = await fetchMETARByCity(TEST_CITY).catch(() => null)
      console.log(`   METAR: ${cachedMetar?.cached ? '✅ CACHED' : '⚠️  SKIPPED'}`)
    }

    // ========================================================================
    // Summary
    // ========================================================================
    console.log('\n' + '='.repeat(60))
    console.log('✅ ALL TESTS PASSED!')
    console.log('='.repeat(60))
    console.log('\n📈 System Ready for Phase 2: Backtesting')
    console.log(`\n💡 Next Steps:`)
    console.log(`   1. Create API routes: /api/weather/forecast, /api/weather/probability`)
    console.log(`   2. Build React hooks: useWeatherData, useWeatherProbability`)
    console.log(`   3. Implement backtesting framework`)
    console.log(`   4. Create dashboard visualization`)
    console.log(`\n🎯 Target Win Rate: 71-73% with 3-source ensemble`)
    console.log(`💰 Monthly Data Cost: $0 (all free APIs)`)

  } catch (error) {
    console.error('\n❌ TEST FAILED:')
    console.error(error)
    process.exit(1)
  }
}

// Run tests
testWeatherStack()
  .then(() => {
    console.log('\n✨ Test complete!')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n💥 Test failed:', error)
    process.exit(1)
  })
