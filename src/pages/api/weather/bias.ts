// City temperature bias API endpoint
// GET: Returns bias data + pre-computed correction for a given city code

import type { NextApiRequest, NextApiResponse } from 'next'
import { getCityBias } from '@/lib/models/temperatureBias'

// Single source of truth for correction constants
// FA-11: Bracket midpoint introduces ±2.5°F measurement noise per observation.
// With exponential decay, raw sample count overstates usable data.
// Gate on effective sample size (Kish's formula) instead of raw count.
const MIN_EFFECTIVE_N = 12
const MAX_CORRECTION_F = 5
const CORRECTION_GAIN = 0.5

// Rate-limit bias health warnings (one per city per 5 minutes)
const _lastBiasWarn = new Map<string, number>()
const BIAS_WARN_INTERVAL_MS = 5 * 60 * 1000

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

    const isActive = bias != null && bias.effectiveSampleSize >= MIN_EFFECTIVE_N
    const rawCorrection = isActive ? -CORRECTION_GAIN * bias.meanError : 0
    const correction = isActive
      ? Math.max(-MAX_CORRECTION_F, Math.min(MAX_CORRECTION_F, rawCorrection))
      : 0

    const now = Date.now()
    const lastWarn = _lastBiasWarn.get(cityCode) ?? 0
    if (now - lastWarn > BIAS_WARN_INTERVAL_MS) {
      if (!isActive) {
        console.warn(`[weather/bias] ${cityCode}: inactive (effectiveN=${bias?.effectiveSampleSize?.toFixed(1) ?? 0}, need ${MIN_EFFECTIVE_N})`)
        _lastBiasWarn.set(cityCode, now)
      } else if (Math.abs(correction) >= MAX_CORRECTION_F) {
        console.warn(`[weather/bias] ${cityCode}: correction capped at ${correction > 0 ? '+' : ''}${correction.toFixed(1)}°F (raw=${rawCorrection.toFixed(1)}°F, meanError=${bias!.meanError.toFixed(2)})`)
        _lastBiasWarn.set(cityCode, now)
      }
    }

    return res.status(200).json({ bias, correction, isActive, minSamples: MIN_EFFECTIVE_N })
  } catch (error) {
    console.error('[weather/bias] failed to load city bias:', error)
    return res.status(500).json({ error: 'Failed to load city bias' })
  }
}
