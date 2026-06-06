import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config()

import { getDb, closeClient } from '../src/lib/db/mongodb'

// TAIL_YES_MAX 0.20 → 0.15 +30d re-evaluation (trigger date 2026-06-06).
// Re-audits cold-side HIGH *live* tail-sell trades by yesPrice bucket, split
// all-time vs since the cap change, plus a pre/post volume comparison.
// Decision rules from memory/feedback-tail-yes-max-2026-05-07.md.

const CAP_CHANGE_EPOCH = Date.UTC(2026, 4, 7) // 2026-05-07T00:00Z (month is 0-indexed)
const FEE_PER_CONTRACT = 0.018

interface TailSellDoc {
  cityCode: string
  direction: string
  temperatureType?: string
  mode?: string
  yesPrice: number
  result: string | null
  pnl: number | null
  positionSize: number
  timestamp: number
  resolvedAt: number | null
}

const BUCKETS: { label: string; lo: number; hi: number }[] = [
  { label: '5-9¢',   lo: 0.05, hi: 0.10 },
  { label: '10-14¢', lo: 0.10, hi: 0.15 },
  { label: '15-20¢', lo: 0.15, hi: 0.2001 },
]

function bucketOf(yesPrice: number): string | null {
  for (const b of BUCKETS) {
    if (yesPrice >= b.lo && yesPrice < b.hi) return b.label
  }
  return null
}

function fmtPnl(n: number): string {
  return (n >= 0 ? '+$' : '-$') + Math.abs(n).toFixed(2)
}

// pnl is stored per-1-contract; real-dollar P&L = pnl × positionSize (contract count).
function summarize(rows: TailSellDoc[]): { n: number; wins: number; pnl: number } {
  let wins = 0, pnl = 0
  for (const r of rows) {
    if (r.result === 'win') wins++
    pnl += (r.pnl ?? 0) * (r.positionSize ?? 1)
  }
  return { n: rows.length, wins, pnl }
}

function printBucketTable(title: string, rows: TailSellDoc[]): void {
  console.log(`\n  ${title}`)
  console.log('  Bucket   Total  WinRate   Net P&L     EV/trade')
  console.log('  ' + '─'.repeat(50))
  for (const b of BUCKETS) {
    const inBucket = rows.filter(r => bucketOf(r.yesPrice) === b.label)
    const s = summarize(inBucket)
    const wr = s.n ? `${(100 * s.wins / s.n).toFixed(1)}%` : 'N/A'
    const ev = s.n ? fmtPnl(s.pnl / s.n) : 'N/A'
    console.log(
      `  ${b.label.padEnd(7)}  ${String(s.n).padStart(4)}   ${wr.padStart(6)}   ${fmtPnl(s.pnl).padStart(8)}   ${ev.padStart(8)}`
    )
  }
  const tot = summarize(rows)
  console.log('  ' + '─'.repeat(50))
  console.log(
    `  ${'TOTAL'.padEnd(7)}  ${String(tot.n).padStart(4)}   ${(tot.n ? (100 * tot.wins / tot.n).toFixed(1) + '%' : 'N/A').padStart(6)}   ${fmtPnl(tot.pnl).padStart(8)}`
  )
}

async function main() {
  const db = getDb()
  const col = db.collection<TailSellDoc>('tail_sell_signals')
  const all = await col.find().toArray()

  // Cold-side HIGH, live (mode absent or 'live'), resolved (win/loss).
  const live = all.filter(
    r => r.direction === 'cold'
      && (r.temperatureType ?? 'high') === 'high'
      && (r.mode ?? 'live') === 'live'
  )
  const resolved = live.filter(r => r.result === 'win' || r.result === 'loss')

  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  TAIL_YES_MAX 0.20→0.15 +30d Re-Eval  (cold-side HIGH, live)')
  console.log('═══════════════════════════════════════════════════════════════')
  console.log(`  Cap change date: 2026-05-07  |  audit run scope: all tail_sell_signals`)
  console.log(`  Live cold-HIGH signals: ${live.length} total, ${resolved.length} resolved`)

  // Sanity: yesPrice range + how many resolved fall above the new cap.
  const yesVals = resolved.map(r => r.yesPrice).sort((a, b) => a - b)
  if (yesVals.length) {
    console.log(`  yesPrice range (resolved): ${yesVals[0]?.toFixed(3)} – ${yesVals[yesVals.length - 1]?.toFixed(3)}`)
  }
  const aboveCap = resolved.filter(r => r.yesPrice >= 0.15)
  console.log(`  resolved with yesPrice ≥ 0.15: ${aboveCap.length} (expect ~0 for signals emitted post-cap)`)

  printBucketTable('ALL-TIME (all resolved cold-HIGH live)', resolved)

  const postCap = resolved.filter(r => r.timestamp >= CAP_CHANGE_EPOCH)
  const preCap = resolved.filter(r => r.timestamp < CAP_CHANGE_EPOCH)
  printBucketTable('SINCE CAP CHANGE (timestamp ≥ 2026-05-07)', postCap)
  printBucketTable('BEFORE CAP CHANGE (timestamp < 2026-05-07)', preCap)

  // ── Volume comparison: live cold-HIGH signals/day, pre vs post cap ─────────
  const now = Date.now()
  const daysPre = (CAP_CHANGE_EPOCH - Math.min(...live.map(r => r.timestamp))) / 86_400_000
  const daysPost = (now - CAP_CHANGE_EPOCH) / 86_400_000
  const preCount = live.filter(r => r.timestamp < CAP_CHANGE_EPOCH).length
  const postCount = live.filter(r => r.timestamp >= CAP_CHANGE_EPOCH).length
  console.log('\n  ── Signal volume (live cold-HIGH, all results) ──')
  console.log(`  Pre-cap : ${preCount} signals over ${daysPre.toFixed(0)}d  = ${(preCount / Math.max(daysPre, 1)).toFixed(2)}/day`)
  console.log(`  Post-cap: ${postCount} signals over ${daysPost.toFixed(0)}d  = ${(postCount / Math.max(daysPost, 1)).toFixed(2)}/day`)
  const pendingPost = live.filter(r => r.timestamp >= CAP_CHANGE_EPOCH && r.result === 'pending').length
  console.log(`  (post-cap still pending: ${pendingPost})`)

  console.log('\n  ── Decision checks (rules from memory note) ──')
  const band1014 = postCap.filter(r => bucketOf(r.yesPrice) === '10-14¢')
  const s1014 = summarize(band1014)
  console.log(`  • 10-14¢ band post-cap: n=${s1014.n}, P&L=${fmtPnl(s1014.pnl)} ${s1014.pnl < 0 ? '→ NEGATIVE: consider tightening to 0.12' : '→ positive/flat: hold at 0.15'}`)
  const perDayPost = postCount / Math.max(daysPost, 1)
  console.log(`  • Volume floor (rollback if <3.5/day sustained): post-cap ${perDayPost.toFixed(2)}/day`)

  await closeClient()
}

main().catch(async (e) => { console.error(e); await closeClient(); process.exit(1) })
