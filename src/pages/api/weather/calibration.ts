// Calibration model API endpoint
// GET: Load persisted calibration model and wire it into the live probability pipeline
// POST: Accept a CalibrationModel and persist it

import type { NextApiRequest, NextApiResponse } from 'next'
import { getDb } from '@/lib/db/mongodb'
import { setCalibrationModel } from '@/lib/models/weatherProbability'
import type { CalibrationModel } from '@/lib/models/calibration'

interface CalibrationApiResponse {
  success: boolean
  data?: CalibrationModel
  error?: string
  timestamp: number
}

function calibrationCollection() {
  return getDb().collection<CalibrationModel & { _id: string }>('calibration')
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<CalibrationApiResponse>
) {
  if (req.method === 'GET') {
    try {
      const doc = await calibrationCollection().findOne({ _id: 'active' } as any)

      if (!doc) {
        return res.status(404).json({
          success: false,
          error: 'No calibration model found. Run a backtest first to generate one.',
          timestamp: Date.now(),
        })
      }

      const { _id, ...model } = doc as any
      const calibrationModel = model as CalibrationModel

      // Wire into the live probability pipeline
      setCalibrationModel(calibrationModel)

      console.log(`[calibration] Loaded model: ${calibrationModel.sampleSize} samples, Brier ${calibrationModel.brierBefore.toFixed(3)} → ${calibrationModel.brierAfter.toFixed(3)}`)

      return res.status(200).json({
        success: true,
        data: calibrationModel,
        timestamp: Date.now(),
      })
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to load calibration model',
        timestamp: Date.now(),
      })
    }
  }

  if (req.method === 'POST') {
    try {
      const model: CalibrationModel = req.body

      if (!model || !model.breakpoints || !Array.isArray(model.breakpoints)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid calibration model. Must include breakpoints array.',
          timestamp: Date.now(),
        })
      }

      // Persist to MongoDB (upsert the single active document)
      await calibrationCollection().replaceOne(
        { _id: 'active' } as any,
        { _id: 'active', ...model } as any,
        { upsert: true }
      )

      // Wire into the live probability pipeline
      setCalibrationModel(model)

      console.log(`[calibration] Model updated: ${model.sampleSize} samples`)

      return res.status(200).json({
        success: true,
        data: model,
        timestamp: Date.now(),
      })
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to save calibration model',
        timestamp: Date.now(),
      })
    }
  }

  return res.status(405).json({
    success: false,
    error: 'Method not allowed. Use GET or POST.',
    timestamp: Date.now(),
  })
}
