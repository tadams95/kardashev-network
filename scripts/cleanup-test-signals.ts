import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config()

import { getDb, closeClient } from '../src/lib/db/mongodb'

const APPLY = process.argv.includes('--apply')
const DRY_RUN = !APPLY

// Patterns that match known test signal marketIds
const TEST_PATTERNS = [
  /^EDGE-\d+$/,
  /^DECAY-\d+$/,
  /^TEST-\d+$/,
  /^NO-WIN-\d+$/,
]

function isTestMarketId(marketId: string): boolean {
  return TEST_PATTERNS.some(p => p.test(marketId))
}

async function main(): Promise<void> {
  const db = getDb()
  const signals = db.collection('signals')
  const predictions = db.collection('market_predictions')

  // Find test signals
  const testSignals = await signals.find({}).toArray()
  const toDelete = testSignals.filter(s => isTestMarketId(s.marketId))

  console.log(`Found ${toDelete.length} test signals out of ${testSignals.length} total`)
  for (const s of toDelete) {
    console.log(`  ${s.marketId} | outcome=${s.outcome} | ts=${new Date(s.timestamp).toISOString()}`)
  }

  // Check market_predictions too
  const testPredictions = await predictions.find({}).toArray()
  const predsToDelete = testPredictions.filter((p: any) => isTestMarketId(p.marketId))
  console.log(`\nFound ${predsToDelete.length} test market_predictions out of ${testPredictions.length} total`)

  if (DRY_RUN) {
    console.log('\n[DRY RUN] No changes made. Pass --apply to delete.')
    return
  }

  if (toDelete.length > 0) {
    const ids = toDelete.map(s => s._id)
    const result = await signals.deleteMany({ _id: { $in: ids } })
    console.log(`\nDeleted ${result.deletedCount} test signals`)
  }

  if (predsToDelete.length > 0) {
    const ids = predsToDelete.map((p: any) => p._id)
    const result = await predictions.deleteMany({ _id: { $in: ids } })
    console.log(`Deleted ${result.deletedCount} test market_predictions`)
  }

  console.log('\nDone.')
}

main()
  .then(() => closeClient())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[cleanup-test-signals] Fatal:', err)
    closeClient().finally(() => process.exit(1))
  })
