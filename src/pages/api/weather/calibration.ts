// Calibration model API endpoint
// GET: Load persisted calibration model and wire it into the live probability pipeline
// POST: Accept a CalibrationModel and persist it

import type { NextApiRequest, NextApiResponse } from 'next'
import * as fs from 'fs'
import * as path from 'path'
import { setCalibrationModel } from '@/lib/models/weatherProbability'
import type { CalibrationModel } from '@/lib/models/calibration'

const CALIBRATION_PATH = path.join(process.cwd(), 'data/weather/calibration_model.json')

interface CalibrationApiResponse {
  success: boolean
  data?: CalibrationModel
  error?: string
  timestamp: number
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<CalibrationApiResponse>
) {
  if (req.method === 'GET') {
    try {
      const content = fs.readFileSync(CALIBRATION_PATH, 'utf-8')
      const model: CalibrationModel = JSON.parse(content)

      // Wire into the live probability pipeline
      setCalibrationModel(model)

      console.log(`[calibration] Loaded model: ${model.sampleSize} samples, Brier ${model.brierBefore.toFixed(3)} → ${model.brierAfter.toFixed(3)}`)

      return res.status(200).json({
        success: true,
        data: model,
        timestamp: Date.now(),
      })
    } catch (error) {
      return res.status(404).json({
        success: false,
        error: 'No calibration model found. Run a backtest first to generate one.',
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

      // Persist to disk
      fs.writeFileSync(CALIBRATION_PATH, JSON.stringify(model, null, 2))

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
