// Backfill actualF + actualFKind for historical tail-sell loss records that
// have actualF=null. Mirrors the derivation logic in resolveTailSellSignals.
// Idempotent — safe to re-run; only touches result='loss' rows missing the
// fields. Run once after Deploy of the actualF fix.
//
// Usage:
//   npx tsx scripts/backfill-tail-sell-actual-loss.ts            # write changes
//   npx tsx scripts/backfill-tail-sell-actual-loss.ts --dry-run  # report only

import * as fs from 'fs'
import * as path from 'path'
import { getDb, closeClient } from '../src/lib/db/mongodb'
import type { TailSellRecord } from '../src/lib/models/tailSellTracker'

function loadEnvFile() {
  try {
    const envPath = path.join(__dirname, '../.env.local')
    const envContent = fs.readFileSync(envPath, 'utf-8')
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const match = trimmed.match(/^([^=]+)=(.*)$/)
      if (!match) continue
      process.env[match[1].trim()] = match[2].trim()
    }
  } catch {
    console.warn('[backfill] Could not load .env.local')
  }
}

loadEnvFile()

const DRY_RUN = process.argv.includes('--dry-run')

async function main() {
  const db = getDb()
  const col = db.collection<TailSellRecord>('tail_sell_signals')

  const candidates = await col
    .find({ result: 'loss', actualF: null })
    .toArray()

  console.log(
    `[backfill] Found ${candidates.length} loss record(s) with null actualF` +
    (DRY_RUN ? ' (DRY RUN — no writes)' : '')
  )

  let coldLe = 0
  let warmGe = 0
  let skipped = 0
  let updated = 0

  for (const record of candidates) {
    let actualF: number | null = null
    let actualFKind: 'le' | 'ge' | null = null

    if (record.direction === 'cold' && record.bracketCapF != null) {
      actualF = record.bracketCapF
      actualFKind = 'le'
    } else if (record.direction === 'warm' && record.bracketFloorF != null) {
      actualF = record.bracketFloorF
      actualFKind = 'ge'
    }

    if (actualF == null || actualFKind == null) {
      skipped++
      console.warn(
        `[backfill] SKIP ${record.id} ${record.cityCode} ` +
        `direction=${record.direction} cap=${record.bracketCapF} floor=${record.bracketFloorF}`
      )
      continue
    }

    const prefix = actualFKind === 'le' ? '\u2264' : '\u2265'
    console.log(
      `[backfill] ${DRY_RUN ? 'WOULD UPDATE' : 'UPDATING'} ${record.id} ` +
      `${record.cityCode} ${record.direction} \u2192 actualF=${prefix}${actualF}\u00b0F kind=${actualFKind}`
    )

    if (!DRY_RUN) {
      await col.updateOne({ id: record.id }, { $set: { actualF, actualFKind } })
    }

    if (actualFKind === 'le') coldLe++
    else if (actualFKind === 'ge') warmGe++
    updated++
  }

  console.log('')
  console.log(`[backfill] Summary: ${updated} ${DRY_RUN ? 'would-update' : 'updated'} ` +
    `(${coldLe} cold-le, ${warmGe} warm-ge), ${skipped} skipped`)

  await closeClient()
}

main().catch(err => {
  console.error('[backfill] ERROR:', err)
  process.exit(1)
})
