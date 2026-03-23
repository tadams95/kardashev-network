// Live Kalshi weather markets API
// Fetches active weather markets from public API (no auth required)

import type { NextApiRequest, NextApiResponse } from 'next'
import { getCityCoordinates, CITY_COORDS } from '@/lib/utils/cityCoordinates'
import { extractCityCode } from '@/lib/utils/tickerParsing'
import type { WeatherMarket } from '@/types/weather'
import { rget, rset } from '@/lib/cache/redis'

// ============================================================================
// Types
// ============================================================================

export interface KalshiMarketsApiResponse {
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

const REDIS_PREFIX = 'kalshi:'
const REDIS_TTL_S = 300

async function getCached(key: string): Promise<KalshiMarketsApiResponse | null> {
  // L1: in-memory Map
  const entry = marketsCache.get(key)
  if (entry && Date.now() - entry.timestamp <= CACHE_TTL) {
    return { ...entry.data, cached: true }
  }

  // L2: Redis
  const redisData = await rget<KalshiMarketsApiResponse>(REDIS_PREFIX + key)
  if (redisData) {
    marketsCache.set(key, { data: redisData, timestamp: Date.now() })
    return { ...redisData, cached: true }
  }

  if (entry) marketsCache.delete(key)
  return null
}

async function setCache(key: string, data: KalshiMarketsApiResponse): Promise<void> {
  // Evict oldest entry if cache is full
  if (marketsCache.size >= CACHE_MAX_SIZE) {
    const oldestKey = marketsCache.keys().next().value
    if (oldestKey) marketsCache.delete(oldestKey)
  }

  marketsCache.set(key, {
    data,
    timestamp: Date.now(),
  })

  await rset(REDIS_PREFIX + key, data, REDIS_TTL_S)
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
  temperatureType?: 'high' | 'low'
  threshold: number
  direction: 'above' | 'below' | 'between'
  capStrike?: number
} | null {
  const ticker = market.ticker.toUpperCase()
  const title = market.title.toLowerCase()
  const yesSubTitle = market.yes_sub_title?.toLowerCase() || ''

  const cityCode = extractCityCode(ticker)
  if (!cityCode) return null

  const cityInfo = getCityCoordinates(cityCode)
  if (!cityInfo) return null

  // Determine market type and threshold
  let marketType: 'temperature' | 'precipitation' | null = null
  let temperatureType: 'high' | 'low' | undefined = undefined
  let threshold: number | null = null
  let direction: 'above' | 'below' | 'between' = 'above'
  let capStrike: number | undefined = undefined

  if (ticker.includes('HIGH') || ticker.includes('LOW') || ticker.includes('TEMP') || ticker.includes('HOT')) {
    marketType = 'temperature'
    temperatureType = ticker.includes('LOW') ? 'low' : 'high'

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
      // Use floor_strike for 'greater' markets, cap_strike for 'less' markets
      if (market.floor_strike != null) {
        threshold = market.floor_strike
      } else if (market.cap_strike != null) {
        threshold = market.cap_strike
      } else {
        // Fallback: parse from title/subtitle (bare ° without trailing 'f')
        const tempMatch = title.match(/[><]?\s*(\d+)°/) ||
                          yesSubTitle.match(/(\d+)°/)
        if (tempMatch) threshold = parseInt(tempMatch[1])
      }

      if (market.strike_type === 'less' || title.includes('below') || title.includes('under')) {
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
    temperatureType,
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
  parsed: ReturnType<typeof parseKalshiTicker>,
  nowMs: number
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
    temperatureType: parsed.temperatureType,
    eventTicker: market.event_ticker,
    location: {
      lat: cityInfo.lat,
      lng: cityInfo.lng,
      city: cityInfo.name,
    },
    resolutionTime: market.expected_expiration_time || market.expiration_time,
    currentPrice,
    volume: market.volume ?? undefined,
    liquidity: market.liquidity ?? undefined,
    yesBid,
    yesAsk,
    spread,
    result: market.result === 'yes' || market.result === 'no' ? market.result : undefined,
    status: market.status === 'settled' ? 'resolved'
      : (market.result != null && market.result !== '') ? 'resolved'
      : 'active',
    tradingStatus: (market.status === 'closed' || new Date(market.close_time).getTime() <= nowMs)
      ? 'closed' : 'open',
  }
}

// ============================================================================
// Fetch with Timeout
// ============================================================================

async function fetchWithTimeout(url: string, timeoutMs = 8000): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal })
  } finally {
    clearTimeout(timer)
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
// Exported Data Function — callable from other server-side code
// ============================================================================

/**
 * Fetch Kalshi markets for a city with L1+L2 caching.
 * Returns the full API response shape. Callable from API routes and server-side code.
 */
export async function getMarketsForCity(
  cityFilter: string,
  options?: { status?: string; bypassCache?: boolean }
): Promise<KalshiMarketsApiResponse> {
  const status = options?.status ?? 'active'

  // Validate status
  const validStatuses: string[] = status === 'settled'
    ? ['settled']
    : ['open', 'closed']

  // Check cache unless bypassed
  const cacheKey = `kalshi:markets:${cityFilter || 'all'}:${status === 'settled' ? 'settled' : 'live'}`
  if (!options?.bypassCache) {
    const cached = await getCached(cacheKey)
    if (cached) return cached
  }

  // Build series tickers to query
  const cityCodes = cityFilter
    ? expandCityCodes(cityFilter.toUpperCase())
    : Object.keys(CITY_COORDS)

  const allMarkets: WeatherMarket[] = []

  // Build all fetch tasks up front, then process in batches of 5
  const fetchTasks = validStatuses.flatMap(s =>
    WEATHER_SERIES_PREFIXES.flatMap(prefix =>
      cityCodes.map(code => ({ prefix, cityCode: code, status: s }))
    )
  )

  const BATCH_SIZE = 5
  const nowMs = Date.now()

  /** Parse markets from a successful response and push into allMarkets */
  function collectMarkets(data: any): void {
    const fetchedMarkets: KalshiMarketRaw[] = data.markets || []
    for (const market of fetchedMarkets) {
      if (new Date(market.expiration_time).getTime() <= nowMs) continue
      const parsed = parseKalshiTicker(market)
      if (!parsed) continue
      const weatherMarket = convertToWeatherMarket(market, parsed, nowMs)
      if (weatherMarket) allMarkets.push(weatherMarket)
    }
  }

  const retryQueue: typeof fetchTasks = []
  let wasRateLimited = false

  for (let i = 0; i < fetchTasks.length; i += BATCH_SIZE) {
    // Stagger between batches to avoid burst patterns that trigger rate limits
    if (i > 0) await new Promise(resolve => setTimeout(resolve, 300))

    const batch = fetchTasks.slice(i, i + BATCH_SIZE)
    const results = await Promise.allSettled(
      batch.map(({ prefix, cityCode: code, status: taskStatus }) => {
        const url = new URL(`${KALSHI_API_BASE}/markets`)
        url.searchParams.set('series_ticker', `${prefix}${code}`)
        url.searchParams.set('status', taskStatus)
        url.searchParams.set('limit', '200')
        return fetchWithTimeout(url.toString())
      })
    )

    for (let j = 0; j < results.length; j++) {
      const result = results[j]
      if (result.status !== 'fulfilled') {
        // Timeout or network error — skip silently
        continue
      }

      const response = result.value
      if (response.status === 429) {
        // Rate limited — queue for retry after main loop
        retryQueue.push(batch[j])
        wasRateLimited = true
        continue
      }
      if (!response.ok) continue

      try {
        const data = await response.json()
        collectMarkets(data)
      } catch (parseError) {
        // JSON parse error — skip silently
        console.warn(`Failed to parse response for batch item ${j}:`, parseError)
      }
    }
  }

  // Two retry passes for 429'd tasks with escalating backoff
  if (retryQueue.length > 0) {
    await new Promise(resolve => setTimeout(resolve, 4000))
    const retryQueue2: typeof fetchTasks = []
    const retryBatch = retryQueue.slice(0, BATCH_SIZE)
    const retryResults = await Promise.allSettled(
      retryBatch.map(({ prefix, cityCode: code, status: taskStatus }) => {
        const url = new URL(`${KALSHI_API_BASE}/markets`)
        url.searchParams.set('series_ticker', `${prefix}${code}`)
        url.searchParams.set('status', taskStatus)
        url.searchParams.set('limit', '200')
        return fetchWithTimeout(url.toString())
      })
    )
    for (let j = 0; j < retryResults.length; j++) {
      const result = retryResults[j]
      if (result.status !== 'fulfilled') continue
      if (result.value.status === 429) {
        retryQueue2.push(retryBatch[j])
        wasRateLimited = true
        continue
      }
      if (!result.value.ok) continue
      try {
        const data = await result.value.json()
        collectMarkets(data)
      } catch { /* skip */ }
    }

    // Second retry pass for tasks that were still rate-limited
    if (retryQueue2.length > 0) {
      await new Promise(resolve => setTimeout(resolve, 3000))
      const retry2Results = await Promise.allSettled(
        retryQueue2.map(({ prefix, cityCode: code, status: taskStatus }) => {
          const url = new URL(`${KALSHI_API_BASE}/markets`)
          url.searchParams.set('series_ticker', `${prefix}${code}`)
          url.searchParams.set('status', taskStatus)
          url.searchParams.set('limit', '200')
          return fetchWithTimeout(url.toString())
        })
      )
      for (const result of retry2Results) {
        if (result.status !== 'fulfilled' || !result.value.ok) continue
        try {
          const data = await result.value.json()
          collectMarkets(data)
        } catch { /* skip */ }
      }
    }
  }

  // Diagnostic: log market counts per city for debugging rate-limit issues
  console.log(`[kalshi] ${cityFilter || 'all'}: ${allMarkets.length} markets from ${fetchTasks.length} queries (${retryQueue.length} retried)`)

  // Build response
  const response: KalshiMarketsApiResponse = {
    success: true,
    data: {
      markets: allMarkets,
      count: allMarkets.length,
    },
    timestamp: Date.now(),
  }

  // Don't cache results impacted by rate limiting
  if (wasRateLimited) {
    const staleEntry = marketsCache.get(cacheKey)
    const previousCount = staleEntry?.data?.data?.count ?? 0
    if (allMarkets.length === 0 || (previousCount > 0 && allMarkets.length < previousCount * 0.8)) {
      // Return stale cache if available, otherwise return partial with warning
      if (staleEntry && staleEntry.data.data && staleEntry.data.data.count > 0) {
        console.log(`[kalshi] ${cityFilter || 'all'}: returning stale cache (${staleEntry.data.data.count} markets) — partial result ${allMarkets.length} < 80% of previous ${previousCount}`)
        return { ...staleEntry.data, cached: true }
      }
      console.log(`[kalshi] ${cityFilter || 'all'}: skipping cache for rate-limited partial result (${allMarkets.length} markets)`)
      return response
    }
  }

  // Cache and return response
  await setCache(cacheKey, response)
  return response
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
    const { city: cityFilter, status, bypassCache } = req.query

    const response = await getMarketsForCity(
      (cityFilter && typeof cityFilter === 'string') ? cityFilter : '',
      {
        status: typeof status === 'string' ? status : 'active',
        bypassCache: !!bypassCache,
      }
    )
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
