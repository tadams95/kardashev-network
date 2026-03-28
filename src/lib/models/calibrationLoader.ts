// Server-only lazy loader for calibration model.
// Lives in a separate file to avoid pulling MongoDB into client bundles
// (weatherProbability.ts is imported by _app.tsx which is bundled for browser).
//
// Fixes the webpack module isolation bug: instrumentation.node.ts sets
// activeCalibrationModel in a different module instance than API routes use.
// This loader is called from API route code, guaranteeing the model is set
// in the same module instance that applyCalibration() reads from.

import { getDb } from '@/lib/db/mongodb'
import { setCalibrationModel, isCalibrationModelLoaded } from './weatherProbability'
import { isCalibrationModelBundle } from './calibration'

let lazyLoadAttempted = false

/**
 * Ensure the calibration model is loaded into the weatherProbability module instance.
 * No-ops if model is already loaded or if a load was already attempted.
 * Call this from server-side entry points (API routes, warmup) before computing probabilities.
 */
export async function ensureCalibrationLoaded(): Promise<void> {
  if (isCalibrationModelLoaded() || lazyLoadAttempted) return
  lazyLoadAttempted = true
  try {
    const db = getDb()
    const doc = await db.collection('calibration').findOne({ _id: 'active' as any })
    if (doc && (doc as any).kind === 'segmented-v1') {
      const { _id, ...bundle } = doc as any
      setCalibrationModel(bundle)
      const globalSize = bundle.global?.sampleSize ?? 0
      const version = bundle.version ?? 'unknown'
      console.log(`[calibration] Lazy-loaded ${version}:global (${globalSize} samples)`)
    } else if (doc?.breakpoints) {
      const { _id, ...model } = doc as any
      setCalibrationModel(model)
      console.log(`[calibration] Lazy-loaded legacy model (${model.breakpoints?.length ?? 0} breakpoints)`)
    } else {
      console.log('[calibration] No calibration model found in MongoDB')
    }
  } catch (err) {
    console.warn('[calibration] Lazy-load failed:', err instanceof Error ? err.message : err)
  }
}
