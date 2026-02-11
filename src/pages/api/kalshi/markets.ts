// Live Kalshi weather markets API
// Fetches active weather markets from public API (no auth required)

import type { NextApiRequest, NextApiResponse } from 'next'
import { getCityCoordinates, CITY_COORDS } from '@/lib/utils/cityCoordinates'
import type { WeatherMarket } from '@/types/weather'

// ============================================================================
// Types
// ============================================================================

interface KalshiMarketsApiResponse {
  success: boolean
  data?: {
    markets: WeatherMarket[]
    count: number
  }
  error?: string
  cached?: boolean
  timestamp: number
}

interface KalshiMarketRaw {
  ticker: string
  title: string
  category: string
  status: string
  result?: string
  close_time: string
  expiration_time: string
  expected_expiration_time?: string  // When market is expected to settle
  strike_type: string
  floor_strike?: number | null
  cap_strike?: number | null
  yes_sub_title: string
  no_sub_title: string
  subtitle?: string
  last_price_dollars?: string  // API returns string e.g. "0.0300"
  last_price?: number          // cents e.g. 3
  yes_price?: number
  yes_ask?: number             // Best ask price (cents)
  yes_bid?: number             // Best bid price (cents)
  no_ask?: number
  no_bid?: number
  volume?: number
  liquidity?: number
  event_ticker?: string
}

// ============================================================================
// Constants
// ============================================================================

const KALSHI_API_BASE = 'https://api.elections.kalshi.com/trade-api/v2'

// Weather series tickers to query (KXHIGH{city} for temperature markets)
const WEATHER_SERIES_PREFIXES = ['KXHIGH', 'KXHIGHT', 'KXLOW', 'KXRAIN', 'KXSNOW']

// ============================================================================
// In-Memory Cache
// ============================================================================

interface CacheEntry {
  data: KalshiMarketsApiResponse
  timestamp: number
}

const marketsCache = new Map<string, CacheEntry>()
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes
const CACHE_MAX_SIZE = 50 // Max 50 cache entries

function getCached(key: string): KalshiMarketsApiResponse | null {
  const entry = marketsCache.get(key)
  if (!entry) return null

  const age = Date.now() - entry.timestamp
  if (age > CACHE_TTL) {
    marketsCache.delete(key)
    return null
  }

  return {
    ...entry.data,
    cached: true,
  }
}

function setCache(key: string, data: KalshiMarketsApiResponse): void {
  // Evict oldest entry if cache is full
  if (marketsCache.size >= CACHE_MAX_SIZE) {
    const oldestKey = marketsCache.keys().next().value
    if (oldestKey) marketsCache.delete(oldestKey)
  }

  marketsCache.set(key, {
    data,
    timestamp: Date.now(),
  })
}

// ============================================================================
// Market Parsing
// ============================================================================

/**
 * Parse Kalshi ticker to extract market details
 */
function parseKalshiTicker(
  market: KalshiMarketRaw
): {
  city: string
  cityCode: string
  marketType: 'temperature' | 'precipitation'
  threshold: number
  direction: 'above' | 'below' | 'between'
  capStrike?: number
} | null {
  const ticker = market.ticker.toUpperCase()
  const title = market.title.toLowerCase()
  const yesSubTitle = market.yes_sub_title?.toLowerCase() || ''

  // Extract city code from ticker
  let cityCode: string | null = null
  for (const code of Object.keys(CITY_COORDS)) {
    if (ticker.includes(code)) {
      cityCode = code
      break
    }
  }

  if (!cityCode) return null

  const cityInfo = getCityCoordinates(cityCode)
  if (!cityInfo) return null

  // Determine market type and threshold
  let marketType: 'temperature' | 'precipitation' | null = null
  let threshold: number | null = null
  let direction: 'above' | 'below' | 'between' = 'above'
  let capStrike: number | undefined = undefined

  if (ticker.includes('HIGH') || ticker.includes('TEMP') || ticker.includes('HOT')) {
    marketType = 'temperature'

    if (market.strike_type === 'between') {
      direction = 'between'
      // Use floor_strike as threshold (lower bound)
      if (market.floor_strike != null) {
        threshold = market.floor_strike
      }
      if (market.cap_strike != null) {
        capStrike = market.cap_strike
      }
    } else {
      // Use floor_strike directly from API (most reliable)
      if (market.floor_strike != null) {
        threshold = market.floor_strike
      } else {
        // Fallback: parse from title/subtitle (bare ° without trailing 'f')
        const tempMatch = title.match(/[><]?\s*(\d+)°/) ||
                          yesSubTitle.match(/(\d+)°/)
        if (tempMatch) threshold = parseInt(tempMatch[1])
      }

      if (market.strike_type === 'less' || title.includes('below') || title.includes('under') || ticker.includes('LOW')) {
        direction = 'below'
      }
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

  if (!marketType || threshold === null) return null

  return {
    city: cityInfo.name,
    cityCode,
    marketType,
    threshold,
    direction,
    capStrike,
  }
}

/**
 * Convert raw Kalshi market to WeatherMarket format
 */
function convertToWeatherMarket(
  market: KalshiMarketRaw,
  parsed: ReturnType<typeof parseKalshiTicker>
): WeatherMarket | null {
  if (!parsed) return null

  const cityInfo = getCityCoordinates(parsed.cityCode)
  if (!cityInfo) return null

  // Extract bid/ask (cents → dollars)
  const yesBid = market.yes_bid != null ? market.yes_bid / 100 : undefined
  const yesAsk = market.yes_ask != null ? market.yes_ask / 100 : undefined

  // Prefer mid-price when bid/ask available, otherwise fall back to last trade
  let currentPrice: number
  if (yesBid != null && yesAsk != null && yesBid > 0 && yesAsk > 0) {
    currentPrice = (yesBid + yesAsk) / 2 // Mid-price is more accurate than last trade
  } else {
    // Fall back to last_price_dollars or last_price
    const rawPrice = market.last_price_dollars != null
      ? parseFloat(String(market.last_price_dollars))
      : NaN
    currentPrice = !isNaN(rawPrice)
      ? rawPrice
      : (market.last_price != null ? market.last_price / 100 : (market.yes_price ? market.yes_price / 100 : 0))
  }

  const spread = (yesBid != null && yesAsk != null) ? yesAsk - yesBid : undefined

  // Build outcome string
  let outcome: string
  if (parsed.marketType === 'temperature') {
    if (parsed.direction === 'between' && parsed.capStrike != null) {
      outcome = `${parsed.threshold}° to ${parsed.capStrike}°F`
    } else {
      outcome = `${parsed.threshold}°F ${parsed.direction}`
    }
  } else {
    outcome = `${parsed.threshold} inches`
  }

  return {
    id: market.ticker,
    platform: 'Kalshi',
    question: market.title,
    outcome,
    threshold: parsed.threshold,
    capStrike: parsed.capStrike,
    direction: parsed.direction,
    eventTicker: market.event_ticker,
    location: {
      lat: cityInfo.lat,
      lng: cityInfo.lng,
      city: cityInfo.name,
    },
    resolutionTime: market.close_time,
    currentPrice,
    volume: market.volume || 0,
    liquidity: market.liquidity || 0,
    yesBid,
    yesAsk,
    spread,
    status: market.status === 'active' ? 'active' : market.status === 'settled' ? 'resolved' : 'canceled',
  }
}

// ============================================================================
// City Code Expansion
// ============================================================================

/**
 * Expand a city code to include all aliases that map to the same city name.
 * E.g. "NY" -> ["NY", "NYC"] so both KXHIGHNY and KXHIGHNYC are queried.
 */
function expandCityCodes(code: string): string[] {
  const city = CITY_COORDS[code]
  if (!city) return [code]

  const codes = Object.entries(CITY_COORDS)
    .filter(([, info]) => info.name === city.name)
    .map(([key]) => key)

  if (!codes.includes(code)) codes.push(code)
  return codes
}

// ============================================================================
// API Handler
// ============================================================================

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<KalshiMarketsApiResponse>
) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed',
      timestamp: Date.now(),
    })
  }

  try {
    // Parse query parameters
    const { city: cityFilter, status = 'active', bypassCache } = req.query

    // Validate status
    const validStatus = status === 'settled' ? 'settled' : 'open'

    // Check cache unless bypassed
    const cacheKey = `kalshi:markets:${cityFilter || 'all'}:${validStatus}`
    if (!bypassCache) {
      const cached = getCached(cacheKey)
      if (cached) {
        return res.status(200).json(cached)
      }
    }

    // Build series tickers to query
    // Use targeted series_ticker queries instead of fetching all markets
    const cityCodes = cityFilter && typeof cityFilter === 'string'
      ? expandCityCodes(cityFilter.toUpperCase())
      : Object.keys(CITY_COORDS)

    const allMarkets: WeatherMarket[] = []

    for (const prefix of WEATHER_SERIES_PREFIXES) {
      for (const cityCode of cityCodes) {
        const seriesTicker = `${prefix}${cityCode}`

        const url = new URL(`${KALSHI_API_BASE}/markets`)
        url.searchParams.set('series_ticker', seriesTicker)
        url.searchParams.set('status', validStatus)
        url.searchParams.set('limit', '200')

        try {
          const response = await fetch(url.toString(), {
            headers: {
              'Accept': 'application/json',
            },
          })

          if (!response.ok) {
            if (response.status === 429) {
              // Rate limit: wait and retry once
              await new Promise(resolve => setTimeout(resolve, 1000))
              continue
            }
            // Series may not exist for every city/prefix combo — skip silently
            continue
          }

          const data = await response.json()
          const fetchedMarkets: KalshiMarketRaw[] = data.markets || []

          for (const market of fetchedMarkets) {
            const parsed = parseKalshiTicker(market)
            if (!parsed) continue

            const weatherMarket = convertToWeatherMarket(market, parsed)
            if (weatherMarket) {
              allMarkets.push(weatherMarket)
            }
          }
        } catch (fetchError) {
          // Log but continue — don't let one failed series block others
          console.warn(`Failed to fetch ${seriesTicker}:`, fetchError)
        }
      }
    }

    // Build response
    const response: KalshiMarketsApiResponse = {
      success: true,
      data: {
        markets: allMarkets,
        count: allMarkets.length,
      },
      timestamp: Date.now(),
    }

    // Cache response
    setCache(cacheKey, response)

    // Return response
    return res.status(200).json(response)

  } catch (error) {
    console.error('Kalshi markets API error:', error)

    // Graceful degradation: Return empty array with error message
    const response: KalshiMarketsApiResponse = {
      success: false,
      data: {
        markets: [],
        count: 0,
      },
      error: error instanceof Error ? error.message : 'Failed to fetch Kalshi markets',
      timestamp: Date.now(),
    }

    return res.status(200).json(response)
  }
}
