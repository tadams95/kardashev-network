import type { NextApiRequest, NextApiResponse } from 'next'
import { runWeightRollupJob } from '@/lib/models/weightRollupJob'
import { requireAuth } from '@/lib/utils/apiAuth'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }

  if (!requireAuth(req)) {
    return res.status(401).json({ success: false, error: 'Unauthorized' })
  }

  const { cityCodes, marketTypes, leadBuckets } = req.body || {}

  try {
    const result = await runWeightRollupJob({ cityCodes, marketTypes, leadBuckets })
    return res.status(200).json({ success: true, data: result, timestamp: Date.now() })
  } catch (error) {
    console.error('[weather/rollup-weights] failed:', error)
    return res.status(500).json({ success: false, error: 'Failed to recompute rollups', timestamp: Date.now() })
  }
}
