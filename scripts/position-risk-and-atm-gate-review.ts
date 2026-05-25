/**
 * Scheduled reviews for 2026-05-18 (read-only).
 *
 * A) Position risk monitor — 2-week trigger-rate review
 *    (monitor deployed 2026-05-04; working-checklist.md:890)
 *    Criterion: count OK/WARN/CRITICAL; if false-positive rate >50% → tighten.
 *
 * B) Pre-trade atmospheric gate — +14d forensic (Phase F)
 *    (PRE_TRADE_ATM_GATE_MODE=shadow ~2026-05-04; working-checklist.md:1377-1407)
 *    Criterion: per paper quadrant, if TRIGGERED loss rate >= 2x clean loss
 *    rate → flip that quadrant's gate to active. Live cold-side HIGH excluded.
 *
 * Usage: npx tsx --tsconfig tsconfig.json scripts/position-risk-and-atm-gate-review.ts
 */
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config()

import { getDb, closeClient } from '../src/lib/db/mongodb'

// Inclusive lower bound for the shadow window. Gate deployed off→shadow ramp
// on/around 2026-05-04; we anchor here and ALSO print the empirically observed
// earliest tagged + earliest paper timestamps so the window is transparent.
const SHADOW_START = Date.parse('2026-05-04T00:00:00Z')
const DAY_MS = 86400000

interface TailSig {
  id: string
  result?: 'pending' | 'win' | 'loss' | null
  pnl?: number | null
  positionSize?: number
  mode?: 'live' | 'paper'
  direction?: 'cold' | 'warm'
  temperatureType?: 'high' | 'low'
  timestamp: number
  atmosphericTriggers?: unknown
}
interface RiskSnap {
  signalId: string
  riskLevel: 'OK' | 'WARN' | 'CRITICAL'
  riskTriggers?: string[]
  refreshedTimestamp: number
  mode?: 'live' | 'paper' | null
  direction?: 'cold' | 'warm'
  temperatureType?: 'high' | 'low'
}

const isTagged = (v: unknown): boolean => Array.isArray(v) && v.length > 0
const isInsufficient = (t?: string[]): boolean =>
  (t ?? []).some(s => s.startsWith('INSUFFICIENT_DATA'))
const sevRank = { OK: 0, WARN: 1, CRITICAL: 2 } as const

async function main(): Promise<void> {
  const db = getDb()
  const sigCol = db.collection<TailSig>('tail_sell_signals')
  const riskCol = db.collection<RiskSnap>('position_risk_snapshots')
  const now = Date.now()

  // Signal lookup (all signals; we filter per-section).
  const allSigs = await sigCol.find({}).toArray()
  const sigById = new Map(allSigs.map(s => [s.id, s]))

  console.log('\n================================================================')
  console.log('  SCHEDULED REVIEWS — 2026-05-18')
  console.log(`  Run ${new Date(now).toISOString().slice(0, 16)}Z`)
  console.log('================================================================')

  // ============================================================
  // A) POSITION RISK MONITOR — 2-WEEK TRIGGER-RATE REVIEW
  // ============================================================
  const snaps = await riskCol
    .find({ refreshedTimestamp: { $gte: SHADOW_START } })
    .toArray()

  // Snapshot-level volume view (alert fatigue).
  const snapDist = { OK: 0, WARN: 0, CRITICAL: 0, INSUFFICIENT_OK: 0 }
  for (const s of snaps) {
    if (s.riskLevel === 'OK' && isInsufficient(s.riskTriggers)) snapDist.INSUFFICIENT_OK++
    else snapDist[s.riskLevel]++
  }

  // Per-signal MAX severity ever reached (INSUFFICIENT_DATA-OK ignored as
  // non-classification, not a true OK).
  const maxSev = new Map<string, number>()
  for (const s of snaps) {
    if (s.riskLevel === 'OK' && isInsufficient(s.riskTriggers)) continue
    const r = sevRank[s.riskLevel]
    maxSev.set(s.signalId, Math.max(maxSev.get(s.signalId) ?? 0, r))
  }

  // Join per-signal severity to resolved outcome.
  const cell = { okWin: 0, okLoss: 0, warnWin: 0, warnLoss: 0, critWin: 0, critLoss: 0 }
  let monitoredResolved = 0
  for (const [sigId, sev] of maxSev) {
    const sig = sigById.get(sigId)
    if (!sig || (sig.result !== 'win' && sig.result !== 'loss')) continue
    monitoredResolved++
    const win = sig.result === 'win'
    if (sev === 0) win ? cell.okWin++ : cell.okLoss++
    else if (sev === 1) win ? cell.warnWin++ : cell.warnLoss++
    else win ? cell.critWin++ : cell.critLoss++
  }
  const flaggedWin = cell.warnWin + cell.critWin
  const flaggedLoss = cell.warnLoss + cell.critLoss
  const flaggedTot = flaggedWin + flaggedLoss
  const okTot = cell.okWin + cell.okLoss
  const fpRate = flaggedTot > 0 ? flaggedWin / flaggedTot : NaN
  const flaggedLossRate = flaggedTot > 0 ? flaggedLoss / flaggedTot : NaN
  const okLossRate = okTot > 0 ? cell.okLoss / okTot : NaN

  console.log('\n──── A) POSITION RISK MONITOR — 2-WEEK REVIEW ────')
  console.log(`Window: refreshedTimestamp >= 2026-05-04  (snapshots n=${snaps.length})`)
  console.log('\nSnapshot-level volume (alert-fatigue view):')
  console.log(`  OK              ${snapDist.OK}`)
  console.log(`  WARN            ${snapDist.WARN}`)
  console.log(`  CRITICAL        ${snapDist.CRITICAL}`)
  console.log(`  OK(insuff-data) ${snapDist.INSUFFICIENT_OK}  (skipped classifications — sourceCount<3, not a true OK)`)
  const realSnaps = snapDist.OK + snapDist.WARN + snapDist.CRITICAL
  const snapAlertRate = realSnaps > 0 ? (snapDist.WARN + snapDist.CRITICAL) / realSnaps : NaN
  console.log(`  → real-classification alert rate: ${(snapAlertRate * 100).toFixed(1)}% of ${realSnaps} classified snapshots`)

  console.log(`\nPer-signal max-severity × outcome  (resolved monitored signals n=${monitoredResolved}):`)
  console.log('  severity  | win | loss | loss-rate')
  console.log(`  OK        | ${String(cell.okWin).padEnd(3)} | ${String(cell.okLoss).padEnd(4)} | ${okTot ? (100 * cell.okLoss / okTot).toFixed(0) + '%' : 'n/a'}`)
  console.log(`  WARN      | ${String(cell.warnWin).padEnd(3)} | ${String(cell.warnLoss).padEnd(4)} |`)
  console.log(`  CRITICAL  | ${String(cell.critWin).padEnd(3)} | ${String(cell.critLoss).padEnd(4)} |`)
  console.log(`  WARN+CRIT | ${String(flaggedWin).padEnd(3)} | ${String(flaggedLoss).padEnd(4)} | ${flaggedTot ? (100 * flaggedLoss / flaggedTot).toFixed(0) + '%' : 'n/a'}`)
  console.log(`\n  False-positive rate (flagged but WON): ${isNaN(fpRate) ? 'n/a (no flagged-resolved signals)' : (fpRate * 100).toFixed(1) + '%'}  [criterion: tighten if >50%]`)
  console.log(`  Loss-prediction lift: flagged ${isNaN(flaggedLossRate) ? 'n/a' : (flaggedLossRate * 100).toFixed(0) + '%'} vs OK ${isNaN(okLossRate) ? 'n/a' : (okLossRate * 100).toFixed(0) + '%'} loss rate`)

  // ============================================================
  // B) PRE-TRADE ATM GATE — +14D FORENSIC (Phase F)
  // ============================================================
  const paperResolved = allSigs.filter(
    s => (s.result === 'win' || s.result === 'loss') && s.mode === 'paper' && s.timestamp >= SHADOW_START,
  )
  const taggedSigs = allSigs.filter(s => isTagged(s.atmosphericTriggers))
  const earliestTagged = taggedSigs.length
    ? Math.min(...taggedSigs.map(s => s.timestamp)) : null
  const earliestPaper = paperResolved.length
    ? Math.min(...paperResolved.map(s => s.timestamp)) : null
  const nullContam = allSigs.filter(s => s.atmosphericTriggers === null).length

  type G = { total: number; losses: number }
  const groups = new Map<string, G>()
  for (const r of paperResolved) {
    const q = `${r.direction}/${r.temperatureType}`
    const k = `${q} ${isTagged(r.atmosphericTriggers) ? 'TRIGGERED' : 'clean'}`
    const g = groups.get(k) ?? { total: 0, losses: 0 }
    g.total++
    if (r.result === 'loss') g.losses++
    groups.set(k, g)
  }

  console.log('\n──── B) PRE-TRADE ATM GATE — +14D FORENSIC (Phase F) ────')
  console.log(`Window: mode=paper, result∈{win,loss}, timestamp >= 2026-05-04  (n=${paperResolved.length})`)
  console.log(`Earliest tagged signal : ${earliestTagged ? new Date(earliestTagged).toISOString().slice(0, 16) + 'Z' : 'NONE — no signal ever carried atm triggers'}`)
  console.log(`Earliest paper signal  : ${earliestPaper ? new Date(earliestPaper).toISOString().slice(0, 16) + 'Z' : 'n/a'}`)
  console.log(`atmosphericTriggers=null contamination (legacy): ${nullContam}`)
  console.log(`Total signals with real (non-empty array) atm triggers, all modes: ${taggedSigs.length}`)

  console.log('\nQuadrant              | Total | Losses | Loss rate')
  for (const [k, g] of [...groups.entries()].sort()) {
    console.log(`  ${k.padEnd(20)}| ${String(g.total).padEnd(6)}| ${String(g.losses).padEnd(7)}| ${(100 * g.losses / g.total).toFixed(0)}%`)
  }

  console.log('\nPer-quadrant decision (TRIGGERED loss rate >= 2x clean → flip that quadrant active):')
  const quads = ['warm/high', 'warm/low', 'cold/low'] // paper quadrants; cold/high live = excluded
  for (const q of quads) {
    const t = groups.get(`${q} TRIGGERED`)
    const c = groups.get(`${q} clean`)
    const tr = t && t.total ? t.losses / t.total : null
    const cr = c && c.total ? c.losses / c.total : null
    let verdict: string
    if (!t || t.total === 0) verdict = 'NO TRIGGERED SAMPLE — cannot evaluate, stay shadow'
    else if (cr == null || cr === 0) verdict = tr && tr > 0
      ? `clean loss rate 0% — ratio undefined; n too small to flip (triggered n=${t.total})`
      : 'no losses either side — stay shadow'
    else {
      const ratio = (tr as number) / cr
      verdict = `${ratio.toFixed(1)}x  ${ratio >= 2 ? '→ FLIP candidate (verify n)' : '→ stay shadow'}`
    }
    console.log(`  ${q.padEnd(10)} triggered=${t ? `${t.losses}/${t.total}` : '0/0'}  clean=${c ? `${c.losses}/${c.total}` : '0/0'}  → ${verdict}`)
  }
  console.log('  cold/high  EXCLUDED — live earning path, shadow-only forever (mechanical protection)')

  await closeClient()
}

main().catch(async (e) => {
  console.error(e)
  await closeClient()
  process.exit(1)
})
