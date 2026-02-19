// Next.js Instrumentation Hook — runs once on server startup.
// Loads the calibration model from MongoDB and triggers cache warmup.

export async function register() {
  // Only run on the server
  if (typeof window !== 'undefined') return

  console.log('[instrumentation] server startup hook running...')

  // 1. Load calibration model from MongoDB
  try {
    const { getDb } = await import('@/lib/db/mongodb')
    const { setCalibrationModel } = await import('@/lib/models/weatherProbability')

    const db = getDb()
    const doc = await db.collection('calibration').findOne({ _id: 'active' as any })

    if (doc?.model) {
      setCalibrationModel(doc.model)
      console.log('[instrumentation] Calibration model loaded from MongoDB (%d breakpoints)', doc.model.breakpoints?.length ?? 0)
    } else {
      console.log('[instrumentation] No calibration model found in MongoDB (collection: calibration, _id: active)')
    }
  } catch (err) {
    console.warn('[instrumentation] Failed to load calibration model:', err instanceof Error ? err.message : err)
  }

  // 2. Trigger cache warmup in background (non-blocking)
  try {
    const { warmupCaches } = await import('@/lib/cache/warmup')
    // Fire and forget — don't await, don't block server startup
    warmupCaches().catch(err => {
      console.warn('[instrumentation] Cache warmup failed:', err instanceof Error ? err.message : err)
    })
  } catch (err) {
    console.warn('[instrumentation] Failed to start cache warmup:', err instanceof Error ? err.message : err)
  }
}
