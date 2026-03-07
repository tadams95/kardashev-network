// Dynamic source weights API endpoint
// GET: Returns computed weights for a city (perSource redacted from public response)

import type { NextApiRequest, NextApiResponse } from 'next'
import {
  getSourceWeightsDetailed,
  getCityWeightContexts,
  resolveDynamicWeights,
  toLeadBucket,
} from '@/lib/models/sourceAccuracy'
import { CITY_COORDS } from '@/lib/utils/cityCoordinates'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const cityCode = req.query.cityCode ? String(req.query.cityCode) : undefined
  const marketType = req.query.marketType ? String(req.query.marketType) : undefined
  const hoursToResolution = req.query.hoursToResolution ? Number(req.query.hoursToResolution) : undefined
  const allContexts = String(req.query.allContexts || '') === '1'

  // Validate cityCode against known cities to prevent cache-miss DoS
  if (cityCode && !CITY_COORDS[cityCode]) {
    return res.status(400).json({ error: 'Unknown cityCode' })
  }

  try {
    if (allContexts && cityCode) {
      const contexts = await getCityWeightContexts(cityCode)
      return res.status(200).json({ cityCode, contexts, timestamp: Date.now() })
    }

    if (cityCode && marketType && isFinite(hoursToResolution as number)) {
      const leadBucket = toLeadBucket(Number(hoursToResolution))
      if (leadBucket === 'all') {
        return res.status(400).json({ error: 'Invalid hoursToResolution' })
      }

      const normalizedMarketType = marketType === 'temperature-low' || marketType === 'low'
        ? 'temperature-low'
        : 'temperature-high'

      const dynamic = await resolveDynamicWeights({
        cityCode,
        marketType: normalizedMarketType,
        leadBucket,
      })

      return res.status(200).json({
        cityCode,
        marketType: normalizedMarketType,
        leadBucket,
        ...dynamic,
      })
    }

    // Try hierarchical Redis weights first (populated by resolve-markets rollup)
    if (cityCode) {
      const hierarchical = await resolveDynamicWeights({
        cityCode,
        marketType: 'temperature-high',
        leadBucket: '24to48h',
      })
      if (hierarchical.regime !== 'default') {
        const fallback = await getSourceWeightsDetailed(cityCode)
        return res.status(200).json({
          cityCode,
          weights: hierarchical.weights,
          isDynamic: true,
          regime: hierarchical.regime,
          effectiveSampleSize: hierarchical.effectiveSampleSize,
          defaultWeights: fallback.defaultWeights,
        })
      }
    }

    // Fall back to on-demand computation
    const result = await getSourceWeightsDetailed(cityCode)

    return res.status(200).json({
      cityCode: cityCode || null,
      weights: result.weights,
      isDynamic: result.isDynamic,
      defaultWeights: result.defaultWeights,
    })
  } catch (error) {
    console.error('[weather/weights] failed:', error)
    return res.status(500).json({ error: 'Failed to compute weights' })
  }
}
