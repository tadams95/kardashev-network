// Cleanup script: remove cross-city contaminated documents
// Finds source_accuracy, source_prediction_snapshots, and temp_bias docs
// where the stored cityCode doesn't match the city derived from marketId.
// Run: npx tsx --tsconfig tsconfig.json scripts/cleanup-cross-city.ts
// Add --dry-run to preview without deleting.

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config()
import { getDb, closeClient } from '../src/lib/db/mongodb'
import { extractCityCode } from '../src/lib/utils/tickerParsing'

const DRY_RUN = process.argv.includes('--dry-run')

async function cleanCollection(collectionName: string): Promise<number> {
  const col = getDb().collection(collectionName)

  // Only look at docs that have a marketId field to derive city from
  const cursor = col.find({ marketId: { $exists: true, $ne: null } })

  const toDelete: string[] = []
  let scanned = 0

  for await (const doc of cursor) {
    scanned++
    const storedCity = doc.cityCode as string | undefined
    const marketId = doc.marketId as string
    if (!storedCity || !marketId) continue

    const derivedCity = extractCityCode(marketId)
    if (!derivedCity) continue

    if (derivedCity !== storedCity) {
      toDelete.push(doc._id.toString())
      if (toDelete.length <= 20) {
        console.log(`  [${collectionName}] mismatch: stored=${storedCity} derived=${derivedCity} marketId=${marketId} _id=${doc._id}`)
      }
    }
  }

  if (toDelete.length > 20) {
    console.log(`  [${collectionName}] ... and ${toDelete.length - 20} more mismatches`)
  }

  console.log(`  [${collectionName}] scanned=${scanned} mismatches=${toDelete.length}`)

  if (toDelete.length === 0) return 0

  if (DRY_RUN) {
    console.log(`  [${collectionName}] DRY RUN — skipping deletion`)
    return 0
  }

  // Delete in batches to avoid huge operations
  const { ObjectId } = await import('mongodb')
  const BATCH = 500
  let deleted = 0
  for (let i = 0; i < toDelete.length; i += BATCH) {
    const batch = toDelete.slice(i, i + BATCH).map(id => new ObjectId(id))
    const result = await col.deleteMany({ _id: { $in: batch } })
    deleted += result.deletedCount
  }

  console.log(`  [${collectionName}] deleted=${deleted}`)
  return deleted
}

async function main() {
  console.log(`[cleanup-cross-city] ${DRY_RUN ? 'DRY RUN' : 'LIVE'} mode`)
  console.log()

  const collections = ['source_accuracy', 'source_prediction_snapshots', 'temp_bias']
  let totalDeleted = 0

  for (const name of collections) {
    console.log(`[cleanup-cross-city] Processing ${name}...`)
    const deleted = await cleanCollection(name)
    totalDeleted += deleted
    console.log()
  }

  console.log(`[cleanup-cross-city] Total deleted: ${totalDeleted}`)

  if (!DRY_RUN && totalDeleted > 0) {
    console.log('[cleanup-cross-city] Triggering weight rollup recomputation...')
    const { recomputeAndPublishWeightRollups } = await import('../src/lib/models/sourceAccuracy')
    const rollup = await recomputeAndPublishWeightRollups()
    console.log(`[cleanup-cross-city] Weight rollup: ${rollup.keysWritten} keys (${rollup.durationMs}ms)`)
  }
}

main()
  .then(() => closeClient())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[cleanup-cross-city] Fatal:', err)
    closeClient().finally(() => process.exit(1))
  })
