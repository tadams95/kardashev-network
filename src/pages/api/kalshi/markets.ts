// Live Kalshi weather markets API
// Fetches active weather markets with RSA authentication

import type { NextApiRequest, NextApiResponse } from 'next'
import * as crypto from 'crypto'
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
  strike_type: string
  yes_sub_title: string
  no_sub_title: string
  last_price?: number
  volume?: number
  liquidity?: number
}

// ============================================================================
// Environment Variables
// ============================================================================

const KALSHI_API_BASE = 'https://demo-api.kalshi.co/trade-api/v2'
const API_KEY_ID = process.env.API_KEY_ID || ''
const KALSHI_PRIVATE_KEY = process.env.KALSHI_PRIVATE_KEY || ''

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
// Kalshi Authentication
// ============================================================================

/**
 * Generate JWT token signed with RSA private key
 */
function generateJWT(): string {
  if (!API_KEY_ID || !KALSHI_PRIVATE_KEY) {
    throw new Error('Kalshi API credentials not configured. Set API_KEY_ID and KALSHI_PRIVATE_KEY in .env.local')
  }

  const now = Math.floor(Date.now() / 1000)
  const exp = now + 300 // 5 minutes

  const header = { alg: 'RS256', typ: 'JWT' }
  const payload = { iss: API_KEY_ID, exp, iat: now }

  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url')
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')

  const message = `${encodedHeader}.${encodedPayload}`
  const sign = crypto.createSign('RSA-SHA256')
  sign.update(message)
  sign.end()

  const signature = sign.sign(KALSHI_PRIVATE_KEY, 'base64url')

  return `${message}.${signature}`
}

/**
 * Login to Kalshi API and get session token
 */
async function getKalshiToken(): Promise<string> {
  const jwt = generateJWT()

  const response = await fetch(`${KALSHI_API_BASE}/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${jwt}`,
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Kalshi login failed: ${response.status} ${errorText}`)
  }

  const data = await response.json()
  return data.token
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
  direction: 'above' | 'below'
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
  let direction: 'above' | 'below' = 'above'

  if (ticker.includes('HIGH') || ticker.includes('TEMP') || ticker.includes('HOT')) {
    marketType = 'temperature'

    // Extract temperature (in Fahrenheit)
    const tempMatch = title.match(/(\d+)\s*(?:°f|degrees|deg|f)/i) ||
                      yesSubTitle.match(/(\d+)\s*(?:°f|degrees|deg|f)/i)

    if (tempMatch) {
      threshold = parseInt(tempMatch[1])
    }

    if (title.includes('below') || title.includes('under') || ticker.includes('LOW')) {
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

  if (!marketType || threshold === null) return null

  return {
    city: cityInfo.name,
    cityCode,
    marketType,
    threshold,
    direction,
  }
}

/**
 * Calculate hours until market resolution
 */
function calculateHoursToResolution(expirationTime: string): number {
  const expiration = new Date(expirationTime).getTime()
  const now = Date.now()
  const diffMs = expiration - now
  return Math.max(0, diffMs / (1000 * 60 * 60))
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

  return {
    id: market.ticker,
    platform: 'Kalshi',
    question: market.title,
    outcome: parsed.marketType === 'temperature'
      ? `${parsed.threshold}°F ${parsed.direction}`
      : `${parsed.threshold} inches`,
    threshold: parsed.threshold,
    direction: parsed.direction,
    location: {
      lat: cityInfo.lat,
      lng: cityInfo.lng,
      city: cityInfo.name,
    },
    resolutionTime: market.expiration_time,
    currentPrice: market.last_price || 0,
    volume: market.volume || 0,
    liquidity: market.liquidity || 0,
    status: market.status === 'active' ? 'active' : market.status === 'settled' ? 'resolved' : 'canceled',
  }
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
    const validStatus = status === 'settled' ? 'settled' : 'active'

    // Check cache unless bypassed
    const cacheKey = `kalshi:markets:${cityFilter || 'all'}:${validStatus}`
    if (!bypassCache) {
      const cached = getCached(cacheKey)
      if (cached) {
        return res.status(200).json(cached)
      }
    }

    // Check for API credentials
    if (!API_KEY_ID || !KALSHI_PRIVATE_KEY) {
      // Graceful degradation: Return empty array
      const response: KalshiMarketsApiResponse = {
        success: true,
        data: {
          markets: [],
          count: 0,
        },
        error: 'Kalshi API credentials not configured. Set API_KEY_ID and KALSHI_PRIVATE_KEY in .env.local',
        timestamp: Date.now(),
      }
      return res.status(200).json(response)
    }

    // Login to Kalshi
    const token = await getKalshiToken()

    // Fetch markets with pagination
    const allMarkets: WeatherMarket[] = []
    let cursor: string | null = null
    let iterations = 0
    const MAX_ITERATIONS = 5

    do {
      const url = new URL(`${KALSHI_API_BASE}/markets`)
      url.searchParams.set('status', validStatus)
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
        if (response.status === 429) {
          // Rate limit: wait and retry once
          await new Promise(resolve => setTimeout(resolve, 1000))
          continue
        }
        throw new Error(`Kalshi API error: ${response.status}`)
      }

      const data = await response.json()
      const fetchedMarkets: KalshiMarketRaw[] = data.markets || []

      // Filter for weather markets
      const weatherMarkets = fetchedMarkets.filter((m: KalshiMarketRaw) => {
        const ticker = m.ticker.toUpperCase()
        const title = m.title.toLowerCase()
        return ticker.includes('HIGH') ||
               ticker.includes('TEMP') ||
               ticker.includes('RAIN') ||
               ticker.includes('SNOW') ||
               title.includes('temperature') ||
               title.includes('precipitation')
      })

      // Parse and convert markets
      for (const market of weatherMarkets) {
        const parsed = parseKalshiTicker(market)
        if (!parsed) continue

        // Filter by city if specified
        if (cityFilter && typeof cityFilter === 'string') {
          const filterUpper = cityFilter.toUpperCase()
          if (parsed.cityCode !== filterUpper) continue
        }

        const weatherMarket = convertToWeatherMarket(market, parsed)
        if (weatherMarket) {
          allMarkets.push(weatherMarket)
        }
      }

      cursor = data.cursor || null
      iterations++

    } while (cursor && iterations < MAX_ITERATIONS)

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
    console.error('❌ Kalshi markets API error:', error)

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
