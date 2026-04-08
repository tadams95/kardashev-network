// Node.js-only instrumentation — loads calibration model and triggers cache warmup.
// Imported dynamically from instrumentation.ts to avoid edge runtime bundling issues.

export async function register() {
  console.log('[instrumentation] server startup hook running...')

  // 1. Load calibration model from MongoDB
  try {
    const { getDb } = await import('@/lib/db/mongodb')
    const { setCalibrationModel } = await import('@/lib/models/weatherProbability')
    const { isCalibrationModelBundle } = await import('@/lib/models/calibration')

    const db = getDb()
    const doc = await db.collection('calibration').findOne({ _id: 'active' as any })

    if (doc && (doc as any).kind === 'segmented-v1') {
      const { _id, ...bundle } = doc as any
      setCalibrationModel(bundle)
      const globalSize = bundle.global?.sampleSize ?? 0
      const segmentCount = Object.keys(bundle.bySegment || {}).length
      console.log('[instrumentation] Segmented calibration bundle loaded (%d global samples, %d segment models)', globalSize, segmentCount)
      const trainedAt = bundle.trainedAt ?? bundle.global?.trainedAt
      if (trainedAt && Date.now() - trainedAt > 30 * 24 * 60 * 60 * 1000) {
        console.warn('[instrumentation] Calibration model is >30 days old (trained %s) — consider retraining', new Date(trainedAt).toISOString())
      }
    } else if (doc?.breakpoints) {
      const { _id, ...model } = doc as any
      setCalibrationModel(model)
      console.log('[instrumentation] Calibration model loaded from MongoDB (%d breakpoints)', model.breakpoints?.length ?? 0)
      if (model.trainedAt && Date.now() - model.trainedAt > 30 * 24 * 60 * 60 * 1000) {
        console.warn('[instrumentation] Calibration model is >30 days old (trained %s) — consider retraining', new Date(model.trainedAt).toISOString())
      }
    } else {
      // Fallback: seed from JSON file if MongoDB is empty
      try {
        const fs = await import('fs/promises')
        const path = await import('path')
        const filePath = path.join(process.cwd(), 'data/weather/calibration_model.json')
        const raw = await fs.readFile(filePath, 'utf-8')
        const model = JSON.parse(raw)
        if (isCalibrationModelBundle(model) || model?.breakpoints) {
          setCalibrationModel(model)
          await db.collection('calibration').replaceOne(
            { _id: 'active' as any },
            { _id: 'active', ...model } as any,
            { upsert: true }
          )
          if (isCalibrationModelBundle(model)) {
            console.log('[instrumentation] Segmented calibration bundle seeded from JSON file (%d segment models)', Object.keys(model.bySegment || {}).length)
          } else {
            console.log('[instrumentation] Calibration model seeded from JSON file (%d breakpoints)', model.breakpoints.length)
          }
        }
      } catch {
        console.log('[instrumentation] No calibration model found in MongoDB or JSON file')
      }
    }
  } catch (err) {
    console.warn('[instrumentation] Failed to load calibration model:', err instanceof Error ? err.message : err)
  }

  // 2. Trigger cache warmup in background (non-blocking)
  try {
    const { warmupCaches } = await import('@/lib/cache/warmup')
    warmupCaches().catch(err => {
      console.warn('[instrumentation] Cache warmup failed:', err instanceof Error ? err.message : err)
    })
  } catch (err) {
    console.warn('[instrumentation] Failed to start cache warmup:', err instanceof Error ? err.message : err)
  }

  // 3. Arm the scheduled opportunity refresh loop. Warmup handles the
  //    "cycle 0" compute on startup; the scheduler aligns the first
  //    scheduled cycle to the next round hour and then runs hourly,
  //    ensuring signal logging fires on a predictable cadence even
  //    when browser traffic is low. See scheduledRefresh.ts for the
  //    interval justification and AccuWeather quota math.
  try {
    const { startScheduledOpportunityRefresh } = await import('@/lib/cache/scheduledRefresh')
    startScheduledOpportunityRefresh()
  } catch (err) {
    console.warn('[instrumentation] Failed to start scheduled refresh:', err instanceof Error ? err.message : err)
  }
}

// Auto-run on import
register()
