// Fetch REAL Kalshi historical weather market data with authentication
// Cross-reference with actual historical weather from Open-Meteo Archive
// Validate outcomes match reality

import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'

// Load environment variables from .env.local
function loadEnvFile() {
  try {
    const envPath = path.join(__dirname, '../.env.local')
    const envContent = fs.readFileSync(envPath, 'utf-8')
    const lines = envContent.split('\n')

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue

      const match = trimmed.match(/^([^=]+)=(.*)$/)
      if (match) {
        const key = match[1].trim()
        let value = match[2].trim()

        // Handle multi-line values (private keys)
        if (value.includes('BEGIN')) {
          let fullValue = value
          let currentIndex = lines.indexOf(line)
          currentIndex++

          while (currentIndex < lines.length && !lines[currentIndex].includes('END')) {
            fullValue += '\n' + lines[currentIndex]
            currentIndex++
          }
          if (currentIndex < lines.length) {
            fullValue += '\n' + lines[currentIndex]
          }
          value = fullValue
        }

        process.env[key] = value
      }
    }
  } catch (error) {
    console.warn('Warning: Could not load .env.local file')
  }
}

loadEnvFile()

const KALSHI_API_BASE = 'https://demo-api.kalshi.co/trade-api/v2'
const API_KEY_ID = process.env.API_KEY_ID || ''
const KALSHI_PRIVATE_KEY = process.env.KALSHI_PRIVATE_KEY || ''

interface KalshiMarket {
  ticker: string
  title: string
  category: string
  status: string
  result: string
  close_time: string
  expiration_time: string
  strike_type: string
  ranged_group_name?: string
  yes_sub_title: string
  no_sub_title: string
  last_price?: number
  volume?: number
  open_interest?: number
}

interface HistoricalWeather {
  date: string
  tempMax: number
  tempMin: number
  precipSum: number
  tempAvg: number
}

interface ValidatedMarket {
  ticker: string
  date: string
  city: string
  lat: number
  lng: number
  market_type: 'temperature' | 'precipitation'
  threshold: number
  direction: 'above' | 'below'
  kalshi_outcome: boolean
  actual_weather: HistoricalWeather
  actual_outcome: boolean
  outcomes_match: boolean
  market_price: number
  volume: number
}

// City coordinates
const CITY_COORDS: Record<string, { lat: number; lng: number; name: string }> = {
  'NYC': { lat: 40.7128, lng: -74.0060, name: 'New York' },
  'CHI': { lat: 41.8781, lng: -87.6298, name: 'Chicago' },
  'LA': { lat: 34.0522, lng: -118.2437, name: 'Los Angeles' },
  'SF': { lat: 37.7749, lng: -122.4194, name: 'San Francisco' },
  'MIA': { lat: 25.7617, lng: -80.1918, name: 'Miami' },
  'DAL': { lat: 32.7767, lng: -96.7970, name: 'Dallas' },
  'HOU': { lat: 29.7604, lng: -95.3698, name: 'Houston' },
  'PHX': { lat: 33.4484, lng: -112.0740, name: 'Phoenix' },
  'SEA': { lat: 47.6062, lng: -122.3321, name: 'Seattle' },
  'BOS': { lat: 42.3601, lng: -71.0589, name: 'Boston' },
  'DEN': { lat: 39.7392, lng: -104.9903, name: 'Denver' },
  'ATL': { lat: 33.7490, lng: -84.3880, name: 'Atlanta' },
}

/**
 * Generate JWT token signed with RSA private key
 */
function generateJWT(): string {
  if (!API_KEY_ID || !KALSHI_PRIVATE_KEY) {
    throw new Error('Kalshi API credentials not found. Set API_KEY_ID and KALSHI_PRIVATE_KEY environment variables.')
  }

  const now = Math.floor(Date.now() / 1000)
  const exp = now + 300 // 5 minutes from now

  // JWT header
  const header = {
    alg: 'RS256',
    typ: 'JWT',
  }

  // JWT payload
  const payload = {
    iss: API_KEY_ID,
    exp: exp,
    iat: now,
  }

  // Encode header and payload
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url')
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')

  // Sign with private key
  const message = `${encodedHeader}.${encodedPayload}`
  const sign = crypto.createSign('RSA-SHA256')
  sign.update(message)
  sign.end()

  const signature = sign.sign(KALSHI_PRIVATE_KEY, 'base64url')

  return `${message}.${signature}`
}

/**
 * Generate login token for Kalshi API using RSA authentication
 */
async function getKalshiToken(): Promise<string> {
  const jwt = generateJWT()

  const url = `${KALSHI_API_BASE}/login`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${jwt}`,
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Kalshi login failed: ${response.status} ${response.statusText}\n${errorText}`)
  }

  const data = await response.json()
  return data.token
}

/**
 * Fetch settled weather markets from Kalshi
 */
async function fetchKalshiWeatherMarkets(token: string): Promise<KalshiMarket[]> {
  console.log('\n🌐 Fetching Kalshi weather markets...')

  const markets: KalshiMarket[] = []
  let cursor: string | null = null

  // Fetch paginated results
  do {
    const url = new URL(`${KALSHI_API_BASE}/markets`)
    url.searchParams.set('status', 'settled')
    url.searchParams.set('limit', '200')
    if (cursor) {
      url.searchParams.set('cursor', cursor)
    }

    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    })

    if (!response.ok) {
      console.error(`   ❌ Error fetching markets: ${response.status}`)
      break
    }

    const data = await response.json()
    const fetchedMarkets = data.markets || []

    // Filter for weather markets
    const weatherMarkets = fetchedMarkets.filter((m: KalshiMarket) => {
      const ticker = m.ticker.toUpperCase()
      const title = m.title.toLowerCase()
      return ticker.includes('HIGH') ||
             ticker.includes('TEMP') ||
             ticker.includes('RAIN') ||
             ticker.includes('SNOW') ||
             title.includes('temperature') ||
             title.includes('precipitation')
    })

    markets.push(...weatherMarkets)
    cursor = data.cursor || null

    console.log(`   Fetched ${fetchedMarkets.length} markets (${weatherMarkets.length} weather)`)

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 100))

  } while (cursor && markets.length < 500) // Limit to 500 markets

  console.log(`   ✅ Total weather markets: ${markets.length}`)
  return markets
}

/**
 * Fetch actual historical weather from Open-Meteo Archive
 */
async function fetchActualWeather(
  lat: number,
  lng: number,
  date: string
): Promise<HistoricalWeather> {
  const url = new URL('https://archive-api.open-meteo.com/v1/archive')
  url.searchParams.set('latitude', lat.toString())
  url.searchParams.set('longitude', lng.toString())
  url.searchParams.set('start_date', date)
  url.searchParams.set('end_date', date)
  url.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min,precipitation_sum')
  url.searchParams.set('temperature_unit', 'fahrenheit')
  url.searchParams.set('precipitation_unit', 'inch')
  url.searchParams.set('timezone', 'auto')

  const response = await fetch(url.toString())

  if (!response.ok) {
    throw new Error(`Open-Meteo API error: ${response.status}`)
  }

  const data = await response.json()

  return {
    date,
    tempMax: data.daily.temperature_2m_max[0],
    tempMin: data.daily.temperature_2m_min[0],
    precipSum: data.daily.precipitation_sum[0] || 0,
    tempAvg: (data.daily.temperature_2m_max[0] + data.daily.temperature_2m_min[0]) / 2,
  }
}

/**
 * Parse market details
 */
function parseMarketDetails(market: KalshiMarket): {
  city: string
  cityCode: string
  date: string
  marketType: 'temperature' | 'precipitation'
  threshold: number
  direction: 'above' | 'below'
} | null {
  const ticker = market.ticker.toUpperCase()
  const title = market.title.toLowerCase()
  const yesSubTitle = market.yes_sub_title?.toLowerCase() || ''

  // Extract city from ticker
  let cityCode: string | null = null
  for (const code of Object.keys(CITY_COORDS)) {
    if (ticker.includes(code)) {
      cityCode = code
      break
    }
  }

  if (!cityCode) {
    console.log(`  ⚠️  Could not extract city from: ${ticker}`)
    return null
  }

  const cityInfo = CITY_COORDS[cityCode]

  // Extract date from expiration_time
  const date = market.expiration_time.split('T')[0]

  // Determine market type and threshold
  let marketType: 'temperature' | 'precipitation' | null = null
  let threshold: number | null = null
  let direction: 'above' | 'below' = 'above'

  if (ticker.includes('HIGH') || ticker.includes('TEMP') || ticker.includes('HOT')) {
    marketType = 'temperature'

    // Extract temperature (in Fahrenheit)
    const tempMatch = title.match(/(\d+)\s*(?:°f|degrees|deg|f)/i) ||
                      yesSubTitle.match(/(\d+)\s*(?:°f|degrees|deg|f)/i)

    if (tempMatch) {
      threshold = parseInt(tempMatch[1])
    }

    if (title.includes('below') || title.includes('under')) {
      direction = 'below'
    }
  } else if (ticker.includes('RAIN') || ticker.includes('SNOW') || ticker.includes('PRECIP')) {
    marketType = 'precipitation'

    // Extract precipitation amount (in inches)
    const precipMatch = title.match(/([\d.]+)\s*(?:inch|in|")/i) ||
                        yesSubTitle.match(/([\d.]+)\s*(?:inch|in|")/i)

    if (precipMatch) {
      threshold = parseFloat(precipMatch[1])
    } else {
      threshold = 0.01 // Any precipitation
    }
  }

  if (!marketType || threshold === null) {
    console.log(`  ⚠️  Could not parse: ${ticker}`)
    return null
  }

  return {
    city: cityInfo.name,
    cityCode,
    date,
    marketType,
    threshold,
    direction,
  }
}

/**
 * Validate market outcome against actual weather
 */
function validateOutcome(
  marketDetails: ReturnType<typeof parseMarketDetails>,
  actualWeather: HistoricalWeather
): boolean {
  if (!marketDetails) return false

  if (marketDetails.marketType === 'temperature') {
    const actualValue = actualWeather.tempMax
    if (marketDetails.direction === 'above') {
      return actualValue > marketDetails.threshold
    } else {
      return actualValue < marketDetails.threshold
    }
  } else {
    // Precipitation
    return actualWeather.precipSum >= marketDetails.threshold
  }
}

/**
 * Main function
 */
async function collectRealData() {
  console.log('📊 Real Kalshi Data Collector with Weather Validation')
  console.log('='.repeat(70))

  // Check for API credentials
  if (!API_KEY_ID || !KALSHI_PRIVATE_KEY) {
    console.log('\n⚠️  Kalshi API credentials not configured')
    console.log('\n📝 Setup Instructions:')
    console.log('   1. Create Kalshi account at https://kalshi.com')
    console.log('   2. Generate API key at https://kalshi.com/settings/api')
    console.log('   3. Add to .env.local:')
    console.log('      API_KEY_ID=your_key_id')
    console.log('      KALSHI_PRIVATE_KEY=-----BEGIN RSA PRIVATE KEY-----...')
    console.log('\n💡 For now, using sample data generator...\n')
    return null
  }

  try {
    // Login to Kalshi
    console.log('\n🔐 Authenticating with Kalshi...')
    const token = await getKalshiToken()
    console.log('   ✅ Authenticated')

    // Fetch markets
    const markets = await fetchKalshiWeatherMarkets(token)

    if (markets.length === 0) {
      console.log('\n⚠️  No settled weather markets found')
      return null
    }

    // Validate each market
    console.log('\n🔍 Validating markets against actual weather...')
    const validatedMarkets: ValidatedMarket[] = []

    for (let i = 0; i < markets.length; i++) {
      const market = markets[i]

      // Parse market
      const details = parseMarketDetails(market)
      if (!details) continue

      const cityInfo = CITY_COORDS[details.cityCode]
      if (!cityInfo) continue

      try {
        // Fetch actual weather
        const actualWeather = await fetchActualWeather(
          cityInfo.lat,
          cityInfo.lng,
          details.date
        )

        // Validate outcome
        const actualOutcome = validateOutcome(details, actualWeather)
        const kalshiOutcome = market.result === 'yes'
        const outcomesMatch = actualOutcome === kalshiOutcome

        validatedMarkets.push({
          ticker: market.ticker,
          date: details.date,
          city: details.city,
          lat: cityInfo.lat,
          lng: cityInfo.lng,
          market_type: details.marketType,
          threshold: details.threshold,
          direction: details.direction,
          kalshi_outcome: kalshiOutcome,
          actual_weather: actualWeather,
          actual_outcome: actualOutcome,
          outcomes_match: outcomesMatch,
          market_price: market.last_price ? market.last_price / 100 : 0.50,
          volume: market.volume || 0,
        })

        if (!outcomesMatch) {
          console.log(`   ⚠️  MISMATCH: ${market.ticker}`)
          console.log(`      Kalshi: ${kalshiOutcome ? 'YES' : 'NO'}, Actual: ${actualOutcome ? 'YES' : 'NO'}`)
          console.log(`      Actual: ${details.marketType === 'temperature' ? `${actualWeather.tempMax.toFixed(1)}°F` : `${actualWeather.precipSum.toFixed(2)}"`}`)
        }

        // Rate limiting
        if (i % 10 === 0) {
          console.log(`   Processed ${i + 1}/${markets.length} markets...`)
          await new Promise(resolve => setTimeout(resolve, 100))
        }

      } catch (error) {
        console.error(`   ❌ Error validating ${market.ticker}:`, error instanceof Error ? error.message : error)
      }
    }

    // Summary
    console.log('\n' + '='.repeat(70))
    console.log('✅ Validation Complete')
    console.log(`   Total markets: ${validatedMarkets.length}`)
    console.log(`   Matching outcomes: ${validatedMarkets.filter(m => m.outcomes_match).length}`)
    console.log(`   Mismatches: ${validatedMarkets.filter(m => !m.outcomes_match).length}`)
    console.log('='.repeat(70))

    return validatedMarkets

  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : error)
    return null
  }
}

/**
 * Save validated data to CSV
 */
function saveValidatedData(markets: ValidatedMarket[], outputPath: string) {
  const header = 'date,location,city,lat,lng,market_type,threshold,direction,outcome,market_price,kalshi_id,actual_temp_max,actual_precip,outcomes_match\n'

  const csvContent = header + markets
    .filter(m => m.outcomes_match) // Only use markets where outcomes match reality
    .map(m => {
      return [
        m.date,
        m.city.replace(' ', '').substring(0, 3).toUpperCase(),
        m.city,
        m.lat,
        m.lng,
        m.market_type,
        m.threshold,
        m.direction,
        m.actual_outcome ? 1 : 0, // Use actual outcome (validated)
        m.market_price.toFixed(2),
        m.ticker,
        m.actual_weather.tempMax.toFixed(1),
        m.actual_weather.precipSum.toFixed(2),
        m.outcomes_match ? 'true' : 'false',
      ].join(',')
    }).join('\n')

  fs.writeFileSync(outputPath, csvContent, 'utf-8')
  console.log(`\n💾 Saved ${markets.filter(m => m.outcomes_match).length} validated markets to: ${outputPath}`)
}

// Run
collectRealData()
  .then((markets) => {
    if (markets && markets.length > 0) {
      const outputPath = path.join(__dirname, '../data/weather/kalshi_validated_2024.csv')
      saveValidatedData(markets, outputPath)

      console.log('\n🎉 Success! Real Kalshi data collected and validated')
      console.log('\n📈 Next steps:')
      console.log('   1. Review validated data: cat data/weather/kalshi_validated_2024.csv')
      console.log('   2. Run real backtest: npx tsx test-backtest.ts')
      console.log('   3. Compare to sample data results')
    } else {
      console.log('\n💡 No data collected. Using sample data for demo purposes.')
    }
  })
  .catch((error) => {
    console.error('\n💥 Fatal error:', error)
    process.exit(1)
  })
