// Collect REAL historical weather market data from Kalshi
// Uses PUBLIC market data API (no authentication required!)

import * as fs from 'fs'
import * as path from 'path'

const KALSHI_API_BASE = 'https://api.elections.kalshi.com/trade-api/v2'

interface KalshiMarket {
  ticker: string
  result: 'yes' | 'no' | ''
  last_price_dollars: number
  settlement_ts: string
  close_time: string
  yes_sub_title: string
  no_sub_title: string
  event_ticker: string
  rules_primary: string
}

interface KalshiMarketsResponse {
  markets: KalshiMarket[]
  cursor?: string
}

/**
 * Fetch settled markets from Kalshi (NO AUTH REQUIRED for public market data!)
 */
async function fetchSettledMarkets(
  startDateMs: number,
  endDateMs: number,
  seriesFilter?: string
): Promise<KalshiMarket[]> {
  console.log('📊 Fetching settled markets from Kalshi...')
  console.log(`   Date range: ${new Date(startDateMs).toISOString()} to ${new Date(endDateMs).toISOString()}`)

  const allMarkets: KalshiMarket[] = []
  let cursor: string | undefined = undefined
  let pageNum = 1

  do {
    const url = new URL(`${KALSHI_API_BASE}/markets`)
    url.searchParams.set('status', 'settled')
    url.searchParams.set('min_settled_ts', startDateMs.toString())
    url.searchParams.set('max_settled_ts', endDateMs.toString())
    url.searchParams.set('limit', '1000')

    if (seriesFilter) {
      url.searchParams.set('series_ticker', seriesFilter)
    }

    if (cursor) {
      url.searchParams.set('cursor', cursor)
    }

    console.log(`\n   Fetching page ${pageNum}...`)

    const response = await fetch(url.toString(), {
      headers: {
        'Accept': 'application/json',
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Kalshi API error: ${response.status} ${response.statusText}\n${errorText}`)
    }

    const data: KalshiMarketsResponse = await response.json()

    console.log(`   ✅ Retrieved ${data.markets.length} markets`)
    allMarkets.push(...data.markets)

    cursor = data.cursor
    pageNum++

    // Rate limiting: be respectful
    await new Promise(resolve => setTimeout(resolve, 100))

  } while (cursor)

  console.log(`\n✅ Total markets fetched: ${allMarkets.length}`)
  return allMarkets
}

/**
 * Filter for weather markets
 */
function filterWeatherMarkets(markets: KalshiMarket[]): KalshiMarket[] {
  return markets.filter(m => {
    const ticker = m.ticker.toUpperCase()
    const title = m.yes_sub_title?.toLowerCase() || ''

    // Weather indicators
    return (
      ticker.includes('HIGH') ||
      ticker.includes('LOW') ||
      ticker.includes('TEMP') ||
      ticker.includes('RAIN') ||
      ticker.includes('SNOW') ||
      title.includes('temperature') ||
      title.includes('precipitation') ||
      title.includes('°f') ||
      title.includes('degrees')
    )
  })
}

/**
 * Parse weather market details from Kalshi data
 * Format: HIGHNY-24SEP29-T71 ("72° or above"), HIGHNY-24SEP29-T64 ("63° or below")
 */
function parseWeatherMarket(market: KalshiMarket): {
  ticker: string
  date: string
  city: string
  marketType: 'temperature' | 'precipitation'
  threshold: number
  direction: 'above' | 'below'
  outcome: boolean
  marketPrice: number
} | null {
  const ticker = market.ticker
  const yesTitle = market.yes_sub_title || ''

  // Parse ticker: HIGHNY-24SEP29-T71 or RAINCHI-24JUL15-T0.5
  const tickerMatch = ticker.match(/^(HIGH|LOW|RAIN|SNOW|TEMP)([A-Z]{2,3})-(\d{2})([A-Z]{3})(\d{2})-/)
  if (!tickerMatch) {
    // Skip bracket markets (B66.5) and other complex formats for now
    return null
  }

  const [, marketTypeCode, cityCode, year, month, day] = tickerMatch

  // Parse date
  const monthNames = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
  const monthIndex = monthNames.indexOf(month)
  if (monthIndex === -1) return null

  const fullYear = 2000 + parseInt(year)
  const date = `${fullYear}-${String(monthIndex + 1).padStart(2, '0')}-${day}`

  // Determine market type
  let marketType: 'temperature' | 'precipitation'
  let threshold: number | null = null
  let direction: 'above' | 'below' = 'above'

  if (marketTypeCode === 'HIGH' || marketTypeCode === 'LOW' || marketTypeCode === 'TEMP') {
    marketType = 'temperature'

    // Parse yes_sub_title: "72° or above", "63° or below", "70° to 71°"
    if (yesTitle.match(/\d+°?\s*(or\s*)?(above|or higher)/i)) {
      direction = 'above'
      const match = yesTitle.match(/(\d+)°/)
      if (match) threshold = parseInt(match[1])
    } else if (yesTitle.match(/\d+°?\s*(or\s*)?(below|or lower)/i)) {
      direction = 'below'
      const match = yesTitle.match(/(\d+)°/)
      if (match) threshold = parseInt(match[1])
    } else if (yesTitle.match(/(\d+)°\s*to\s*(\d+)°/)) {
      // Bracket market - skip for now
      return null
    }
  } else {
    marketType = 'precipitation'

    // Parse precipitation: "0.5\" or more"
    const precipMatch = yesTitle.match(/(\d+\.?\d*)\s*["'in]/i)
    if (precipMatch) {
      threshold = parseFloat(precipMatch[1])
    } else {
      threshold = 0.01 // Default: any measurable
    }
  }

  if (threshold === null) {
    return null
  }

  // Outcome
  const outcome = market.result === 'yes'

  // Price (handle null/undefined, default to 50%)
  const marketPrice = market.last_price_dollars ?? 0.50

  return {
    ticker,
    date,
    city: cityCode,
    marketType,
    threshold,
    direction,
    outcome,
    marketPrice,
  }
}

/**
 * Main collection function
 */
async function collectHistoricalData() {
  console.log('🎯 Kalshi Historical Weather Data Collector')
  console.log('='.repeat(70))
  console.log('\n📝 Note: Using PUBLIC market data API (no authentication required)')

  try {
    // Fetch settled markets from summer 2024
    const startDate = new Date('2024-06-01T00:00:00Z').getTime()
    const endDate = new Date('2024-09-30T23:59:59Z').getTime()

    const markets = await fetchSettledMarkets(startDate, endDate)

    // Filter for weather markets
    console.log('\n🌤️  Filtering for weather markets...')
    const weatherMarkets = filterWeatherMarkets(markets)
    console.log(`   ✅ Found ${weatherMarkets.length} weather markets`)

    // Debug: Show first few weather markets
    console.log('\n🔍 Sample weather markets (first 5):')
    weatherMarkets.slice(0, 5).forEach((m, i) => {
      console.log(`\n   Market ${i + 1}:`)
      console.log(`      Ticker: ${m.ticker}`)
      console.log(`      Yes Title: ${m.yes_sub_title}`)
      console.log(`      Result: ${m.result}`)
      console.log(`      last_price_dollars: ${m.last_price_dollars}`)
      console.log(`      last_price_dollars type: ${typeof m.last_price_dollars}`)
    })

    // Parse each market
    console.log('\n🔍 Parsing market details...')
    const parsedMarketsRaw = weatherMarkets
      .map(parseWeatherMarket)
      .filter((m): m is NonNullable<typeof m> => m !== null)

    // Debug marketPrice values BEFORE validation
    console.log('\n🔍 Debugging marketPrice values (first 10 parsed markets):')
    parsedMarketsRaw.slice(0, 10).forEach((m, i) => {
      console.log(`\n   ${i + 1}. ${m.ticker}`)
      console.log(`      marketPrice value: ${m.marketPrice}`)
      console.log(`      marketPrice type: ${typeof m.marketPrice}`)
      console.log(`      is number: ${typeof m.marketPrice === 'number'}`)
      console.log(`      is NaN: ${isNaN(m.marketPrice as any)}`)
    })

    const parsedMarkets = parsedMarketsRaw
      .filter(m => typeof m.marketPrice === 'number' && !isNaN(m.marketPrice))

    console.log(`\n   ✅ Successfully parsed ${parsedMarkets.length} markets (from ${parsedMarketsRaw.length} total)`)

    // Stats
    const tempMarkets = parsedMarkets.filter(m => m.marketType === 'temperature')
    const precipMarkets = parsedMarkets.filter(m => m.marketType === 'precipitation')
    const yesWith = parsedMarkets.filter(m => m.outcome)
    const avgPrice = parsedMarkets.length > 0
      ? parsedMarkets.reduce((sum, m) => sum + (m.marketPrice || 0), 0) / parsedMarkets.length
      : 0

    console.log('\n📊 Statistics:')
    console.log(`   Temperature markets: ${tempMarkets.length}`)
    console.log(`   Precipitation markets: ${precipMarkets.length}`)
    console.log(`   YES outcomes: ${yesWith.length} (${(yesWith.length / parsedMarkets.length * 100).toFixed(1)}%)`)
    console.log(`   Average market price: ${(avgPrice * 100).toFixed(1)}%`)

    // Save to CSV
    const csvPath = path.join(__dirname, '../data/weather/kalshi_real_2024.csv')
    const header = 'date,location,city,market_type,threshold,direction,outcome,market_price,kalshi_id\n'
    const rows = parsedMarkets.map(m =>
      `${m.date},${m.city},${m.city},${m.marketType},${m.threshold},${m.direction},${m.outcome ? 1 : 0},${(m.marketPrice || 0).toFixed(2)},${m.ticker}`
    ).join('\n')

    fs.mkdirSync(path.dirname(csvPath), { recursive: true })
    fs.writeFileSync(csvPath, header + rows, 'utf-8')

    console.log(`\n💾 Saved to: ${csvPath}`)
    console.log('\n✅ Success! Real Kalshi data collected')
    console.log('\n📈 Next steps:')
    console.log('   1. Review data: cat data/weather/kalshi_real_2024.csv | head -20')
    console.log('   2. Cross-reference with actual weather (Open-Meteo Archive)')
    console.log('   3. Run backtest with REAL market data')

  } catch (error) {
    console.error('\n❌ Error:', error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

// Run
collectHistoricalData()
  .then(() => {
    console.log('\n✨ Collection complete!')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n💥 Fatal error:', error)
    process.exit(1)
  })
