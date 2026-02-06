import type { NextApiRequest, NextApiResponse } from 'next'
import { fetchSolarData } from '@/lib/api/openMeteo'
import type { SolarApiResponse } from '@/types/solar'

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

  if (parsedLat < -90 || parsedLat > 90 || parsedLng < -180 || parsedLng > 180) {
    return null
  }

  return { lat: parsedLat, lng: parsedLng }
}

export default async function handler(
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

  // Middleware sets x-premium-verified for session-verified or payment-settled requests
  // x-payment header means x402 middleware verified the payment
  const isPaid = req.headers['x-premium-verified'] === 'true' || !!req.headers['x-payment']

  try {
    const { data, cached } = await fetchSolarData(
      coords,
      isPaid ? { bypassCache: true, premium: true } : {}
    )

    return res.status(200).json({
      success: true,
      data,
      cached: isPaid ? false : cached,
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
