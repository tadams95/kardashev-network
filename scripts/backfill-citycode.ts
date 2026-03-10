import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config()

import { getDb, closeClient } from '../src/lib/db/mongodb'
import { extractCityCode } from '../src/lib/utils/tickerParsing'

const APPLY = process.argv.includes('--apply')
const DRY_RUN = !APPLY

async function main(): Promise<void> {
  const db = getDb()

  // Backfill signals
  const signals = db.collection('signals')
  const missingSignals = await signals.find({
    $or: [{ cityCode: { $exists: false } }, { cityCode: null }, { cityCode: '' }],
  }).toArray()

  console.log(`=== Signals missing cityCode: ${missingSignals.length} ===`)
  let signalUpdates = 0
  let signalSkips = 0

  for (const s of missingSignals) {
    const derived = extractCityCode(s.marketId)
    if (derived) {
      console.log(`  ${s.marketId} → ${derived}`)
      if (!DRY_RUN) {
        await signals.updateOne({ _id: s._id }, { $set: { cityCode: derived } })
      }
      signalUpdates++
    } else {
      console.log(`  ${s.marketId} → SKIP (no city derivable)`)
      signalSkips++
    }
  }
  console.log(`Signals: ${signalUpdates} updatable, ${signalSkips} skipped`)

  // Backfill market_predictions
  const predictions = db.collection('market_predictions')
  const missingPreds = await predictions.find({
    $or: [{ cityCode: { $exists: false } }, { cityCode: null }, { cityCode: '' }],
  }).toArray()

  console.log(`\n=== Market predictions missing cityCode: ${missingPreds.length} ===`)
  let predUpdates = 0
  let predSkips = 0

  for (const p of missingPreds) {
    const derived = extractCityCode(p.marketId)
    if (derived) {
      console.log(`  ${p.marketId} → ${derived}`)
      if (!DRY_RUN) {
        await predictions.updateOne({ _id: p._id }, { $set: { cityCode: derived } })
      }
      predUpdates++
    } else {
      console.log(`  ${p.marketId} → SKIP (no city derivable)`)
      predSkips++
    }
  }
  console.log(`Predictions: ${predUpdates} updatable, ${predSkips} skipped`)

  if (DRY_RUN) {
    console.log('\n[DRY RUN] No changes made. Pass --apply to update.')
  } else {
    console.log('\nDone.')
  }
}

main()
  .then(() => closeClient())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[backfill-citycode] Fatal:', err)
    closeClient().finally(() => process.exit(1))
  })
