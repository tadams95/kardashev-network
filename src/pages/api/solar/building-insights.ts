// Google Solar API proxy for building insights
// Provides roof analysis, solar potential, and panel configurations

import type { NextApiRequest, NextApiResponse } from 'next'
import type { BuildingInsights, BuildingInsightsResponse } from '@/types/googleSolar'
import { rget, rset } from '@/lib/cache/redis'

const GOOGLE_SOLAR_API_URL = 'https://solar.googleapis.com/v1/buildingInsights:findClosest'
const GOOGLE_API_KEY = process.env.GOOGLE_MAPS_API_KEY

// L1 in-memory cache + L2 Redis
const cache = new Map<string, { data: BuildingInsights; timestamp: number }>()
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours - building data doesn't change often
const REDIS_PREFIX = 'building:'
const REDIS_TTL_S = 86400

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<BuildingInsightsResponse>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }

  const { lat, lng } = req.query

  if (!lat || !lng) {
    return res.status(400).json({ success: false, error: 'Missing lat or lng parameter' })
  }

  const latitude = parseFloat(lat as string)
  const longitude = parseFloat(lng as string)

  if (isNaN(latitude) || isNaN(longitude)) {
    return res.status(400).json({ success: false, error: 'Invalid lat or lng parameter' })
  }

  if (!GOOGLE_API_KEY) {
    return res.status(500).json({ success: false, error: 'Google API key not configured' })
  }

  // Check cache (L1 then L2)
  const cacheKey = `${latitude.toFixed(6)},${longitude.toFixed(6)}`
  const cached = cache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return res.status(200).json({
      success: true,
      data: cached.data,
      cached: true,
    })
  }

  // L2: Redis
  const redisData = await rget<BuildingInsights>(REDIS_PREFIX + cacheKey)
  if (redisData) {
    cache.set(cacheKey, { data: redisData, timestamp: Date.now() })
    return res.status(200).json({
      success: true,
      data: redisData,
      cached: true,
    })
  }

  try {
    // Build Google Solar API URL
    const url = new URL(GOOGLE_SOLAR_API_URL)
    url.searchParams.set('location.latitude', latitude.toString())
    url.searchParams.set('location.longitude', longitude.toString())
    url.searchParams.set('requiredQuality', 'LOW') // Accept any quality for broader coverage
    url.searchParams.set('key', GOOGLE_API_KEY)

    const response = await fetch(url.toString())

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))

      // Handle specific error cases
      if (response.status === 404) {
        return res.status(404).json({
          success: false,
          error: 'No building data available for this location. Google Solar API coverage is limited to certain regions.',
        })
      }

      if (response.status === 403) {
        return res.status(403).json({
          success: false,
          error: 'API access denied. Please check your Google API key configuration.',
        })
      }

      console.error('Google Solar API error:', response.status, errorData)
      return res.status(response.status).json({
        success: false,
        error: errorData.error?.message || 'Failed to fetch building insights',
      })
    }

    const data: BuildingInsights = await response.json()

    // Cache the result (L1 + L2)
    cache.set(cacheKey, { data, timestamp: Date.now() })
    await rset(REDIS_PREFIX + cacheKey, data, REDIS_TTL_S)

    return res.status(200).json({
      success: true,
      data,
      cached: false,
    })
  } catch (error) {
    console.error('Google Solar API error:', error)
    return res.status(500).json({
      success: false,
      error: 'Internal server error fetching building insights',
    })
  }
}
