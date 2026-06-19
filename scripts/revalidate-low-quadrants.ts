/**
 * Fill-haircut re-validation of the two LOW paper quadrants (read-only).
 *
 * Paper P&L assumes 100% fill (paper signals place no real orders). Live data
 * shows maker tail-sell orders fill only ~66% of the time, so paper P&L
 * overstates what a flip-to-live would realize. This applies the EMPIRICAL live
 * fill rate as a first-order haircut, per quadrant + price band, so we judge a
 * flip on realistic (not fill-assumed) economics.
 *
 * HONEST LIMITS (first-order):
 *  - Assumes fills are OUTCOME-NEUTRAL (representative). The 2026-06-19 NY
 *    stale-fill showed fills can skew toward cases where the market moved toward
 *    the bracket (adverse selection) → true realized may be BELOW this estimate.
 *  - Uses cold/high's fill rate as the prior; LOW-market liquidity may differ.
 *  Rigorous follow-up: per-signal fill SIMULATION against kalshi_market_snapshots
 *  for each LOW ticker, or a live pilot. This is the screening step.
 *
 * Usage: npx tsx --tsconfig tsconfig.json scripts/revalidate-low-quadrants.ts
 */
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config()
import { getDb, closeClient } from '../src/lib/db/mongodb'

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

async function main(): Promise<void> {
  const db = getDb()
  const col = db.collection<any>('tail_sell_signals')
  const all = await col.find({}).toArray()

  // Empirical live fill rate (cold/high realized): filled / resolved.
  const liveResolved = all.filter(s => s.mode !== 'paper' && (s.result === 'win' || s.result === 'loss') && s.kalshiOrderId && s.kalshiOrderId !== 'skipped_market_closed')
  const liveFilled = liveResolved.filter(s => (s.filledCount ?? 0) > 0)
  const fillRate = liveResolved.length ? liveFilled.length / liveResolved.length : NaN

  console.log('\n=================================================================')
  console.log('  LOW-QUADRANT FILL-HAIRCUT RE-VALIDATION')
  console.log(`  Run ${new Date().toISOString().slice(0, 16)} UTC`)
  console.log('=================================================================')
  console.log(`Empirical live fill rate (cold/high): ${liveFilled.length}/${liveResolved.length} = ${(fillRate * 100).toFixed(1)}%  → haircut factor ${fillRate.toFixed(3)}`)
  console.log('(paper $ uses pnl×positionSize, the dashboard convention, for comparability)\n')

  const quadrants: Array<{ name: string; dir: string; tt: string }> = [
    { name: 'warm-tail-LOW', dir: 'warm', tt: 'low' },
    { name: 'cold-tail-LOW', dir: 'cold', tt: 'low' },
  ]

  for (const q of quadrants) {
    const sigs = all.filter(s => s.mode === 'paper' && s.direction === q.dir && s.temperatureType === q.tt)
    const resolved = sigs.filter(s => s.result === 'win' || s.result === 'loss')
    const wins = resolved.filter(s => s.result === 'win').length
    const wr = resolved.length ? wins / resolved.length : NaN
    const paperPnl = resolved.reduce((sum, s) => sum + (num(s.pnl) ?? 0) * (s.positionSize ?? 0), 0)
    const haircutPnl = paperPnl * fillRate

    console.log(`──── ${q.name} ────`)
    console.log(`  signals: ${sigs.length} | resolved: ${resolved.length} | win rate: ${(wr * 100).toFixed(1)}%`)
    console.log(`  fill-assumed P&L (paper): $${paperPnl.toFixed(2)}`)
    console.log(`  fill-haircut estimate (×${fillRate.toFixed(2)}): $${haircutPnl.toFixed(2)}  [first-order; may be optimistic if adverse selection]`)
    // by price band
    for (const [lab, lo, hi] of [['5-9c', 0.05, 0.0999], ['10-14c', 0.10, 0.1499], ['15c+', 0.15, 1.01]] as const) {
      const b = resolved.filter(s => { const y = num(s.yesPrice); return y !== null && y >= lo && y <= hi })
      if (!b.length) continue
      const bw = b.filter(s => s.result === 'win').length
      const bp = b.reduce((sum, s) => sum + (num(s.pnl) ?? 0) * (s.positionSize ?? 0), 0)
      console.log(`    ${lab.padEnd(7)} n=${String(b.length).padStart(3)} WR ${(100 * bw / b.length).toFixed(0)}%  paper $${bp.toFixed(2)} → haircut $${(bp * fillRate).toFixed(2)}`)
    }
    console.log('')
  }

  console.log('CAVEATS: haircut assumes fills are outcome-neutral; LOW liquidity may differ from')
  console.log('cold/high. Treat as a SCREEN. Rigorous confirm = per-signal fill simulation vs')
  console.log('kalshi_market_snapshots, or a small live pilot. Also: post_only now rejects')
  console.log('marketable (chasing) orders → going-forward fills skew to RESTED (safer) ones.\n')

  await closeClient()
}
main().catch(async (e) => { console.error(e); await closeClient(); process.exit(1) })
