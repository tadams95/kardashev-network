/**
 * Warm-tail-LOW stop monitor (Item 4, 2026-07-22). READ-ONLY against trading state.
 * Computes cumulative realized warm-low P&L (filled-contract dollars, post PR #8) and
 * the Wilson 95% CI upper bound on live-filled win rate, logs both every run, and
 * emits a prominent Telegram alert when either agreed stop is breached
 * (P&L <= -$35, or Wilson upper < 92%).
 *
 * It does NOT auto-flip the env — reverting warm-low to paper stays a human decision.
 * The job's job is to make the trigger impossible to miss, not to act.
 *
 * Runs daily via PM2 cron (kardashev-warmlow-stops). Usage: npm run check-warmlow-stops
 */
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config()
import { getDb, closeClient } from '../src/lib/db/mongodb'
import { realizedPnlDollars } from '../src/lib/models/tailSellTracker'
import { evaluateWarmLowStops, WARMLOW_PNL_STOP, WARMLOW_WINRATE_STOP } from '../src/lib/models/warmLowStops'
import { sendTelegramAlert } from '../src/lib/utils/telegram'

async function main(): Promise<void> {
  const db = getDb()
  const col = db.collection<any>('tail_sell_signals')

  // Warm-tail-LOW, LIVE, resolved, actually filled — the cumulative live position.
  const rows = await col.find({
    direction: 'warm',
    temperatureType: 'low',
    mode: { $ne: 'paper' },
    result: { $in: ['win', 'loss'] },
    filledCount: { $gt: 0 },
  }).toArray()

  let realizedPnl = 0
  let wins = 0
  for (const r of rows) {
    realizedPnl += realizedPnlDollars(r)   // pnl × filledCount (real dollars)
    if (r.result === 'win') wins++
  }
  const nFilled = rows.length
  const status = evaluateWarmLowStops(realizedPnl, wins, nFilled)

  console.log(
    `[warmlow-stops] realizedPnl=$${status.realizedPnl.toFixed(2)} | ` +
    `filled winrate=${status.winRate != null ? (status.winRate * 100).toFixed(1) + '%' : 'n/a'} (n=${nFilled}, wins=${wins}) | ` +
    `Wilson95 upper=${(status.wilsonUpper * 100).toFixed(1)}% | ` +
    `stops: pnl(<=$${WARMLOW_PNL_STOP})=${status.pnlBreached ? 'BREACHED' : 'ok'}, ` +
    `winrate(upper<${WARMLOW_WINRATE_STOP * 100}%)=${status.winRateBreached ? 'BREACHED' : 'ok'}`
  )

  if (status.alert) {
    const reasons: string[] = []
    if (status.pnlBreached) reasons.push(`• Drawdown: realized $${status.realizedPnl.toFixed(2)} ≤ $${WARMLOW_PNL_STOP}`)
    if (status.winRateBreached) reasons.push(`• Win-rate: Wilson 95% upper ${(status.wilsonUpper * 100).toFixed(1)}% < ${WARMLOW_WINRATE_STOP * 100}%`)
    await sendTelegramAlert(
      `⚠️ WARM-LOW STOP TRIGGERED — consider reverting warm-low to paper.\n` +
      reasons.join('\n') +
      `\n(n=${nFilled} filled, winrate=${status.winRate != null ? (status.winRate * 100).toFixed(1) + '%' : 'n/a'})\n` +
      `This alert does NOT auto-flip. Reverting is a human decision: set LOW_TEMP_WARM_TAIL_MODE=paper and pm2 reload.`
    )
    console.log('[warmlow-stops] ALERT sent — a stop is breached')
  }

  await closeClient()
  process.exit(0) // explicit exit — telegram/redis handles can keep the loop alive
}

main().catch(async (e) => {
  console.error('[warmlow-stops] error:', e)
  await closeClient()
  process.exit(1)
})
