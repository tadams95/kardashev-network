/**
 * Atm OFFENSE thesis — FEE-NET P&L-per-contract vs UV (read-only).
 *
 * The replacement gate from the 2026-06-19 independent review: the win-rate
 * differential test is statistically unwinnable on horizon AND doesn't grade
 * the offense proposition. The right metric is fee-net P&L per contract: does
 * the strategy's booked $/contract rise with UV?
 *
 * Uses the ALREADY-BOOKED, fee-net per-contract pnl on tail_sell_signals
 * (win = yesPrice*(1-0.10), loss = -(1-yesPrice); DEFAULT_FEE_RATE=0.10 is
 * all-in entry+exit+slippage). Joins OM near-peak uvIndex by city-local event
 * day (same join as atm-edge-existence-test.ts). Clustered bootstrap by
 * city-day. cold/high since atm capture (2026-05-03).
 *
 * Reports, in order of how cleanly each escapes the loss-domination wall:
 *  (1) overall fee-net $/contract  — is the strategy net-positive after fees?
 *  (2) WIN-ONLY premium (yesPrice) vs UV  — the offense "richer premium"
 *      channel, isolated from loss noise; HIGH power (n=wins, continuous).
 *  (3) full fee-net $/contract vs UV  — the headline, but loss-influenced.
 *
 * HONEST CEILING: this still uses TAKEN trades. The actual offense move is
 * brackets we DON'T currently take (closer-in). No taken-trade test can fully
 * answer that — this is the best available proxy + a power-honest read.
 *
 * Usage: npx tsx --tsconfig tsconfig.json scripts/atm-edge-pnl-vs-uv.ts
 */
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config()

import { getDb, closeClient } from '../src/lib/db/mongodb'
import { CITY_COORDS } from '../src/lib/utils/cityCoordinates'

const ATM_EPOCH = Date.parse('2026-05-03T00:00:00Z')
const B = 5000

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

function localYmd(ts: number, tz: string): string | null {
  try {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ts))
    const g = (t: string) => p.find(x => x.type === t)?.value
    const y = g('year'), m = g('month'), d = g('day')
    return y && m && d ? `${y}${m}${d}` : null
  } catch { return null }
}
function cityAliases(code: string): string[] {
  const self = CITY_COORDS[code]; if (!self) return [code]
  const out = new Set([code])
  for (const [k, v] of Object.entries(CITY_COORDS)) if (v.name === self.name) out.add(k)
  return [...out]
}
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length
function slope(x: number[], y: number[]): number {
  const mx = mean(x), my = mean(y); let sxy = 0, sxx = 0
  for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2 }
  return sxx === 0 ? NaN : sxy / sxx
}
function pctile(sorted: number[], q: number): number {
  const i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i)
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo)
}

interface Cell { uv: number; pnl: number; price: number; win: boolean; date: string }

/** clustered bootstrap of a scalar statistic over city-day clusters */
function clusterBoot(cells: Cell[], stat: (c: Cell[]) => number): { ci: [number, number]; pLE0: number } {
  const clusters = new Map<string, Cell[]>()
  for (const c of cells) { const a = clusters.get(c.date) ?? []; a.push(c); clusters.set(c.date, a) }
  const keys = [...clusters.keys()]
  const rnd = mulberry32(0xC0FFEE)
  const vals: number[] = []
  for (let b = 0; b < B; b++) {
    const s: Cell[] = []
    for (let i = 0; i < keys.length; i++) s.push(...clusters.get(keys[Math.floor(rnd() * keys.length)])!)
    const v = stat(s); if (Number.isFinite(v)) vals.push(v)
  }
  vals.sort((a, b) => a - b)
  return { ci: [pctile(vals, 0.025), pctile(vals, 0.975)], pLE0: vals.filter(v => v <= 0).length / vals.length }
}

async function main(): Promise<void> {
  const db = getDb()
  const sigCol = db.collection<any>('tail_sell_signals')
  const snapCol = db.collection<any>('source_prediction_snapshots')

  const trades = await sigCol.find({
    direction: 'cold', temperatureType: 'high',
    result: { $in: ['win', 'loss'] }, timestamp: { $gte: ATM_EPOCH },
  }).toArray()

  const snaps = await snapCol.find(
    { timestamp: { $gte: ATM_EPOCH }, 'perSourceAtmosphere.Open-Meteo.uvIndex': { $exists: true } },
    { projection: { signalId: 1, perSourceAtmosphere: 1 } },
  ).toArray()
  const uvBySignalId = new Map<string, number>()
  for (const s of snaps) { const uv = num(s?.perSourceAtmosphere?.['Open-Meteo']?.uvIndex); if (s.signalId && uv !== null) uvBySignalId.set(s.signalId, uv) }

  const cells: Cell[] = []
  for (const t of trades) {
    const price = num(t.yesPrice), pnl = num(t.pnl)
    if (price === null || pnl === null || pnl === 0) continue // pnl=0 = skipped/no-trade
    const tz = CITY_COORDS[t.cityCode]?.timezone ?? 'America/New_York'
    const tsCand = [num(t.resolvedAt) ? t.resolvedAt : null, num(t.leadHours) ? t.timestamp + t.leadHours * 3600_000 : null, t.timestamp].filter((x): x is number => x !== null)
    let uv: number | undefined, dk: string | undefined
    outer: for (const ts of tsCand) {
      const ymd = localYmd(ts, tz); if (!ymd) continue
      for (const code of cityAliases(t.cityCode)) { const h = uvBySignalId.get(`srv_${code}_${ymd}_high`); if (h !== undefined) { uv = h; dk = ymd; break outer } }
    }
    if (uv === undefined || !dk) continue
    cells.push({ uv, pnl, price, win: t.result === 'win', date: `${t.cityCode}|${dk}` })
  }

  console.log('\n=============================================================')
  console.log('  ATM FEE-NET P&L-PER-CONTRACT vs UV — cold/high since 2026-05-03')
  console.log(`  Run: ${new Date().toISOString().slice(0, 16)} UTC  ·  ${B} clustered bootstraps`)
  console.log('=============================================================')
  console.log(`Joined trades (booked pnl, fee-net): ${cells.length}`)
  if (cells.length < 20) { console.log('  too few; abort'); await closeClient(); return }

  const med = pctile(cells.map(c => c.uv).slice().sort((a, b) => a - b), 0.5)
  const lo = cells.filter(c => c.uv < med), hi = cells.filter(c => c.uv >= med)
  const wins = cells.filter(c => c.win)

  // (1) overall net-positive?
  const ov = clusterBoot(cells, c => mean(c.map(x => x.pnl)))
  console.log(`\n(1) Overall fee-net $/contract: ${mean(cells.map(c => c.pnl)) >= 0 ? '+' : ''}${mean(cells.map(c => c.pnl)).toFixed(4)}  CI [${ov.ci[0].toFixed(4)}, ${ov.ci[1].toFixed(4)}]  → strategy ${ov.pLE0 < 0.05 ? 'net-POSITIVE after fees' : 'not clearly >0'}`)

  // (2) win-only premium vs UV (the offense "richer premium" channel, loss-free)
  const wSlope = slope(wins.map(c => c.uv), wins.map(c => c.price))
  const wBoot = clusterBoot(wins, c => slope(c.map(x => x.uv), c.map(x => x.price)))
  console.log(`\n(2) WIN-ONLY premium (yesPrice) vs UV  [n=${wins.length} wins — the high-power channel]`)
  console.log(`    mean premium: low-UV ${mean(lo.filter(c => c.win).map(c => c.price)).toFixed(4)}  high-UV ${mean(hi.filter(c => c.win).map(c => c.price)).toFixed(4)}`)
  console.log(`    slope = ${wSlope >= 0 ? '+' : ''}${wSlope.toFixed(5)} /UV  CI [${wBoot.ci[0].toFixed(5)}, ${wBoot.ci[1].toFixed(5)}]  p(slope≤0)=${wBoot.pLE0.toFixed(3)}`)
  console.log(`    → do we currently capture richer premium on sunny days? ${wBoot.pLE0 < 0.05 ? 'YES (sig)' : 'NO — flat (offense premium channel absent in taken trades)'}`)

  // (3) full fee-net $/contract vs UV (headline; loss-influenced)
  const pSlope = slope(cells.map(c => c.uv), cells.map(c => c.pnl))
  const pBoot = clusterBoot(cells, c => slope(c.map(x => x.uv), c.map(x => x.pnl)))
  console.log(`\n(3) FULL fee-net $/contract vs UV  [loss-influenced]`)
  console.log(`    mean $/contract: low-UV ${mean(lo.map(c => c.pnl)) >= 0 ? '+' : ''}${mean(lo.map(c => c.pnl)).toFixed(4)}  high-UV ${mean(hi.map(c => c.pnl)) >= 0 ? '+' : ''}${mean(hi.map(c => c.pnl)).toFixed(4)}  (diff ${(mean(hi.map(c => c.pnl)) - mean(lo.map(c => c.pnl))).toFixed(4)})`)
  console.log(`    slope = ${pSlope >= 0 ? '+' : ''}${pSlope.toFixed(5)} /UV  CI [${pBoot.ci[0].toFixed(5)}, ${pBoot.ci[1].toFixed(5)}]  p(slope≤0)=${pBoot.pLE0.toFixed(3)}`)

  const verdict = wBoot.pLE0 < 0.05 || pBoot.pLE0 < 0.05
  console.log(`\n  VERDICT: ${verdict ? 'a fee-net P&L channel rises with UV (p<0.05) — worth the emission-time build' : 'NO fee-net P&L channel rises with UV — principled DEMOTE to passive (offense has no measurable economic edge in existing data)'}`)
  console.log('  CEILING: taken trades only; the true offense (closer-in brackets we skip) is out-of-sample.\n')

  await closeClient()
}

main().catch(async (e) => { console.error(e); await closeClient(); process.exit(1) })
