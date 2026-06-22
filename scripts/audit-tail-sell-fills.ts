/**
 * Tail-sell LIVE fill audit + system health (READ-ONLY — only GET calls).
 *
 * Answers two questions:
 *  1) Is the booked live P&L real? tailSellTracker books pnl from yesPrice for any
 *     order with a kalshiOrderId, with NO fill reconciliation. This pulls the
 *     ground truth from Kalshi /portfolio/fills and compares booked vs filled.
 *  2) Is the system working right now? Reports balance, open positions, resting
 *     orders, and the recent order-status breakdown (incl. recent failures).
 *
 * Usage: npx tsx --tsconfig tsconfig.json scripts/audit-tail-sell-fills.ts
 */
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config()
import crypto from 'crypto'
import fs from 'fs'
import { getDb, closeClient } from '../src/lib/db/mongodb'

const BASE = 'https://api.elections.kalshi.com/trade-api/v2'
const API_KEY_ID = process.env.API_KEY_ID || ''

/** dotenv truncates the unquoted multi-line PEM to its first line; recover the
 *  full PKCS#1 key block from .env.local and load it as DER. */
function loadPrivateKey(): crypto.KeyObject {
  const env = (process.env.KALSHI_PRIVATE_KEY || '').replace(/\\n/g, '\n')
  if (env.length > 200 && env.includes('BEGIN')) return crypto.createPrivateKey(env)
  const lines = fs.readFileSync('.env.local', 'utf8').split('\n')
  const start = lines.findIndex(l => l.startsWith('KALSHI_PRIVATE_KEY='))
  if (start < 0) throw new Error('KALSHI_PRIVATE_KEY not found in .env.local')
  const body: string[] = [lines[start].slice('KALSHI_PRIVATE_KEY='.length)]
  for (let i = start + 1; i < lines.length; i++) {
    if (/^[A-Z][A-Z0-9_]*=/.test(lines[i])) break
    body.push(lines[i])
  }
  const b64 = body.join('').replace(/[^A-Za-z0-9+/=]/g, '')
  return crypto.createPrivateKey({ key: Buffer.from(b64, 'base64'), format: 'der', type: 'pkcs1' })
}
const PRIV = loadPrivateKey()

function authHeaders(method: string, apiPath: string): Record<string, string> {
  const ts = Date.now().toString()
  // Kalshi signs the path WITHOUT the query string.
  const pathNoQuery = apiPath.split('?')[0]
  const msg = ts + method.toUpperCase() + '/trade-api/v2' + pathNoQuery
  const sig = crypto.sign('sha256', Buffer.from(msg), {
    key: PRIV,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
  }).toString('base64')
  return { 'KALSHI-ACCESS-KEY': API_KEY_ID, 'KALSHI-ACCESS-SIGNATURE': sig, 'KALSHI-ACCESS-TIMESTAMP': ts, 'Accept': 'application/json' }
}
async function kget(apiPath: string): Promise<any> {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 20000)
  try {
    const r = await fetch(`${BASE}${apiPath}`, { method: 'GET', headers: authHeaders('GET', apiPath), signal: ctl.signal })
    if (!r.ok) throw new Error(`GET ${apiPath}: ${r.status} — ${await r.text()}`)
    return await r.json()
  } finally { clearTimeout(t) }
}
async function paginate(path: string, key: string, cap = 60): Promise<any[]> {
  const out: any[] = []; let cursor = ''
  for (let i = 0; i < cap; i++) {
    const sep = path.includes('?') ? '&' : '?'
    const data = await kget(`${path}${cursor ? `${sep}cursor=${cursor}` : ''}`)
    const arr = data[key] ?? []
    out.push(...arr)
    cursor = data.cursor || ''
    if (!cursor || arr.length === 0) break
  }
  return out
}

async function main(): Promise<void> {
  if (!API_KEY_ID || !PRIV) { console.error('Missing API_KEY_ID / KALSHI_PRIVATE_KEY'); process.exit(1) }
  const db = getDb()
  const col = db.collection<any>('tail_sell_signals')

  // ---- live Kalshi state ----
  const bal = await kget('/portfolio/balance')
  const positions = (await paginate('/portfolio/positions', 'market_positions')).filter((p: any) => (p.position ?? 0) !== 0)
  const resting = await paginate('/portfolio/orders?status=resting', 'orders')
  const fills = await paginate('/portfolio/fills?limit=200', 'fills')

  console.log('\n================= SYSTEM HEALTH (live Kalshi) =================')
  const cash = (bal.balance ?? 0) / 100
  const tiedUp = (bal.portfolio_value ?? 0) / 100
  console.log(`balance (free cash): $${cash.toFixed(2)}  |  portfolio_value (tied up): $${tiedUp.toFixed(2)}  |  total equity: $${(cash + tiedUp).toFixed(2)}`)
  console.log(`open positions (nonzero): ${positions.length}`)
  for (const p of positions.slice(0, 10)) console.log(`   ${p.ticker}  pos=${p.position}  expVal=$${((p.market_exposure ?? 0) / 100).toFixed(2)}`)
  console.log(`resting (open) orders: ${resting.length}`)
  // Kalshi order fields are fixed-point strings: *_count_fp ("5.00") and *_price_dollars ("0.1300").
  for (const o of resting.slice(0, 10)) {
    const rem = parseFloat(o.remaining_count_fp ?? '0')
    const init = parseFloat(o.initial_count_fp ?? '0')
    const yesC = Math.round(parseFloat(o.yes_price_dollars ?? '0') * 100)
    const noC = Math.round(parseFloat(o.no_price_dollars ?? '0') * 100)
    console.log(`   ${o.ticker}  ${o.action} ${o.side} ${rem}/${init} @ yes ${yesC}¢ / no ${noC}¢`)
  }
  console.log(`total fills on account (pulled): ${fills.length}`)

  // ---- recent order-status breakdown (Mongo) ----
  const now = Date.now(), d30 = now - 30 * 86400000
  const recent = await col.find({ orderPlacedAt: { $gte: d30 } }).toArray()
  const byStatus = new Map<string, number>()
  for (const r of recent) byStatus.set(r.orderStatus ?? '(none)', (byStatus.get(r.orderStatus ?? '(none)') ?? 0) + 1)
  console.log(`\norder status, last 30d (n=${recent.length}): ${[...byStatus.entries()].map(([k, v]) => `${k}:${v}`).join('  ')}`)
  const failed = recent.filter(r => r.orderStatus === 'failed').sort((a, b) => b.orderPlacedAt - a.orderPlacedAt).slice(0, 6)
  if (failed.length) { console.log('recent FAILED orders:'); for (const f of failed) console.log(`   ${new Date(f.orderPlacedAt).toISOString().slice(0, 16)}  ${f.ticker}  yes=${f.yesPrice} count=${f.contractCount ?? '?'}`) }

  // ---- FILL AUDIT: booked vs actually-filled ----
  const live = await col.find({ mode: { $ne: 'paper' } }).toArray()
  // Kalshi fills use fixed-point STRING count_fp ("20.00"), not count.
  const filledCountByOrder = new Map<string, number>()
  for (const f of fills) filledCountByOrder.set(f.order_id, (filledCountByOrder.get(f.order_id) ?? 0) + (parseFloat(f.count_fp) || 0))
  const filledTickers = new Set(fills.map((f: any) => f.ticker))

  let withRealOrder = 0, matchedByOrderId = 0, matchedByTicker = 0, noFill = 0
  let bookedResolved = 0, bookedOnFilled = 0, bookedOnUnfilled = 0
  for (const s of live) {
    const isReal = s.kalshiOrderId && s.kalshiOrderId !== 'skipped_market_closed'
    if (!isReal) continue
    withRealOrder++
    const filled = filledCountByOrder.has(s.kalshiOrderId) || filledTickers.has(s.ticker)
    if (filledCountByOrder.has(s.kalshiOrderId)) matchedByOrderId++
    else if (filledTickers.has(s.ticker)) matchedByTicker++
    else noFill++
    if (s.result === 'win' || s.result === 'loss') {
      // pnl is stored PER-CONTRACT (win ≈ +yes, loss ≈ -(1-yes)); real dollars = pnl × filledCount.
      const perContract = typeof s.pnl === 'number' ? s.pnl : 0
      const qty = (s.filledCount ?? 0) > 0 ? s.filledCount : (filled ? (s.contractCount ?? 0) : 0)
      const dollars = perContract * qty
      bookedResolved += dollars
      if (filled) bookedOnFilled += dollars; else bookedOnUnfilled += dollars
    }
  }

  console.log('\n================= FILL AUDIT (booked vs real) =================')
  console.log(`live signals w/ a real Kalshi order: ${withRealOrder}`)
  console.log(`  matched to a fill by order_id: ${matchedByOrderId}  | by ticker only: ${matchedByTicker}  | NO fill found: ${noFill}  (${withRealOrder ? (100 * noFill / withRealOrder).toFixed(0) : 0}%)`)
  console.log(`\nreal resolved live P&L (pnl×filledCount): $${bookedResolved.toFixed(2)}`)
  console.log(`  ...on orders WITH a matched fill:   $${bookedOnFilled.toFixed(2)}`)
  console.log(`  ...on orders with NO fill (zeroed):  $${bookedOnUnfilled.toFixed(2)}`)
  console.log('\nNOTE: fill match by order_id is exact; ticker-only is a loose fallback (could be a')
  console.log('different order on the same market). "NO fill found" = booked premium that was likely never earned.')
  console.log('Caveat: Kalshi fills pagination/retention may not reach the oldest orders — check fills count vs order age.\n')

  await closeClient()
}
main().catch(async (e) => { console.error(e); await closeClient(); process.exit(1) })
