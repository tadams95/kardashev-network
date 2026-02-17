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

// Per-IP rate limiting so one user's burst doesn't lock everyone out.
// We still enforce Nominatim's 1-req/sec policy, but per client IP.
const ipRequestTimes = new Map<string, number[]>()
const RATE_LIMIT_WINDOW_MS = 1000 // 1 second
const MAX_REQUESTS_PER_WINDOW = 1 // Nominatim requires max 1 req/sec
const MAX_TRACKED_IPS = 10_000 // prevent unbounded memory growth

// Global throttle: Nominatim's usage policy is 1 req/sec per *application*
// (identified by User-Agent), not per end-user.
let lastNominatimRequestMs = 0

function getClientIp(req: NextApiRequest): string {
  const forwarded = req.headers['x-forwarded-for']
  if (forwarded) {
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0]
    return first.trim()
  }
  return req.socket?.remoteAddress || 'unknown'
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now()

  let times = ipRequestTimes.get(ip)
  if (!times) {
    // Evict oldest entries if the map is too large
    if (ipRequestTimes.size >= MAX_TRACKED_IPS) {
      const firstKey = ipRequestTimes.keys().next().value
      if (firstKey) ipRequestTimes.delete(firstKey)
    }
    times = []
    ipRequestTimes.set(ip, times)
  }

  // Remove old requests outside the window
  while (times.length > 0 && times[0] < now - RATE_LIMIT_WINDOW_MS) {
    times.shift()
  }
  if (times.length >= MAX_REQUESTS_PER_WINDOW) {
    return false
  }
  times.push(now)
  return true
}

function extractCity(address: Record<string, string>): string | undefined {
  return address.city || address.town || address.village || address.municipality || address.county
}

function formatAddress(addr: Record<string, string>): string | undefined {
  const city = addr.city || addr.town || addr.village || addr.municipality || ''
  const zip = addr.postcode || ''

  // Build street part: "123 Main St" or just neighborhood
  const street = addr.road
    ? [addr.house_number, addr.road].filter(Boolean).join(' ')
    : addr.suburb || addr.neighbourhood || ''

  // Assemble: "Street, City, Zip" — skip empty segments
  return [street, city, zip].filter(Boolean).join(', ') || undefined
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<GeocodeApiResponse>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }

  // Check per-IP rate limit
  const clientIp = getClientIp(req)
  if (!checkRateLimit(clientIp)) {
    return res.status(429).json({
      success: false,
      error: 'Rate limit exceeded. Please wait a moment and try again.',
    })
  }

  // Enforce Nominatim's app-level 1 req/sec policy
  const now = Date.now()
  if (now - lastNominatimRequestMs < RATE_LIMIT_WINDOW_MS) {
    return res.status(429).json({
      success: false,
      error: 'Rate limit exceeded. Please wait a moment and try again.',
    })
  }
  lastNominatimRequestMs = now

  const { q, lat, lng, reverse } = req.query

  try {
    let url: string
    const headers = {
      'User-Agent': 'KardashevNetwork/1.0 (https://kardashev.network; contact@kardashev.network)',
      'Accept': 'application/json',
    }
    const fetchOptions = { headers, signal: AbortSignal.timeout(5000) }

    if (reverse === 'true' && lat && lng) {
      // Reverse geocoding: coordinates to address
      const latValue = Array.isArray(lat) ? lat[0] : lat
      const lngValue = Array.isArray(lng) ? lng[0] : lng

      url = `${NOMINATIM_BASE_URL}/reverse?format=json&lat=${latValue}&lon=${lngValue}&addressdetails=1`

      const response = await fetch(url, fetchOptions)

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
        address: formatAddress(data.address || {}) || data.display_name,
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

      const response = await fetch(url, fetchOptions)

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
        address: formatAddress(item.address || {}) || item.display_name,
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
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      return res.status(504).json({
        success: false,
        error: 'Geocoding service timed out. Please try again.',
      })
    }
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to geocode',
    })
  }
}
