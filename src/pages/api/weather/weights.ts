// Dynamic source weights API endpoint
// GET: Returns per-source accuracy stats and computed weights for a city

import type { NextApiRequest, NextApiResponse } from 'next'
import { getSourceWeightsDetailed } from '@/lib/models/sourceAccuracy'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const cityCode = req.query.cityCode ? String(req.query.cityCode) : undefined

  try {
    const result = await getSourceWeightsDetailed(cityCode)

    return res.status(200).json({
      cityCode: cityCode || null,
      weights: result.weights,
      isDynamic: result.isDynamic,
      perSource: result.perSource,
      defaultWeights: result.defaultWeights,
    })
  } catch (error) {
    console.error('[weather/weights] failed:', error)
    return res.status(500).json({ error: 'Failed to compute weights' })
  }
}
