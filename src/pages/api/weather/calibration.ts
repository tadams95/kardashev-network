// Calibration model API endpoint
// GET: Load persisted calibration model and wire it into the live probability pipeline
// POST: Accept a CalibrationModel and persist it

import type { NextApiRequest, NextApiResponse } from 'next'
import { getDb } from '@/lib/db/mongodb'
import { setCalibrationModel } from '@/lib/models/weatherProbability'
import {
  trainCalibrationModel,
  toCalibrationLeadBucket,
  buildCalibrationSegmentKey,
  DEFAULT_SEGMENT_MIN_SAMPLES,
  DEFAULT_TYPE_MIN_SAMPLES,
  isCalibrationModelBundle,
  crossValidateCalibration,
} from '@/lib/models/calibration'
import type {
  CalibrationModel,
  CalibrationModelBundle,
  CalibrationMarketType,
  CalibrationPoint,
} from '@/lib/models/calibration'
import { requireAuth } from '@/lib/utils/apiAuth'

interface CalibrationApiResponse {
  success: boolean
  data?: CalibrationModel | CalibrationModelBundle
  error?: string
  timestamp: number
}

function calibrationCollection() {
  return getDb().collection<(CalibrationModel | CalibrationModelBundle) & { _id: string }>('calibration')
}

function marketPredictionsCollection() {
  return getDb().collection<{
    correctedProbability?: number
    rawProbability?: number
    resolvedOutcome?: 0 | 1
    marketType?: 'temperature-high' | 'temperature-low' | 'precipitation'
    hoursToResolution?: number
    timestamp?: number
    probabilityModel?: 'bma' | 'kde'
  }>('market_predictions')
}

function isValidCalibrationModel(model: any): model is CalibrationModel {
  if (!model || !Array.isArray(model.breakpoints) || model.breakpoints.length === 0) return false
  if (typeof model.sampleSize !== 'number' || !isFinite(model.sampleSize) || model.sampleSize < 1) return false
  if (typeof model.brierBefore !== 'number' || !isFinite(model.brierBefore)) return false
  if (typeof model.brierAfter !== 'number' || !isFinite(model.brierAfter)) return false
  if (typeof model.calibrationError !== 'number' || !isFinite(model.calibrationError)) return false
  if (typeof model.trainedAt !== 'number' || !isFinite(model.trainedAt)) return false
  for (const bp of model.breakpoints) {
    if (
      typeof bp.x !== 'number' ||
      typeof bp.y !== 'number' ||
      !isFinite(bp.x) ||
      !isFinite(bp.y) ||
      bp.x < 0 ||
      bp.x > 1 ||
      bp.y < 0 ||
      bp.y > 1
    ) {
      return false
    }
  }
  return true
}

function sanitizeCalibrationModel(model: any): CalibrationModel {
  return {
    breakpoints: model.breakpoints
      .map((bp: any) => ({ x: Number(bp.x), y: Number(bp.y) }))
      .sort((a: { x: number }, b: { x: number }) => a.x - b.x),
    trainedAt: model.trainedAt,
    sampleSize: model.sampleSize,
    calibrationError: model.calibrationError,
    brierBefore: model.brierBefore,
    brierAfter: model.brierAfter,
  }
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
      const calibrationModel = model as CalibrationModel | CalibrationModelBundle

      // Wire into the live probability pipeline
      setCalibrationModel(calibrationModel)

      if (isCalibrationModelBundle(calibrationModel)) {
        console.log(
          `[calibration] Loaded segmented bundle: ${calibrationModel.sampleSize} global samples, ${Object.keys(calibrationModel.bySegment || {}).length} segments`
        )
      } else {
        console.log(`[calibration] Loaded model: ${calibrationModel.sampleSize} samples, Brier ${calibrationModel.brierBefore.toFixed(3)} → ${calibrationModel.brierAfter.toFixed(3)}`)
      }

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

      // ----------------------------------------------------------------
      // Shared: fetch resolved predictions from clean era
      // ----------------------------------------------------------------
      if (model?.action === 'dry-run' || model?.action === 'train') {
        const lookbackDaysRaw = Number(model.lookbackDays ?? 180)
        const lookbackDays = Number.isFinite(lookbackDaysRaw) && lookbackDaysRaw > 0
          ? Math.min(730, Math.max(7, Math.round(lookbackDaysRaw)))
          : 180

        const cutoff = Date.now() - lookbackDays * 24 * 60 * 60 * 1000
        // 2026-03-21T00:00:00Z — normalization fix deployed, clean era begins
        // Training must use only post-normalization data to avoid 3-8% probability inflation
        const CLEAN_ERA_EPOCH = 1774051200000
        const minTimestamp = Math.max(cutoff, CLEAN_ERA_EPOCH)
        const rows = await marketPredictionsCollection().find({
          resolvedOutcome: { $in: [0, 1] },
          rawProbability: { $gte: 0, $lte: 1 },
          timestamp: { $gte: minTimestamp },
          probabilityModel: 'bma',
        } as any)
          .sort({ timestamp: -1 })
          .limit(20000)
          .toArray()

        const globalPoints: CalibrationPoint[] = rows
          .filter(r => typeof r.rawProbability === 'number' && (r.resolvedOutcome === 0 || r.resolvedOutcome === 1))
          .map(r => ({ predicted: r.rawProbability as number, actual: r.resolvedOutcome as 0 | 1 }))

        if (globalPoints.length < 50) {
          return res.status(400).json({
            success: false,
            error: `Insufficient resolved predictions for calibration training (found ${globalPoints.length}, need >= 50).`,
            timestamp: Date.now(),
          })
        }

        // Segment readiness counts (for dry-run diagnostics and train info)
        const byTypePoints = new Map<CalibrationMarketType, CalibrationPoint[]>()
        const bySegmentPoints = new Map<string, CalibrationPoint[]>()

        for (const row of rows) {
          if (
            typeof row.rawProbability !== 'number' ||
            (row.resolvedOutcome !== 0 && row.resolvedOutcome !== 1) ||
            !row.marketType
          ) {
            continue
          }

          const point: CalibrationPoint = {
            predicted: row.rawProbability,
            actual: row.resolvedOutcome,
          }

          const typePoints = byTypePoints.get(row.marketType) || []
          typePoints.push(point)
          byTypePoints.set(row.marketType, typePoints)

          const leadBucket = toCalibrationLeadBucket(row.hoursToResolution ?? NaN)
          const segmentKey = buildCalibrationSegmentKey(row.marketType, leadBucket)
          const segmentPoints = bySegmentPoints.get(segmentKey) || []
          segmentPoints.push(point)
          bySegmentPoints.set(segmentKey, segmentPoints)
        }

        // ----------------------------------------------------------
        // action=dry-run — cross-validate without persisting anything
        // ----------------------------------------------------------
        if (model.action === 'dry-run') {
          const cv = crossValidateCalibration(globalPoints)

          const segmentReadiness: Record<string, { count: number; ready: boolean }> = {}
          for (const [key, pts] of byTypePoints.entries()) {
            segmentReadiness[`type:${key}`] = { count: pts.length, ready: pts.length >= DEFAULT_TYPE_MIN_SAMPLES }
          }
          for (const [key, pts] of bySegmentPoints.entries()) {
            segmentReadiness[`segment:${key}`] = { count: pts.length, ready: pts.length >= DEFAULT_SEGMENT_MIN_SAMPLES }
          }

          return res.status(200).json({
            success: true,
            data: {
              globalSampleSize: globalPoints.length,
              dataEpoch: minTimestamp,
              crossValidation: cv,
              segmentReadiness,
            },
            timestamp: Date.now(),
          } as any)
        }

        // ----------------------------------------------------------
        // action=train
        // ----------------------------------------------------------
        const globalOnly = model.globalOnly !== false  // default true
        const globalModel = trainCalibrationModel(globalPoints)

        // Safety gate: calibration must improve Brier
        if (globalModel.brierAfter >= globalModel.brierBefore) {
          return res.status(400).json({
            success: false,
            error: `Calibration worsens Brier (${globalModel.brierBefore.toFixed(4)} → ${globalModel.brierAfter.toFixed(4)}). Use dry-run to diagnose.`,
            timestamp: Date.now(),
          })
        }

        const byType: CalibrationModelBundle['byType'] = {}
        const bySegment: CalibrationModelBundle['bySegment'] = {}

        if (!globalOnly) {
          for (const [marketType, points] of byTypePoints.entries()) {
            if (points.length >= DEFAULT_TYPE_MIN_SAMPLES) {
              byType[marketType] = trainCalibrationModel(points)
            }
          }

          for (const [segmentKey, points] of bySegmentPoints.entries()) {
            if (points.length >= DEFAULT_SEGMENT_MIN_SAMPLES) {
              bySegment[segmentKey] = trainCalibrationModel(points)
            }
          }
        }

        const bundle: CalibrationModelBundle = {
          kind: 'segmented-v1',
          global: globalModel,
          byType,
          bySegment,
          minSamplesPerType: DEFAULT_TYPE_MIN_SAMPLES,
          minSamplesPerSegment: DEFAULT_SEGMENT_MIN_SAMPLES,
          trainedAt: Date.now(),
          sampleSize: globalPoints.length,
          version: `cal_${Date.now()}`,
          dataEpoch: minTimestamp,
        }

        await calibrationCollection().replaceOne(
          { _id: 'active' } as any,
          { _id: 'active', ...bundle } as any,
          { upsert: true }
        )

        setCalibrationModel(bundle)
        console.log(
          `[calibration] Segmented model trained: global=${bundle.sampleSize}, typeModels=${Object.keys(byType).length}, segmentModels=${Object.keys(bySegment).length}, version=${bundle.version}`
        )

        return res.status(200).json({
          success: true,
          data: bundle,
          timestamp: Date.now(),
        })
      }

      if (!isValidCalibrationModel(model)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid calibration model. Must include non-empty breakpoints array.',
          timestamp: Date.now(),
        })
      }
      const sanitizedModel = sanitizeCalibrationModel(model)

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
