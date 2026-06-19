/**
 * Atm OFFENSE thesis — SKIPPED closer-in bracket synthetic backtest (read-only).
 *
 * The decisive test (per the 2026-06-19 reviews): the offense move is selling
 * cold-side brackets CLOSER-IN than the live ≥6°F / 5–15¢ gate — brackets we
 * currently SKIP. Those are out-of-sample in tail_sell_signals, but fully
 * reconstructable from kalshi_market_snapshots (per-bracket price/bounds over
 * time) + the settled winner + OM near-peak UV.
 *
 * DEFINITION (user-set 2026-06-19): candidate = a cold-side HIGH bracket priced
 * 15–30¢ YES at entry (above the live TAIL_YES_MAX=0.15, i.e. closer-in), sold
 * YES at the entry snapshot (~earliest available ≈ tail-sell entry lead).
 *   cold-side = bracket entirely at/below the modal (max-yesPrice) bracket's floor.
 *   win (sell YES) ⇔ candidate is NOT the settled winning bracket.
 *   fee-net pnl/contract = win ? price*(1-0.10) : -(1-price)   [booked convention]
 *   reported at MID (yesPrice) and at conservative BID (yesBid, the real sell fill).
 *
 * Then: does synthetic fee-net P&L rise with UV, and where (price sub-band, city)
 * is it most profitable? Clustered bootstrap by EVENT (candidates within an event
 * share a winner → correlated). GROUNDED: report n per cell, flag multiple-
 * comparison / overfit risk, mid-vs-bid slippage sensitivity.
 *
 * Usage: npx tsx --tsconfig tsconfig.json scripts/atm-offense-skipped-brackets.ts
 */
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config()

import { getDb, closeClient } from '../src/lib/db/mongodb'
import { CITY_COORDS } from '../src/lib/utils/cityCoordinates'

const ATM_EPOCH = Date.parse('2026-05-03T00:00:00Z')
const FEE = 0.10
const BAND_LO = 0.15, BAND_HI = 0.30   // closer-in price band (above live TAIL_YES_MAX)
const B = 5000

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN)
function pctile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN
  const i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i)
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo)
}
function slope(x: number[], y: number[]): number {
  const mx = mean(x), my = mean(y); let sxy = 0, sxx = 0
  for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2 }
  return sxx === 0 ? NaN : sxy / sxx
}
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
function localYmd(dateStr: string): string {
  // resolutionDate is 'YYYY-MM-DD'
  return dateStr.replace(/-/g, '')
}
function cityAliases(code: string): string[] {
  const self = CITY_COORDS[code]; if (!self) return [code]
  const out = new Set([code]); for (const [k, v] of Object.entries(CITY_COORDS)) if (v.name === self.name) out.add(k)
  return [...out]
}

interface Cand { uv: number; price: number; bid: number; pnlMid: number; pnlBid: number; win: boolean; event: string; city: string }

/** clustered (by event) bootstrap of a scalar stat */
function boot(cands: Cand[], stat: (c: Cand[]) => number): { est: number; ci: [number, number]; pLE0: number } {
  const cl = new Map<string, Cand[]>()
  for (const c of cands) { const a = cl.get(c.event) ?? []; a.push(c); cl.set(c.event, a) }
  const keys = [...cl.keys()], rnd = mulberry32(0xC0FFEE), vals: number[] = []
  for (let b = 0; b < B; b++) {
    const s: Cand[] = []
    for (let i = 0; i < keys.length; i++) s.push(...cl.get(keys[Math.floor(rnd() * keys.length)])!)
    const v = stat(s); if (Number.isFinite(v)) vals.push(v)
  }
  vals.sort((a, b) => a - b)
  return { est: stat(cands), ci: [pctile(vals, 0.025), pctile(vals, 0.975)], pLE0: vals.filter(v => v <= 0).length / vals.length }
}

async function main(): Promise<void> {
  const db = getDb()
  const snapCol = db.collection<any>('kalshi_market_snapshots')
  const predCol = db.collection<any>('source_prediction_snapshots')

  // UV lookup by signalId
  const uvSnaps = await predCol.find(
    { timestamp: { $gte: ATM_EPOCH }, 'perSourceAtmosphere.Open-Meteo.uvIndex': { $exists: true } },
    { projection: { signalId: 1, perSourceAtmosphere: 1 } },
  ).toArray()
  const uvBySig = new Map<string, number>()
  for (const s of uvSnaps) { const uv = num(s?.perSourceAtmosphere?.['Open-Meteo']?.uvIndex); if (s.signalId && uv !== null) uvBySig.set(s.signalId, uv) }

  // Per HIGH event: settled brackets (min lead) + entry brackets (max lead).
  // Reduce in JS (Atlas caps the in-pipeline sort on big bracket arrays).
  const evMap = new Map<string, any>()
  const cursor = snapCol.find(
    { marketType: 'high', snapshotTime: { $gte: ATM_EPOCH } },
    { projection: { eventTicker: 1, cityCode: 1, resolutionDate: 1, hoursToResolution: 1, brackets: 1 } },
  )
  for await (const d of cursor) {
    const k = d.eventTicker
    const e = evMap.get(k)
    if (!e) { evMap.set(k, { _id: k, cityCode: d.cityCode, resolutionDate: d.resolutionDate, settledLead: d.hoursToResolution, settledBrackets: d.brackets, entryLead: d.hoursToResolution, entryBrackets: d.brackets }); continue }
    if (d.hoursToResolution < e.settledLead) { e.settledLead = d.hoursToResolution; e.settledBrackets = d.brackets }
    if (d.hoursToResolution > e.entryLead) { e.entryLead = d.hoursToResolution; e.entryBrackets = d.brackets }
  }
  const events = [...evMap.values()]

  const cands: Cand[] = []
  const entryLeads: number[] = []
  let evUsed = 0, evNoSettle = 0, evNoUv = 0, evNoWinner = 0
  for (const ev of events) {
    if (!(ev.settledLead <= 2)) { evNoSettle++; continue }
    if (!(ev.entryLead >= 18)) { evNoSettle++; continue }
    // winner = settled bracket with max yesPrice (~0.995)
    let winner: any = null
    for (const b of ev.settledBrackets ?? []) { const y = num(b.yesPrice); if (y !== null && (!winner || y > num(winner.yesPrice)!)) winner = b }
    if (!winner || num(winner.yesPrice)! < 0.5) { evNoWinner++; continue }
    // UV for event day
    const ymd = localYmd(ev.resolutionDate)
    let uv: number | undefined
    for (const code of cityAliases(ev.cityCode)) { const h = uvBySig.get(`srv_${code}_${ymd}_high`); if (h !== undefined) { uv = h; break } }
    if (uv === undefined) { evNoUv++; continue }
    // modal (market center) at entry
    let modal: any = null
    for (const b of ev.entryBrackets ?? []) { const y = num(b.yesPrice); if (y !== null && (!modal || y > num(modal.yesPrice)!)) modal = b }
    if (!modal) continue
    const modalLo = num(modal.floorF) ?? (num(modal.capF) ?? -Infinity)
    // candidates: cold-side (entirely at/below modal floor) & price in band
    let took = false
    for (const b of ev.entryBrackets ?? []) {
      const price = num(b.yesPrice), bid = num(b.yesBid)
      if (price === null) continue
      const hi = num(b.capF) ?? Infinity
      const lo = num(b.floorF) ?? -Infinity
      const coldSide = hi <= modalLo && lo < modalLo            // entirely below the modal bracket
      if (!coldSide) continue
      if (price <= BAND_LO || price > BAND_HI) continue          // closer-in 15–30¢ band
      const win = b.ticker !== winner.ticker
      const useBid = bid ?? price
      cands.push({
        uv, price, bid: useBid, win, event: ev._id, city: ev.cityCode,
        pnlMid: win ? price * (1 - FEE) : -(1 - price),
        pnlBid: win ? useBid * (1 - FEE) : -(1 - useBid),
      })
      took = true
    }
    if (took) { evUsed++; entryLeads.push(ev.entryLead) }
  }

  entryLeads.sort((a, b) => a - b)
  console.log('\n==================================================================')
  console.log('  ATM OFFENSE — SKIPPED CLOSER-IN BRACKET BACKTEST (cold/high)')
  console.log(`  Run ${new Date().toISOString().slice(0, 16)} UTC · band ${BAND_LO}–${BAND_HI}¢ · ${B} event-clustered bootstraps`)
  console.log('==================================================================')
  console.log(`HIGH events scanned: ${events.length}  | used: ${evUsed}  (drop: noSettle/lead ${evNoSettle}, noWinner ${evNoWinner}, noUV ${evNoUv})`)
  console.log(`Candidate skipped brackets: ${cands.length}  | entry lead h: p50=${pctile(entryLeads, .5)?.toFixed(0)} (real tail-sell ~45h)`)
  if (cands.length < 30) { console.log('  too few candidates; abort'); await closeClient(); return }

  const winRate = cands.filter(c => c.win).length / cands.length
  const med = pctile(cands.map(c => c.uv).slice().sort((a, b) => a - b), 0.5)
  const loArm = cands.filter(c => c.uv < med), hiArm = cands.filter(c => c.uv >= med)

  // (1) Is selling these closer-in brackets even profitable at all?
  const ovMid = boot(cands, c => mean(c.map(x => x.pnlMid)))
  const ovBid = boot(cands, c => mean(c.map(x => x.pnlBid)))
  console.log(`\n(1) Profitability of the closer-in band itself  (win rate ${(100 * winRate).toFixed(1)}%):`)
  console.log(`    fee-net $/contract @ MID: ${ovMid.est >= 0 ? '+' : ''}${ovMid.est.toFixed(4)}  CI [${ovMid.ci[0].toFixed(4)}, ${ovMid.ci[1].toFixed(4)}]  → ${ovMid.pLE0 < 0.05 ? 'POSITIVE' : ovMid.pLE0 > 0.95 ? 'NEGATIVE' : 'indistinct from 0'}`)
  console.log(`    fee-net $/contract @ BID: ${ovBid.est >= 0 ? '+' : ''}${ovBid.est.toFixed(4)}  CI [${ovBid.ci[0].toFixed(4)}, ${ovBid.ci[1].toFixed(4)}]  (conservative real-sell fill)`)

  // (2) Does it rise with UV? (the offense conditioning)
  const slMid = boot(cands, c => slope(c.map(x => x.uv), c.map(x => x.pnlMid)))
  console.log(`\n(2) Synthetic fee-net P&L (MID) vs UV  [thesis: rises with UV]:`)
  console.log(`    low-UV $/contract ${mean(loArm.map(c => c.pnlMid)) >= 0 ? '+' : ''}${mean(loArm.map(c => c.pnlMid)).toFixed(4)} (n=${loArm.length}) | high-UV ${mean(hiArm.map(c => c.pnlMid)) >= 0 ? '+' : ''}${mean(hiArm.map(c => c.pnlMid)).toFixed(4)} (n=${hiArm.length})`)
  console.log(`    slope ${slMid.est >= 0 ? '+' : ''}${slMid.est.toFixed(5)} /UV  CI [${slMid.ci[0].toFixed(5)}, ${slMid.ci[1].toFixed(5)}]  p(slope≤0)=${slMid.pLE0.toFixed(3)}`)

  // (3) PATTERNS — price sub-band × UV (grounded: n shown, exploratory)
  console.log(`\n(3) PATTERNS — fee-net $/contract @ MID by price sub-band × UV  (exploratory; watch n + multiple comparisons):`)
  console.log(`    band      | all (n)            | low-UV (n)         | high-UV (n)`)
  for (const [lab, a, b] of [['15–20¢', 0.15, 0.20], ['20–25¢', 0.20, 0.25], ['25–30¢', 0.25, 0.30]] as const) {
    const sub = cands.filter(c => c.price > a && c.price <= b)
    const sl = sub.filter(c => c.uv < med), sh = sub.filter(c => c.uv >= med)
    const f = (xs: Cand[]) => xs.length ? `${mean(xs.map(c => c.pnlMid)) >= 0 ? '+' : ''}${mean(xs.map(c => c.pnlMid)).toFixed(4)} (${xs.length})` : 'n/a'
    console.log(`    ${lab.padEnd(9)} | ${f(sub).padEnd(18)} | ${f(sl).padEnd(18)} | ${f(sh)}`)
  }

  // (4) PATTERNS — by city (n-gated)
  console.log(`\n(4) PATTERNS — by city (n>=20 only; exploratory, do NOT overfit):`)
  const byCity = new Map<string, Cand[]>()
  for (const c of cands) { const a = byCity.get(c.city) ?? []; a.push(c); byCity.set(c.city, a) }
  const rows = [...byCity.entries()].filter(([, v]) => v.length >= 20).map(([city, v]) => ({ city, n: v.length, pnl: mean(v.map(c => c.pnlMid)) })).sort((a, b) => b.pnl - a.pnl)
  for (const r of rows) console.log(`    ${r.city.padEnd(5)} n=${String(r.n).padStart(4)}  $/contract ${r.pnl >= 0 ? '+' : ''}${r.pnl.toFixed(4)}`)

  console.log(`\n  VERDICT: ${ovMid.pLE0 < 0.05 ? 'closer-in band is net-POSITIVE — ' + (slMid.pLE0 < 0.05 ? 'AND rises with UV → paper-quadrant worthy' : 'but UV conditioning not significant') : 'closer-in band NOT net-positive → no offense edge; demote'}`)
  console.log('  CAVEATS: entry ~40h vs real ~45h; MID fills optimistic (see BID); 6-wk summer-only; multiple comparisons in (3)/(4) — treat patterns as hypotheses, not findings.\n')

  await closeClient()
}

main().catch(async (e) => { console.error(e); await closeClient(); process.exit(1) })
