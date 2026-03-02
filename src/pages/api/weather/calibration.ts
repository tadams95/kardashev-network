// Calibration model API endpoint
// GET: Load persisted calibration model and wire it into the live probability pipeline
// POST: Accept a CalibrationModel and persist it

import type { NextApiRequest, NextApiResponse } from 'next'
import { getDb } from '@/lib/db/mongodb'
import { setCalibrationModel } from '@/lib/models/weatherProbability'
import type { CalibrationModel } from '@/lib/models/calibration'
import { requireAuth } from '@/lib/utils/apiAuth'

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
          error: 'No calibration model found.',
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
    if (!requireAuth(req)) {
      return res.status(401).json({ success: false, error: 'Unauthorized', timestamp: Date.now() })
    }

    try {
      const model = req.body

      if (!model || !Array.isArray(model.breakpoints) || model.breakpoints.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Invalid calibration model. Must include non-empty breakpoints array.',
          timestamp: Date.now(),
        })
      }

      // Validate breakpoint shape and ranges
      for (const bp of model.breakpoints) {
        if (typeof bp.x !== 'number' || typeof bp.y !== 'number' ||
            !isFinite(bp.x) || !isFinite(bp.y) ||
            bp.x < 0 || bp.x > 1 || bp.y < 0 || bp.y > 1) {
          return res.status(400).json({
            success: false,
            error: 'Each breakpoint must have x and y as finite numbers in [0, 1].',
            timestamp: Date.now(),
          })
        }
      }

      // Validate metadata fields
      if (typeof model.sampleSize !== 'number' || !isFinite(model.sampleSize) || model.sampleSize < 1) {
        return res.status(400).json({
          success: false,
          error: 'sampleSize must be a positive number.',
          timestamp: Date.now(),
        })
      }
      if (typeof model.brierBefore !== 'number' || !isFinite(model.brierBefore)) {
        return res.status(400).json({
          success: false,
          error: 'brierBefore must be a finite number.',
          timestamp: Date.now(),
        })
      }
      if (typeof model.brierAfter !== 'number' || !isFinite(model.brierAfter)) {
        return res.status(400).json({
          success: false,
          error: 'brierAfter must be a finite number.',
          timestamp: Date.now(),
        })
      }
      if (typeof model.calibrationError !== 'number' || !isFinite(model.calibrationError)) {
        return res.status(400).json({
          success: false,
          error: 'calibrationError must be a finite number.',
          timestamp: Date.now(),
        })
      }
      if (typeof model.trainedAt !== 'number' || !isFinite(model.trainedAt)) {
        return res.status(400).json({
          success: false,
          error: 'trainedAt must be a finite timestamp.',
          timestamp: Date.now(),
        })
      }

      // Sanitize to only known CalibrationModel fields (prevents extra payload injection)
      const sanitizedModel: CalibrationModel = {
        breakpoints: model.breakpoints
          .map((bp: any) => ({ x: Number(bp.x), y: Number(bp.y) }))
          .sort((a: { x: number }, b: { x: number }) => a.x - b.x),
        trainedAt: model.trainedAt,
        sampleSize: model.sampleSize,
        calibrationError: model.calibrationError,
        brierBefore: model.brierBefore,
        brierAfter: model.brierAfter,
      }

      // Persist to MongoDB (upsert the single active document)
      await calibrationCollection().replaceOne(
        { _id: 'active' } as any,
        { _id: 'active', ...sanitizedModel } as any,
        { upsert: true }
      )

      // Wire into the live probability pipeline
      setCalibrationModel(sanitizedModel)

      console.log(`[calibration] Model updated: ${sanitizedModel.sampleSize} samples`)

      return res.status(200).json({
        success: true,
        data: sanitizedModel,
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
