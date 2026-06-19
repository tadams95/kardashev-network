/**
 * One-time backfill: correct historical tail-sell P&L for actual fills.
 *
 * Resolved LIVE signals were booked at full premium for any order with a
 * kalshiOrderId, regardless of whether the maker limit order filled (audit
 * 2026-06-19: ~71% phantom). This reconciles against Kalshi /portfolio/fills
 * and rewrites filledCount / avgFillYesPrice / filled / pnl on resolved live
 * signals: pnl=0 when nothing filled, else the booking formula on the actual
 * fill price. Idempotent. Read-only on Kalshi; writes only tail_sell_signals.
 *
 * Logs every change (old→new) for auditability/reversibility, plus the total
 * booked-vs-real delta. Use --dry to preview without writing.
 *
 * Usage: npx tsx --tsconfig tsconfig.json scripts/backfill-tail-sell-pnl.ts [--dry]
 */
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config()
import crypto from 'crypto'
import fs from 'fs'
import { getDb, closeClient } from '../src/lib/db/mongodb'
import { DEFAULT_FEE_RATE } from '../src/lib/models/weatherProbability'

const DRY = process.argv.includes('--dry')
const BASE = 'https://api.elections.kalshi.com/trade-api/v2'
const API_KEY_ID = process.env.API_KEY_ID || ''

function loadPrivateKey(): crypto.KeyObject {
  const env = (process.env.KALSHI_PRIVATE_KEY || '').replace(/\\n/g, '\n')
  if (env.length > 200 && env.includes('BEGIN')) return crypto.createPrivateKey(env)
  const lines = fs.readFileSync('.env.local', 'utf8').split('\n')
  const start = lines.findIndex(l => l.startsWith('KALSHI_PRIVATE_KEY='))
  if (start < 0) throw new Error('KALSHI_PRIVATE_KEY not found')
  const body = [lines[start].slice('KALSHI_PRIVATE_KEY='.length)]
  for (let i = start + 1; i < lines.length; i++) { if (/^[A-Z][A-Z0-9_]*=/.test(lines[i])) break; body.push(lines[i]) }
  const b64 = body.join('').replace(/[^A-Za-z0-9+/=]/g, '')
  return crypto.createPrivateKey({ key: Buffer.from(b64, 'base64'), format: 'der', type: 'pkcs1' })
}
const PRIV = loadPrivateKey()

async function kget(apiPath: string): Promise<any> {
  const ts = Date.now().toString()
  const sig = crypto.sign('sha256', Buffer.from(ts + 'GET' + '/trade-api/v2' + apiPath.split('?')[0]), {
    key: PRIV, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
  }).toString('base64')
  const r = await fetch(`${BASE}${apiPath}`, { method: 'GET', headers: { 'KALSHI-ACCESS-KEY': API_KEY_ID, 'KALSHI-ACCESS-SIGNATURE': sig, 'KALSHI-ACCESS-TIMESTAMP': ts, 'Accept': 'application/json' } })
  if (!r.ok) throw new Error(`GET ${apiPath}: ${r.status} — ${await r.text()}`)
  return r.json()
}
async function allFills(): Promise<any[]> {
  const out: any[] = []; let cursor = ''
  for (let i = 0; i < 60; i++) {
    const d = await kget(`/portfolio/fills?limit=200${cursor ? `&cursor=${cursor}` : ''}`)
    const arr = d.fills ?? []; out.push(...arr); cursor = d.cursor || ''
    if (!cursor || arr.length === 0) break
  }
  return out
}

async function main(): Promise<void> {
  const db = getDb()
  const col = db.collection<any>('tail_sell_signals')

  const resolvedLive = await col.find({
    mode: { $ne: 'paper' }, result: { $in: ['win', 'loss'] },
  }).toArray()
  const targets = resolvedLive.filter((s: any) => s.kalshiOrderId && s.kalshiOrderId !== 'skipped_market_closed')

  const fills = await allFills()
  // Kalshi fills use fixed-point STRING fields: count_fp / yes_price_dollars.
  const byOrder = new Map<string, { count: number; yesCost: number }>()
  for (const f of fills) {
    if (!f.order_id) continue
    const cnt = parseFloat(f.count_fp) || 0
    const yes = parseFloat(f.yes_price_dollars)
    const g = byOrder.get(f.order_id) ?? { count: 0, yesCost: 0 }
    g.count += cnt
    if (Number.isFinite(yes)) g.yesCost += yes * cnt
    byOrder.set(f.order_id, g)
  }

  let oldTotal = 0, newTotal = 0, zeroed = 0, changed = 0
  const sample: string[] = []
  for (const s of targets as any[]) {
    const g = byOrder.get(s.kalshiOrderId)
    const filledCount = g?.count ?? 0
    let avgFillYesPrice: number | undefined
    if (filledCount > 0 && g!.yesCost > 0) avgFillYesPrice = Math.max(0, Math.min(1, g!.yesCost / filledCount))
    const effYes = avgFillYesPrice ?? s.yesPrice
    const newPnl = filledCount > 0
      ? (s.result === 'loss' ? -(1 - effYes) : effYes * (1 - DEFAULT_FEE_RATE))
      : 0
    const oldPnl = typeof s.pnl === 'number' ? s.pnl : 0
    oldTotal += oldPnl; newTotal += newPnl
    if (Math.abs(newPnl - oldPnl) > 1e-9) {
      changed++
      if (filledCount === 0) zeroed++
      if (sample.length < 8) sample.push(`  ${s.ticker.padEnd(26)} filled=${filledCount}  pnl ${oldPnl >= 0 ? '+' : ''}${oldPnl.toFixed(3)} → ${newPnl >= 0 ? '+' : ''}${newPnl.toFixed(3)}`)
    }
    // Always persist fill status (filledCount/filled/avgFillYesPrice) + corrected
    // pnl on every target, so the data is complete even where pnl was unchanged.
    if (!DRY) {
      const set: any = { filledCount, filled: filledCount > 0, pnl: newPnl }
      if (avgFillYesPrice !== undefined) set.avgFillYesPrice = avgFillYesPrice
      await col.updateOne({ id: s.id }, { $set: set })
    }
  }

  console.log(`\n=== BACKFILL tail-sell P&L for actual fills ${DRY ? '(DRY RUN — no writes)' : '(WRITING)'} ===`)
  console.log(`resolved live signals w/ real order: ${targets.length}  | account fills pulled: ${fills.length}`)
  console.log(`changed: ${changed}  (of which zeroed/unfilled: ${zeroed})`)
  console.log('sample changes:'); sample.forEach(l => console.log(l))
  console.log(`\nTOTAL booked P&L (old): $${oldTotal.toFixed(2)}`)
  console.log(`TOTAL real P&L  (new): $${newTotal.toFixed(2)}`)
  console.log(`phantom removed:       $${(oldTotal - newTotal).toFixed(2)}`)
  console.log(DRY ? '\n(DRY — re-run without --dry to apply)\n' : '\n(applied)\n')
  await closeClient()
}
main().catch(async (e) => { console.error(e); await closeClient(); process.exit(1) })
