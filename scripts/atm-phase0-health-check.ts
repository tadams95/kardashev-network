/**
 * Atmospheric Phase 0 — weekly health check (read-only).
 *
 * Verifies writer health + per-source coverage stability for the
 * `perSourceAtmosphere` ingestion shipped 2026-05-03. Re-run each weekly
 * checkpoint (2026-05-17 Week 2, 05-24 Week 3, 05-31 Week 4).
 *
 * Gates (working-checklist.md Atmospheric Phase 0 section):
 *   - Cumulative atm-tagged snapshots since deploy  →  Week 2 target ≥384
 *   - Open-Meteo presence among atm-tagged rows      →  ≥95%
 *   - NWS presence ≥ ~40.6%, Google-Weather ≥ ~54%   →  re-flag if materially below
 *   - AccuWeather / Tomorrow.io 0%                    →  expected (structural)
 *
 * Usage: npx tsx --tsconfig tsconfig.json scripts/atm-phase0-health-check.ts
 */
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config()

import { getDb, closeClient } from '../src/lib/db/mongodb'

const DEPLOY_EPOCH = Date.parse('2026-05-03T00:00:00Z')
const DAY_MS = 24 * 60 * 60 * 1000

// Week 1 baseline (2026-05-09) for stability comparison.
const WEEK1 = { atmTagged7d: 192, om: 99.0, gw: 54.2, nws: 40.6, aw: 0, ti: 0 }

interface SnapshotDoc {
  timestamp: number
  atmosphereCapturedAt?: number
  perSourceAtmosphere?: Record<string, unknown>
}

function pct(n: number, d: number): string {
  return d === 0 ? 'n/a' : `${((n / d) * 100).toFixed(1)}%`
}
function iso(ts: number): string {
  return new Date(ts).toISOString().slice(0, 16).replace('T', ' ')
}

async function main(): Promise<void> {
  const db = getDb()
  const col = db.collection<SnapshotDoc>('source_prediction_snapshots')
  const now = Date.now()

  const totalRows = await col.countDocuments({})
  const atmTaggedTotal = await col.countDocuments({ atmosphereCapturedAt: { $exists: true } })
  const atmTagged7d = await col.countDocuments({
    atmosphereCapturedAt: { $exists: true },
    timestamp: { $gte: now - 7 * DAY_MS },
  })
  const atmTaggedSinceDeploy = await col.countDocuments({
    atmosphereCapturedAt: { $exists: true },
    timestamp: { $gte: DEPLOY_EPOCH },
  })

  // Span of the atm-tagged population still resident in the collection.
  const oldest = await col.find({ atmosphereCapturedAt: { $exists: true } })
    .sort({ timestamp: 1 }).limit(1).toArray()
  const newest = await col.find({ atmosphereCapturedAt: { $exists: true } })
    .sort({ timestamp: -1 }).limit(1).toArray()

  // Per-source row-presence. Compute over TWO windows:
  //  (a) all atm-tagged rows (population view)
  //  (b) last-7d atm-tagged rows ONLY — apples-to-apples with the Week 1
  //      baseline, which also measured a 7d window. Mixing these is the
  //      documented "different metric, never comparable" trap.
  function tally(docs: SnapshotDoc[]): { presence: Map<string, number>; denom: number } {
    const presence = new Map<string, number>()
    for (const d of docs) {
      for (const k of Object.keys(d.perSourceAtmosphere ?? {})) {
        presence.set(k, (presence.get(k) ?? 0) + 1)
      }
    }
    return { presence, denom: docs.length }
  }
  const atmDocs = await col.find(
    { atmosphereCapturedAt: { $exists: true } },
    { projection: { perSourceAtmosphere: 1, timestamp: 1 } },
  ).toArray()
  const atmDocs7d = atmDocs.filter(d => d.timestamp >= now - 7 * DAY_MS)
  const { presence, denom } = tally(atmDocs)
  const w7 = tally(atmDocs7d)

  console.log('\n========================================================')
  console.log('  ATMOSPHERIC PHASE 0 — WEEKLY HEALTH CHECK')
  console.log(`  Run: ${iso(now)} UTC`)
  console.log('========================================================\n')

  console.log('WRITER HEALTH / ROW GROWTH')
  console.log(`  source_prediction_snapshots total rows : ${totalRows}`)
  console.log(`  atm-tagged total (atmosphereCapturedAt): ${atmTaggedTotal}`)
  console.log(`  atm-tagged since deploy (>=2026-05-03) : ${atmTaggedSinceDeploy}`)
  console.log(`  atm-tagged last 7d                     : ${atmTagged7d}  (Week 1 baseline: ${WEEK1.atmTagged7d})`)
  if (oldest[0] && newest[0]) {
    const spanDays = (newest[0].timestamp - oldest[0].timestamp) / DAY_MS
    console.log(`  atm-tagged span                        : ${iso(oldest[0].timestamp)} → ${iso(newest[0].timestamp)} (${spanDays.toFixed(1)}d)`)
    console.log(`  observed rate                          : ${(atmTaggedTotal / Math.max(spanDays, 1)).toFixed(1)}/day`)
  }

  const TARGET = 384
  const gate = atmTaggedSinceDeploy >= TARGET ? 'PASS ✅' : 'FAIL ❌'
  console.log(`\n  >> WEEK 2 GATE: cumulative ≥${TARGET}  →  ${atmTaggedSinceDeploy} ${gate}`)

  console.log('\nPER-SOURCE ROW-PRESENCE  (all atm-tagged n=' + denom + '  |  last-7d n=' + w7.denom + ')')
  const rows = [...presence.entries()].sort((a, b) => b[1] - a[1])
  for (const [src, c] of rows) {
    const c7 = w7.presence.get(src) ?? 0
    console.log(`  ${src.padEnd(16)} all ${pct(c, denom).padStart(7)} (${c}/${denom})   7d ${pct(c7, w7.denom).padStart(7)} (${c7}/${w7.denom})`)
  }

  // Week 1 baseline was a 7d window — compare against the 7d cut ONLY.
  console.log('\nSTABILITY vs WEEK 1  (7d-vs-7d, apples-to-apples)')
  const omP = (w7.presence.get('Open-Meteo') ?? 0) / Math.max(w7.denom, 1) * 100
  const gwP = (w7.presence.get('Google-Weather') ?? 0) / Math.max(w7.denom, 1) * 100
  const nwsP = (w7.presence.get('NWS') ?? 0) / Math.max(w7.denom, 1) * 100
  console.log(`  Open-Meteo  : ${omP.toFixed(1)}%  (gate ≥95%)        ${omP >= 95 ? 'OK' : 'FLAG ❌'}`)
  console.log(`  NWS         : ${nwsP.toFixed(1)}%  (Week1 ${WEEK1.nws}%, re-flag if materially below)  ${nwsP >= WEEK1.nws - 5 ? 'OK' : 'FLAG ⚠️'}`)
  console.log(`  Google-Wx   : ${gwP.toFixed(1)}%  (Week1 ${WEEK1.gw}%, re-flag if materially below)  ${gwP >= WEEK1.gw - 5 ? 'OK' : 'FLAG ⚠️'}`)
  console.log('  AccuWeather / Tomorrow.io expected 0% (structural — daily-only / rate-limited)\n')

  await closeClient()
}

main().catch(async (e) => {
  console.error(e)
  await closeClient()
  process.exit(1)
})
