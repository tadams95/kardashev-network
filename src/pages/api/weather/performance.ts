// Live performance tracking API endpoint
// GET: Returns current performance snapshot (rolling win rate, Brier score, decay status)
// POST: Log a signal or resolve an outcome

import type { NextApiRequest, NextApiResponse } from 'next'
import {
  logSignal,
  resolveSignal,
  resolveByMarketId,
  getPerformanceSnapshot,
  getSignalHistory,
} from '@/lib/models/performanceTracker'

interface PerformanceApiResponse {
  success: boolean
  data?: any
  error?: string
  timestamp: number
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<PerformanceApiResponse>
) {
  if (req.method === 'GET') {
    // Return performance snapshot
    const { limit } = req.query

    const snapshot = await getPerformanceSnapshot()
    const history = limit
      ? await getSignalHistory(parseInt(String(limit)))
      : undefined

    return res.status(200).json({
      success: true,
      data: {
        snapshot,
        ...(history ? { recentSignals: history } : {}),
      },
      timestamp: Date.now(),
    })
  }

  if (req.method === 'POST') {
    const { action } = req.body

    if (action === 'log') {
      // Log a new signal
      const { marketId, modelProbability, marketPrice, edge, direction, signal, cityCode, forecastTemp } = req.body

      if (!marketId || modelProbability == null || marketPrice == null) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: marketId, modelProbability, marketPrice',
          timestamp: Date.now(),
        })
      }

      const id = await logSignal({
        marketId,
        timestamp: Date.now(),
        modelProbability,
        marketPrice,
        edge: edge || Math.abs(modelProbability - marketPrice),
        direction: direction || (modelProbability > marketPrice ? 'YES' : 'NO'),
        signal: signal || 'HOLD',
        ...(cityCode ? { cityCode } : {}),
        ...(forecastTemp != null ? { forecastTemp } : {}),
      })

      return res.status(200).json({
        success: true,
        data: { signalId: id },
        timestamp: Date.now(),
      })
    }

    if (action === 'resolve') {
      // Resolve a signal outcome
      const { signalId, marketId, outcome } = req.body

      if (outcome == null) {
        return res.status(400).json({
          success: false,
          error: 'Missing required field: outcome (boolean)',
          timestamp: Date.now(),
        })
      }

      let resolved = 0
      if (signalId) {
        resolved = (await resolveSignal(signalId, outcome)) ? 1 : 0
      } else if (marketId) {
        resolved = await resolveByMarketId(marketId, outcome)
      } else {
        return res.status(400).json({
          success: false,
          error: 'Must provide signalId or marketId',
          timestamp: Date.now(),
        })
      }

      return res.status(200).json({
        success: true,
        data: { resolved },
        timestamp: Date.now(),
      })
    }

    return res.status(400).json({
      success: false,
      error: 'Unknown action. Use "log" or "resolve".',
      timestamp: Date.now(),
    })
  }

  return res.status(405).json({
    success: false,
    error: 'Method not allowed',
    timestamp: Date.now(),
  })
}
