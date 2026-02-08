// Google Solar API proxy for data layers (annual flux heatmap)
// Fetches GeoTIFF data, renders colored PNG overlay for Google Maps

import type { NextApiRequest, NextApiResponse } from 'next'
import type { DataLayersApiResponse, DataLayersResponse, RenderedLayer } from '@/types/googleSolar'
import { fromArrayBuffer } from 'geotiff'
import { PNG } from 'pngjs'

export const config = { api: { responseLimit: '5mb' } }

const GOOGLE_SOLAR_API_URL = 'https://solar.googleapis.com/v1/dataLayers:get'
const GOOGLE_API_KEY = process.env.GOOGLE_MAPS_API_KEY

// In-memory cache (24hr TTL)
const cache = new Map<string, { data: DataLayersApiResponse; timestamp: number }>()
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

// Rainbow palette stops (Sunroof-style)
const PALETTE: [number, number, number, number][] = [
  [0.0,  102, 0,   153], // purple
  [0.2,  0,   0,   255], // blue
  [0.4,  0,   204, 204], // cyan
  [0.5,  0,   204, 0],   // green
  [0.7,  255, 255, 0],   // yellow
  [0.85, 255, 153, 0],   // orange
  [1.0,  255, 0,   0],   // red
]

function interpolateColor(t: number): [number, number, number] {
  const clamped = Math.max(0, Math.min(1, t))

  // Find the two palette stops to interpolate between
  let lower = PALETTE[0]
  let upper = PALETTE[PALETTE.length - 1]
  for (let i = 0; i < PALETTE.length - 1; i++) {
    if (clamped >= PALETTE[i][0] && clamped <= PALETTE[i + 1][0]) {
      lower = PALETTE[i]
      upper = PALETTE[i + 1]
      break
    }
  }

  const range = upper[0] - lower[0]
  const f = range === 0 ? 0 : (clamped - lower[0]) / range

  return [
    Math.round(lower[1] + f * (upper[1] - lower[1])),
    Math.round(lower[2] + f * (upper[2] - lower[2])),
    Math.round(lower[3] + f * (upper[3] - lower[3])),
  ]
}

async function fetchGeoTiff(url: string): Promise<ArrayBuffer> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30000)

  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) throw new Error(`GeoTIFF fetch failed: ${res.status}`)
    return res.arrayBuffer()
  } finally {
    clearTimeout(timeout)
  }
}

async function renderFluxHeatmap(
  fluxBuffer: ArrayBuffer,
  maskBuffer: ArrayBuffer
): Promise<RenderedLayer> {
  // Parse GeoTIFFs
  const fluxTiff = await fromArrayBuffer(fluxBuffer)
  const maskTiff = await fromArrayBuffer(maskBuffer)

  const fluxImage = await fluxTiff.getImage()
  const maskImage = await maskTiff.getImage()

  const fluxRasters = await fluxImage.readRasters()
  const maskRasters = await maskImage.readRasters()

  const fluxData = fluxRasters[0] as Float32Array | Float64Array | Uint8Array | Uint16Array
  const width = fluxImage.getWidth()
  const height = fluxImage.getHeight()

  // Get mask data, handling resolution mismatch with nearest-neighbor resampling
  const maskWidth = maskImage.getWidth()
  const maskHeight = maskImage.getHeight()
  const rawMaskData = maskRasters[0] as Float32Array | Float64Array | Uint8Array | Uint16Array

  // Extract bounds from flux image
  const bbox = fluxImage.getBoundingBox()
  const bounds = {
    west: bbox[0],
    south: bbox[1],
    east: bbox[2],
    north: bbox[3],
  }

  // Find min/max flux values (only where mask is non-zero)
  let minFlux = Infinity
  let maxFlux = -Infinity
  for (let i = 0; i < width * height; i++) {
    // Get corresponding mask pixel (nearest-neighbor if sizes differ)
    const mx = Math.floor((i % width) * maskWidth / width)
    const my = Math.floor(Math.floor(i / width) * maskHeight / height)
    const maskVal = rawMaskData[my * maskWidth + mx]

    if (maskVal > 0) {
      const val = fluxData[i]
      if (val < minFlux) minFlux = val
      if (val > maxFlux) maxFlux = val
    }
  }

  // If no valid pixels, return transparent image
  if (minFlux === Infinity) {
    throw new Error('No valid flux data found (mask is entirely zero)')
  }

  const fluxRange = maxFlux - minFlux

  // Create PNG
  const png = new PNG({ width, height })

  for (let i = 0; i < width * height; i++) {
    const pngIdx = i * 4

    // Nearest-neighbor mask lookup
    const mx = Math.floor((i % width) * maskWidth / width)
    const my = Math.floor(Math.floor(i / width) * maskHeight / height)
    const maskVal = rawMaskData[my * maskWidth + mx]

    if (maskVal === 0) {
      // Not roof — fully transparent
      png.data[pngIdx] = 0
      png.data[pngIdx + 1] = 0
      png.data[pngIdx + 2] = 0
      png.data[pngIdx + 3] = 0
    } else {
      // Normalize flux to [0, 1]
      const t = fluxRange === 0 ? 0.5 : (fluxData[i] - minFlux) / fluxRange
      const [r, g, b] = interpolateColor(t)
      png.data[pngIdx] = r
      png.data[pngIdx + 1] = g
      png.data[pngIdx + 2] = b
      png.data[pngIdx + 3] = 180 // semi-transparent
    }
  }

  // Encode to PNG buffer
  const pngBuffer = PNG.sync.write(png)
  const base64 = pngBuffer.toString('base64')

  return {
    imageDataUrl: `data:image/png;base64,${base64}`,
    bounds,
    width,
    height,
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<DataLayersApiResponse>
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

  // Check cache
  const cacheKey = `${latitude.toFixed(6)},${longitude.toFixed(6)}`
  const cached = cache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return res.status(200).json(cached.data)
  }

  try {
    // Fetch data layers metadata from Google Solar API
    const url = new URL(GOOGLE_SOLAR_API_URL)
    url.searchParams.set('location.latitude', latitude.toString())
    url.searchParams.set('location.longitude', longitude.toString())
    url.searchParams.set('radiusMeters', '50')
    url.searchParams.set('view', 'FULL_LAYERS')
    url.searchParams.set('requiredQuality', 'LOW')
    url.searchParams.set('pixelSizeMeters', '0.5')
    url.searchParams.set('key', GOOGLE_API_KEY)

    const response = await fetch(url.toString())

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))

      if (response.status === 404) {
        return res.status(404).json({
          success: false,
          error: 'No solar data layers available for this location.',
        })
      }

      if (response.status === 403) {
        return res.status(403).json({
          success: false,
          error: 'API access denied. Please check your Google API key configuration.',
        })
      }

      console.error('Google Solar Data Layers API error:', response.status, errorData)
      return res.status(response.status).json({
        success: false,
        error: errorData.error?.message || 'Failed to fetch data layers',
      })
    }

    const layersData: DataLayersResponse = await response.json()

    // Fetch annual flux and mask GeoTIFFs in parallel
    // The URLs from the API need the API key appended
    const fluxUrl = `${layersData.annualFluxUrl}&key=${GOOGLE_API_KEY}`
    const maskUrl = `${layersData.maskUrl}&key=${GOOGLE_API_KEY}`

    const [fluxBuffer, maskBuffer] = await Promise.all([
      fetchGeoTiff(fluxUrl),
      fetchGeoTiff(maskUrl),
    ])

    // Render the heatmap
    const annualFlux = await renderFluxHeatmap(fluxBuffer, maskBuffer)

    const result: DataLayersApiResponse = {
      success: true,
      data: {
        annualFlux,
        center: { latitude, longitude },
        imageryDate: layersData.imageryDate,
        quality: layersData.imageryQuality,
      },
      cached: false,
    }

    // Cache the result
    cache.set(cacheKey, { data: result, timestamp: Date.now() })

    return res.status(200).json(result)
  } catch (error) {
    console.error('Data layers processing error:', error)
    return res.status(500).json({
      success: false,
      error: 'Failed to process solar data layers',
    })
  }
}
