// Execute tail sell signals on Kalshi — places buy-NO limit orders
// for pending tail sell signals that haven't been executed yet.
//
// Usage:
//   npx tsx scripts/execute-tail-sells.ts          # execute pending signals
//   npx tsx scripts/execute-tail-sells.ts --check   # preview only (no orders)
//
// Requires API_KEY_ID and KALSHI_PRIVATE_KEY in .env.local

import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import type { Collection } from 'mongodb'
import { getDb, closeClient } from '../src/lib/db/mongodb'
import type { TailSellRecord } from '../src/lib/models/tailSellTracker'

// ============================================================================
// Env Loading (handles multi-line PEM keys that dotenv mangles)
// ============================================================================

function loadEnvFile() {
  try {
    const envPath = path.join(__dirname, '../.env.local')
    const envContent = fs.readFileSync(envPath, 'utf-8')
    const lines = envContent.split('\n')

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim()
      if (!trimmed || trimmed.startsWith('#')) continue

      const match = trimmed.match(/^([^=]+)=(.*)$/)
      if (!match) continue

      const key = match[1].trim()
      let value = match[2].trim()

      // Handle multi-line PEM keys with BEGIN/END markers
      if (value.includes('BEGIN')) {
        let fullValue = value
        i++
        while (i < lines.length && !lines[i].includes('END')) {
          fullValue += '\n' + lines[i]
          i++
        }
        if (i < lines.length) fullValue += '\n' + lines[i]
        value = fullValue
      }
      // Handle raw base64 multi-line keys (no PEM headers, e.g. KALSHI_PRIVATE_KEY)
      else if (/^[A-Za-z0-9+/]/.test(value) && key.includes('PRIVATE_KEY')) {
        let fullValue = value
        while (i + 1 < lines.length) {
          const nextLine = lines[i + 1].trim()
          // Stop if we hit a blank line, comment, or new env var
          if (!nextLine || nextLine.startsWith('#') || /^[A-Z_]+=/.test(nextLine)) break
          fullValue += nextLine
          i++
        }
        // Wrap in PEM headers for Node crypto
        value = '-----BEGIN RSA PRIVATE KEY-----\n' +
          fullValue.match(/.{1,64}/g)!.join('\n') +
          '\n-----END RSA PRIVATE KEY-----'
      }

      process.env[key] = value
    }
  } catch {
    console.warn('[execute] Warning: Could not load .env.local')
  }
}

loadEnvFile()

// ============================================================================
// Constants
// ============================================================================

const KALSHI_API_BASE = 'https://api.elections.kalshi.com/trade-api/v2'
const API_KEY_ID = process.env.API_KEY_ID || ''
const KALSHI_PRIVATE_KEY = process.env.KALSHI_PRIVATE_KEY || ''
const POSITION_SIZE = 20 // $20 per signal — raised from $10 on 2026-04-24 (Trading Readiness 100/100)
const FETCH_TIMEOUT = 15_000
const CHECK_MODE = process.argv.includes('--check')
// --limit N caps how many orders are PLACED this run (closed-market skips don't
// count). Used for a supervised single-order validation of the V2 path.
const LIMIT_IDX = process.argv.indexOf('--limit')
const PLACE_LIMIT = LIMIT_IDX >= 0 ? parseInt(process.argv[LIMIT_IDX + 1], 10) : Infinity

// Hard 2-minute safety timeout
const HARD_TIMEOUT = 2 * 60 * 1000
setTimeout(() => {
  console.error('[execute] Hard timeout (2 min) — aborting')
  process.exit(1)
}, HARD_TIMEOUT).unref()

// ============================================================================
// Kalshi Auth (per-request RSA signature)
// ============================================================================

function signRequest(timestamp: string, method: string, fullPath: string): string {
  // Kalshi expects: timestamp_ms + METHOD + full_path, signed with RSA-PSS + SHA256
  const message = timestamp + method.toUpperCase() + fullPath
  const privateKey = crypto.createPrivateKey(KALSHI_PRIVATE_KEY)
  return crypto.sign('sha256', Buffer.from(message), {
    key: privateKey,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,  // 32 bytes for SHA256
  }).toString('base64')
}

function makeAuthHeaders(method: string, apiPath: string): Record<string, string> {
  const timestamp = Date.now().toString()
  // Kalshi signs the path WITHOUT the query string (cursor/limit/status params).
  const fullPath = '/trade-api/v2' + apiPath.split('?')[0]
  return {
    'KALSHI-ACCESS-KEY': API_KEY_ID,
    'KALSHI-ACCESS-SIGNATURE': signRequest(timestamp, method, fullPath),
    'KALSHI-ACCESS-TIMESTAMP': timestamp,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  }
}

// ============================================================================
// Kalshi API Helpers
// ============================================================================

async function kalshiFetch(
  method: string,
  apiPath: string,
  body?: Record<string, unknown>,
): Promise<any> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT)

  try {
    const opts: RequestInit = {
      method,
      headers: makeAuthHeaders(method, apiPath),
      signal: controller.signal,
    }
    if (body) opts.body = JSON.stringify(body)

    const response = await fetch(`${KALSHI_API_BASE}${apiPath}`, opts)

    if (!response.ok) {
      const errText = await response.text()
      throw new Error(`${method} ${apiPath}: ${response.status} — ${errText}`)
    }

    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

async function getBalance(): Promise<{ balance: number; portfolioValue: number }> {
  const data = await kalshiFetch('GET', '/portfolio/balance')
  return {
    balance: (data.balance ?? 0) / 100,
    portfolioValue: (data.portfolio_value ?? 0) / 100,
  }
}

interface OrderResult {
  orderId: string
  status: string
  side: string
  action: string
  count: number
}

async function placeOrder(
  ticker: string,
  count: number,
  noPriceCents: number,
  clientOrderId: string,
): Promise<OrderResult> {
  // V2 create-order. The v1 `POST /portfolio/orders` was deprecated server-side
  // (HTTP 410 `deprecated_v1_order_endpoint`, cutover ~2026-06-19). V2 uses a
  // single YES-book model: side='bid' buys YES, side='ask' SELLS YES. Our
  // tail-sell sells the YES leg, so side='ask' with `price` = the YES limit in
  // fixed-point dollars. Selling YES at (100−noPriceCents)¢ is economically the
  // SAME position+limit as the old "buy NO @ noPriceCents¢". count/price are
  // STRINGS; time_in_force GTC preserves the old resting-limit behaviour.
  const yesPriceCents = 100 - noPriceCents
  const data = await kalshiFetch('POST', '/portfolio/events/orders', {
    ticker,
    client_order_id: clientOrderId,
    side: 'ask',                                   // sell YES = take the NO position
    count: count.toFixed(2),                       // e.g. "10.00"
    price: (yesPriceCents / 100).toFixed(4),       // YES limit in dollars, e.g. "0.0800"
    time_in_force: 'good_till_canceled',
    self_trade_prevention_type: 'taker_at_cross',
    // Rest-only: if the market has moved through our signal price (stale signal),
    // REJECT rather than cross the spread and chase a now-likely bracket. This
    // is the intended tail-sell behaviour — collect premium passively, never
    // take a bad fill on a moved market (see the 2026-06-19 stale-fill incident).
    post_only: true,
  })

  const order = data.order || data
  return {
    orderId: order.order_id || order.id || '',
    status: order.status || 'unknown',
    side: order.side || 'ask',
    action: 'sell',
    count: order.count != null ? Number(order.count) : count,
  }
}

async function getMarketInfo(
  ticker: string,
): Promise<{ status: string; yesPrice: number | null; result: string }> {
  try {
    const data = await kalshiFetch('GET', `/markets/${ticker}`)
    const market = data.market || data
    return {
      status: market.status || 'unknown',
      yesPrice: market.last_price != null ? market.last_price / 100 : null,
      result: market.result || '',
    }
  } catch {
    return { status: 'unknown', yesPrice: null, result: '' }
  }
}

// ============================================================================
// Main
// ============================================================================

async function getAllFills(): Promise<any[]> {
  const out: any[] = []
  let cursor = ''
  for (let i = 0; i < 60; i++) {
    const data = await kalshiFetch('GET', `/portfolio/fills?limit=200${cursor ? `&cursor=${cursor}` : ''}`)
    const arr = data.fills ?? []
    out.push(...arr)
    cursor = data.cursor || ''
    if (!cursor || arr.length === 0) break
  }
  return out
}

/**
 * Reconcile booked fills against reality. Live tail-sell limit orders are
 * MAKERS — most rest and never fill — so booking P&L from yesPrice for any
 * order with a kalshiOrderId overstates P&L (audit 2026-06-19: ~71% of booked
 * profit was phantom). This backfills filledCount / avgFillYesPrice / filled
 * on live signals carrying a real Kalshi order id, so resolveTailSellSignals()
 * books $0 for unfilled orders. Idempotent; never places orders; fail-soft.
 */
async function reconcileFills(col: Collection<TailSellRecord>): Promise<void> {
  const targets = (await col.find({ mode: { $ne: 'paper' } } as any).toArray())
    .filter((s: any) => s.kalshiOrderId && s.kalshiOrderId !== 'skipped_market_closed')
  if (targets.length === 0) return

  let fills: any[]
  try { fills = await getAllFills() } catch (e) {
    console.warn('[execute] fill reconcile skipped:', e instanceof Error ? e.message : e)
    return
  }

  // Kalshi fills use fixed-point STRING fields: count_fp ("20.00") and
  // yes_price_dollars ("0.0500") — NOT count / yes_price.
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

  let updated = 0
  for (const s of targets as any[]) {
    const g = byOrder.get(s.kalshiOrderId)
    const filledCount = g?.count ?? 0
    const set: any = { filledCount, filled: filledCount > 0 }
    if (filledCount > 0 && g!.yesCost > 0) {
      set.avgFillYesPrice = Math.max(0, Math.min(1, g!.yesCost / filledCount))
    }
    if (s.filledCount !== filledCount || s.avgFillYesPrice !== set.avgFillYesPrice) {
      await col.updateOne({ id: s.id }, { $set: set })
      updated++
    }
  }
  if (updated > 0) console.log(`[execute] reconciled fills on ${updated}/${targets.length} live signal(s)`)
}

async function main(): Promise<void> {
  console.log(`[execute] Tail sell order execution${CHECK_MODE ? ' (CHECK MODE — no orders)' : ''}`)
  console.log('─'.repeat(60))

  if (!API_KEY_ID || !KALSHI_PRIVATE_KEY) {
    console.error('[execute] Missing API_KEY_ID or KALSHI_PRIVATE_KEY in .env.local')
    process.exit(1)
  }

  // 1. Verify auth by checking balance
  console.log('[execute] Checking Kalshi balance...')
  const { balance, portfolioValue } = await getBalance()
  console.log(`[execute] Balance: $${balance.toFixed(2)} | Portfolio: $${portfolioValue.toFixed(2)}`)

  // 2. Get pending tail sell signals that haven't been executed
  const db = getDb()
  const col = db.collection<TailSellRecord>('tail_sell_signals')

  // Reconcile actual fills before anything else, so resolution books real P&L
  // (not phantom premium on unfilled maker orders). Fail-soft, never blocks.
  if (!CHECK_MODE) {
    try { await reconcileFills(col) } catch (e) { console.warn('[execute] reconcile error:', e instanceof Error ? e.message : e) }
  }

  const pending = await col
    .find({
      result: 'pending',
      kalshiOrderId: { $exists: false },  // not yet executed
      mode: { $ne: 'paper' },             // skip warm-tail paper-mode records
    })
    .sort({ timestamp: 1 })
    .toArray()

  if (pending.length === 0) {
    console.log('[execute] No unexecuted pending signals — nothing to do')
    return
  }

  console.log(`[execute] Found ${pending.length} unexecuted pending signal(s)`)
  console.log('')

  // 3. Preview / execute each signal
  let executed = 0
  let failed = 0
  let skipped = 0
  let totalCost = 0

  for (const signal of pending) {
    if (executed >= PLACE_LIMIT) {
      console.log(`[execute] reached --limit ${PLACE_LIMIT} placed order(s) — stopping`)
      break
    }
    const noPriceCents = Math.round((1 - signal.yesPrice) * 100)
    const noPriceDollars = noPriceCents / 100
    const count = Math.floor(POSITION_SIZE / noPriceDollars)
    const cost = count * noPriceDollars

    if (count < 1) {
      console.log(`  SKIP ${signal.ticker} — contract count=0 (noPrice=${noPriceCents}¢)`)
      skipped++
      continue
    }

    // Check if market is still active
    const market = await getMarketInfo(signal.ticker)
    if (market.status !== 'active' && market.status !== 'open') {
      console.log(`  SKIP ${signal.ticker} — market status: ${market.status}${market.result ? ` (${market.result})` : ''}`)

      // Mark as skipped so we don't retry (set kalshiOrderId sentinel to exit unexecuted query)
      if (!CHECK_MODE) {
        await col.updateOne(
          { id: signal.id },
          { $set: { kalshiOrderId: 'skipped_market_closed', orderStatus: 'market_closed' as any, orderPlacedAt: Date.now() } as any },
        )
      }
      skipped++
      continue
    }

    const currentYes = market.yesPrice != null ? `${(market.yesPrice * 100).toFixed(0)}¢` : '?'
    console.log(
      `  ${CHECK_MODE ? 'WOULD' : 'PLACING'}: BUY ${count} NO @ ${noPriceCents}¢ on ${signal.ticker}` +
      ` | ${signal.cityCode} ±${signal.bracketDistance} | signal YES=${(signal.yesPrice * 100).toFixed(0)}¢ current=${currentYes}` +
      ` | cost=$${cost.toFixed(2)}`
    )

    if (CHECK_MODE) {
      totalCost += cost
      executed++
      continue
    }

    // Check balance
    if (cost > balance - totalCost) {
      console.log(`  SKIP — insufficient balance ($${(balance - totalCost).toFixed(2)} remaining)`)
      skipped++
      continue
    }

    const clientOrderId = `ts_${signal.id}`

    try {
      const result = await placeOrder(signal.ticker, count, noPriceCents, clientOrderId)

      // Update signal with execution info
      await col.updateOne(
        { id: signal.id },
        {
          $set: {
            kalshiOrderId: result.orderId,
            orderStatus: result.status,
            orderPlacedAt: Date.now(),
            contractCount: count,
            clientOrderId,
          } as any,
        },
      )

      console.log(`    → Order ${result.orderId} — ${result.status}`)
      totalCost += cost
      executed++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`    ✗ Failed: ${msg}`)

      // Mark as failed
      await col.updateOne(
        { id: signal.id },
        { $set: { orderStatus: 'failed', orderPlacedAt: Date.now() } as any },
      )
      failed++
    }

    // Rate limit between orders
    await new Promise(r => setTimeout(r, 250))
  }

  // 4. Summary
  console.log('')
  console.log('─'.repeat(60))
  console.log(`[execute] ${CHECK_MODE ? 'Preview' : 'Done'}:`)
  console.log(`  ${CHECK_MODE ? 'Would execute' : 'Executed'}: ${executed}`)
  if (failed > 0) console.log(`  Failed: ${failed}`)
  if (skipped > 0) console.log(`  Skipped: ${skipped}`)
  console.log(`  ${CHECK_MODE ? 'Estimated' : 'Total'} cost: $${totalCost.toFixed(2)}`)
  console.log(`  Balance: $${balance.toFixed(2)}`)
}

// ============================================================================
// Entry Point
// ============================================================================

main()
  .then(() => closeClient())
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[execute] Fatal:', error)
    closeClient().finally(() => process.exit(1))
  })
