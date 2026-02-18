// City temperature bias API endpoint
// GET: Returns bias data + pre-computed correction for a given city code

import type { NextApiRequest, NextApiResponse } from 'next'
import { getCityBias } from '@/lib/models/temperatureBias'

// Single source of truth for correction constants
const MIN_SAMPLES = 10
const MAX_CORRECTION_F = 5
const CORRECTION_GAIN = 0.7

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

  const bias = await getCityBias(cityCode)

  const isActive = bias != null && bias.sampleCount >= MIN_SAMPLES
  const correction = isActive
    ? Math.max(-MAX_CORRECTION_F, Math.min(MAX_CORRECTION_F, -CORRECTION_GAIN * bias.meanError))
    : 0

  return res.status(200).json({ bias, correction, isActive })
}
