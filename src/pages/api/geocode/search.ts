// Geocoding API endpoint
// Proxies to Nominatim (OpenStreetMap) for address search and reverse geocoding

import type { NextApiRequest, NextApiResponse } from 'next'

const NOMINATIM_BASE_URL = 'https://nominatim.openstreetmap.org'

interface GeocodeResult {
  lat: number
  lng: number
  address?: string
  city?: string
  displayName: string
}

interface GeocodeApiResponse {
  success: boolean
  data?: GeocodeResult | GeocodeResult[]
  error?: string
}

// Rate limiting: simple in-memory tracker
const requestTimes: number[] = []
const RATE_LIMIT_WINDOW_MS = 1000 // 1 second
const MAX_REQUESTS_PER_WINDOW = 1 // Nominatim requires max 1 req/sec

function checkRateLimit(): boolean {
  const now = Date.now()
  // Remove old requests outside the window
  while (requestTimes.length > 0 && requestTimes[0] < now - RATE_LIMIT_WINDOW_MS) {
    requestTimes.shift()
  }
  if (requestTimes.length >= MAX_REQUESTS_PER_WINDOW) {
    return false
  }
  requestTimes.push(now)
  return true
}

function extractCity(address: Record<string, string>): string | undefined {
  return address.city || address.town || address.village || address.municipality || address.county
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<GeocodeApiResponse>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }

  // Check rate limit
  if (!checkRateLimit()) {
    return res.status(429).json({
      success: false,
      error: 'Rate limit exceeded. Please wait a moment and try again.',
    })
  }

  const { q, lat, lng, reverse } = req.query

  try {
    let url: string
    const headers = {
      'User-Agent': 'KardashevNetwork/1.0 (https://kardashev.network)',
    }

    if (reverse === 'true' && lat && lng) {
      // Reverse geocoding: coordinates to address
      const latValue = Array.isArray(lat) ? lat[0] : lat
      const lngValue = Array.isArray(lng) ? lng[0] : lng

      url = `${NOMINATIM_BASE_URL}/reverse?format=json&lat=${latValue}&lon=${lngValue}&addressdetails=1`

      const response = await fetch(url, { headers })

      if (!response.ok) {
        throw new Error(`Nominatim API error: ${response.status}`)
      }

      const data = await response.json()

      if (data.error) {
        return res.status(404).json({
          success: false,
          error: 'Location not found',
        })
      }

      const result: GeocodeResult = {
        lat: parseFloat(data.lat),
        lng: parseFloat(data.lon),
        displayName: data.display_name,
        city: extractCity(data.address || {}),
        address: data.display_name,
      }

      return res.status(200).json({ success: true, data: result })

    } else if (q) {
      // Forward geocoding: address to coordinates
      const query = Array.isArray(q) ? q[0] : q

      if (!query || query.length < 2) {
        return res.status(400).json({
          success: false,
          error: 'Search query must be at least 2 characters',
        })
      }

      url = `${NOMINATIM_BASE_URL}/search?format=json&q=${encodeURIComponent(query)}&addressdetails=1&limit=5`

      const response = await fetch(url, { headers })

      if (!response.ok) {
        throw new Error(`Nominatim API error: ${response.status}`)
      }

      const data = await response.json()

      if (!Array.isArray(data) || data.length === 0) {
        return res.status(200).json({
          success: true,
          data: [],
        })
      }

      const results: GeocodeResult[] = data.map((item: any) => ({
        lat: parseFloat(item.lat),
        lng: parseFloat(item.lon),
        displayName: item.display_name,
        city: extractCity(item.address || {}),
        address: item.display_name,
      }))

      return res.status(200).json({ success: true, data: results })

    } else {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters. Provide "q" for search or "lat"/"lng" with "reverse=true".',
      })
    }
  } catch (error) {
    console.error('Geocode API error:', error)
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to geocode',
    })
  }
}
