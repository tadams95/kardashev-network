// Solar irradiance API endpoint
// Returns real-time solar data from Open-Meteo
// Supports x402 payment for real-time data, free tier for cached data

import type { NextApiRequest, NextApiResponse } from 'next'
import { fetchSolarData } from '@/lib/api/openMeteo'
import { withX402FreeTier } from '@/lib/x402/middleware'
import { X402_PRICING } from '@/lib/x402/config'
import type { SolarApiResponse } from '@/types/solar'

// San Diego coordinates for testing fallback
const DEFAULT_LAT = 32.7157
const DEFAULT_LNG = -117.1611

function parseCoordinates(req: NextApiRequest): { lat: number; lng: number } | null {
  const { lat, lng, latitude, longitude } = req.query

  const latValue = lat || latitude
  const lngValue = lng || longitude

  if (!latValue || !lngValue) {
    return null
  }

  const parsedLat = parseFloat(Array.isArray(latValue) ? latValue[0] : latValue)
  const parsedLng = parseFloat(Array.isArray(lngValue) ? lngValue[0] : lngValue)

  if (isNaN(parsedLat) || isNaN(parsedLng)) {
    return null
  }

  // Validate coordinate ranges
  if (parsedLat < -90 || parsedLat > 90 || parsedLng < -180 || parsedLng > 180) {
    return null
  }

  return { lat: parsedLat, lng: parsedLng }
}

// Free tier handler - returns cached data with delay note
async function freeTierHandler(
  req: NextApiRequest,
  res: NextApiResponse<SolarApiResponse>
) {
  const coords = parseCoordinates(req)

  if (!coords) {
    return res.status(400).json({
      success: false,
      error: 'Missing or invalid coordinates. Provide lat/lng or latitude/longitude query params.',
    })
  }

  try {
    const { data, cached } = await fetchSolarData(coords)

    return res.status(200).json({
      success: true,
      data,
      cached,
      timestamp: Date.now(),
    })
  } catch (error) {
    console.error('Solar API error:', error)
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch solar data',
    })
  }
}

// Paid tier handler - bypasses cache for real-time data
async function paidTierHandler(
  req: NextApiRequest,
  res: NextApiResponse<SolarApiResponse>
) {
  const coords = parseCoordinates(req)

  if (!coords) {
    return res.status(400).json({
      success: false,
      error: 'Missing or invalid coordinates. Provide lat/lng or latitude/longitude query params.',
    })
  }

  try {
    // Force fresh data fetch (bypass cache) for paid requests
    const { data } = await fetchSolarData(coords, { bypassCache: true, premium: true })

    return res.status(200).json({
      success: true,
      data,
      cached: false,
      timestamp: Date.now(),
    })
  } catch (error) {
    console.error('Solar API error:', error)
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch solar data',
    })
  }
}

// Get pricing config for this endpoint
const pricing = X402_PRICING['/api/solar/irradiance']

// Export wrapped handler with x402 free tier support
export default withX402FreeTier(
  freeTierHandler,
  paidTierHandler,
  {
    price: pricing.price,
    description: pricing.description,
  }
)
