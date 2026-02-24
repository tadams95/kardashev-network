// City temperature bias API endpoint
// GET: Returns bias data + pre-computed correction for a given city code

import type { NextApiRequest, NextApiResponse } from 'next'
import { getCityBias } from '@/lib/models/temperatureBias'

// Single source of truth for correction constants
// FA-11: Bracket midpoint introduces ±2.5°F measurement noise per observation.
// With N=10, SE ≈ 0.8°F — a "2°F bias" could be noise. Raised MIN_SAMPLES
// and reduced CORRECTION_GAIN for robustness.
const MIN_SAMPLES = 25
const MAX_CORRECTION_F = 5
const CORRECTION_GAIN = 0.5

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const cityCode = String(req.query.cityCode || '')
  if (!cityCode) {
    return res.status(400).json({ error: 'Missing cityCode query parameter' })
  }

  try {
    const bias = await getCityBias(cityCode)

    const isActive = bias != null && bias.sampleCount >= MIN_SAMPLES
    const correction = isActive
      ? Math.max(-MAX_CORRECTION_F, Math.min(MAX_CORRECTION_F, -CORRECTION_GAIN * bias.meanError))
      : 0

    return res.status(200).json({ bias, correction, isActive, minSamples: MIN_SAMPLES })
  } catch (error) {
    console.error('[weather/bias] failed to load city bias:', error)
    return res.status(500).json({ error: 'Failed to load city bias' })
  }
}
