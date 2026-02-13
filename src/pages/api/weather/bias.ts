// City temperature bias API endpoint
// GET: Returns bias data for a given city code

import type { NextApiRequest, NextApiResponse } from 'next'
import { getCityBias } from '@/lib/models/temperatureBias'

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
  return res.status(200).json({ bias })
}
