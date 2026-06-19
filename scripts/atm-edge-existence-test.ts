/**
 * Atm OFFENSE thesis — "edge = ours − market" EXISTENCE TEST (read-only).
 *
 * Question: among cold/high tail-sell trades, does the strategy beat the
 * market-implied win rate MORE on dry/sunny (high-UV) days than humid/cloudy
 * (low-UV) days? A positive, significant differential = the market underprices
 * cold-tail safety exactly when our near-peak nowcast says it's safest = the
 * offense edge exists. No ingestion change needed — uses data we already store.
 *
 * Per resolved cold/high trade:
 *   market-implied win prob = 1 − tail_sell_signals.yesPrice   (yesPrice is 0–1)
 *   outcome                 = result ∈ {win, loss}
 *   edge surprise           = (win?1:0) − (1 − yesPrice);  mean = excess edge
 *   UV (day label)          = OM near-peak uvIndex, joined via the city-LOCAL
 *                             event day key srv_{cityCode}_{YYYYMMDD}_high
 *                             (matches captureServerSideForecasts; alias fallback)
 *
 * Significance: CLUSTERED bootstrap, clusters = city-local event day (weather
 * is the shared driver across same-day trades, so days are the independent
 * unit, not trades). Reports the high−low excess-edge differential + an OLS
 * slope of edge-surprise on UV, each with a 95% CI and one-sided p.
 *
 * HONEST LIMITS (carry into any decision):
 *  - near-peak UV is LOOK-AHEAD → this is the optimistic UPPER BOUND. A
 *    tradeable rule needs emission-time forecast UV (not yet stored per signal).
 *  - tests TAKEN trades, not the closer-in brackets offense would ADD.
 *
 * Usage: npx tsx --tsconfig tsconfig.json scripts/atm-edge-existence-test.ts
 */
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config()

import { getDb, closeClient } from '../src/lib/db/mongodb'
import { CITY_COORDS } from '../src/lib/utils/cityCoordinates'

const ATM_EPOCH = Date.parse('2026-05-03T00:00:00Z')
const B = 5000 // bootstrap resamples

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

/** city-local YYYYMMDD for a timestamp (matches Intl.DateTimeFormat day bucketing) */
function localYmd(ts: number, tz: string): string | null {
  try {
    const p = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date(ts))
    const g = (t: string) => p.find(x => x.type === t)?.value
    const y = g('year'), m = g('month'), d = g('day')
    return y && m && d ? `${y}${m}${d}` : null
  } catch { return null }
}

/** alias city codes that share the same display name (NY↔NYC, LA↔LAX, …) */
function cityAliases(code: string): string[] {
  const self = CITY_COORDS[code]
  if (!self) return [code]
  const out = new Set([code])
  for (const [k, v] of Object.entries(CITY_COORDS)) if (v.name === self.name) out.add(k)
  return [...out]
}

/** mulberry32 — seeded PRNG so the CI is reproducible run-to-run */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length

/** OLS slope of y on x */
function slope(x: number[], y: number[]): number {
  const mx = mean(x), my = mean(y)
  let sxy = 0, sxx = 0
  for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2 }
  return sxx === 0 ? NaN : sxy / sxx
}

interface Cell { uv: number; surprise: number; date: string }

function pctile(sorted: number[], q: number): number {
  const i = (sorted.length - 1) * q
  const lo = Math.floor(i), hi = Math.ceil(i)
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo)
}

async function main(): Promise<void> {
  const db = getDb()
  const sigCol = db.collection<any>('tail_sell_signals')
  const snapCol = db.collection<any>('source_prediction_snapshots')

  const trades = await sigCol.find({
    direction: 'cold', temperatureType: 'high',
    result: { $in: ['win', 'loss'] },
    timestamp: { $gte: ATM_EPOCH },
  }).toArray()

  const snaps = await snapCol.find(
    { timestamp: { $gte: ATM_EPOCH }, 'perSourceAtmosphere.Open-Meteo.uvIndex': { $exists: true } },
    { projection: { signalId: 1, perSourceAtmosphere: 1 } },
  ).toArray()
  const uvBySignalId = new Map<string, number>()
  for (const s of snaps) {
    const uv = num(s?.perSourceAtmosphere?.['Open-Meteo']?.uvIndex)
    if (s.signalId && uv !== null) uvBySignalId.set(s.signalId, uv)
  }

  const cells: Cell[] = []
  let joined = 0
  const missCity = new Map<string, number>()
  for (const t of trades) {
    const price = num(t.yesPrice)
    if (price === null) continue
    const tz = CITY_COORDS[t.cityCode]?.timezone ?? 'America/New_York'
    // event day, most reliable from resolvedAt; fall back to emission+lead, then emission
    const eventTs: number[] = []
    if (num(t.resolvedAt)) eventTs.push(t.resolvedAt)
    if (num(t.leadHours)) eventTs.push(t.timestamp + t.leadHours * 3600_000)
    eventTs.push(t.timestamp)

    let uv: number | undefined, dateKey: string | undefined
    outer: for (const ts of eventTs) {
      const ymd = localYmd(ts, tz)
      if (!ymd) continue
      for (const code of cityAliases(t.cityCode)) {
        const hit = uvBySignalId.get(`srv_${code}_${ymd}_high`)
        if (hit !== undefined) { uv = hit; dateKey = ymd; break outer }
      }
    }
    if (uv === undefined || !dateKey) { missCity.set(t.cityCode, (missCity.get(t.cityCode) ?? 0) + 1); continue }
    joined++
    const win = t.result === 'win' ? 1 : 0
    cells.push({ uv, surprise: win - (1 - price), date: `${t.cityCode}|${dateKey}` })
  }

  console.log('\n=============================================================')
  console.log('  ATM EDGE EXISTENCE TEST — cold/high, since 2026-05-03')
  console.log(`  Run: ${new Date().toISOString().slice(0, 16)} UTC  ·  ${B} clustered bootstraps`)
  console.log('=============================================================')
  console.log(`Resolved cold/high trades            : ${trades.length}`)
  console.log(`Joined to OM near-peak UV (local-day): ${joined}  (${trades.length ? (100 * joined / trades.length).toFixed(0) : 0}%)`)
  if (missCity.size) console.log(`  still-unjoined by city: ${[...missCity.entries()].map(([c, n]) => `${c}:${n}`).join(', ')}`)
  if (cells.length < 12) { console.log('\n  Too few joined cells for a stable test.'); await closeClient(); return }

  // ---- point estimates ----
  const uvs = cells.map(c => c.uv).slice().sort((a, b) => a - b)
  const medUv = pctile(uvs, 0.5)
  const lowArm = cells.filter(c => c.uv < medUv)
  const highArm = cells.filter(c => c.uv >= medUv)
  const exLow = mean(lowArm.map(c => c.surprise))
  const exHigh = mean(highArm.map(c => c.surprise))
  const D = exHigh - exLow
  const slopePt = slope(cells.map(c => c.uv), cells.map(c => c.surprise))

  // distinct cluster (city|day) count = the real effective sample size
  const clusters = new Map<string, Cell[]>()
  for (const c of cells) { const a = clusters.get(c.date) ?? []; a.push(c); clusters.set(c.date, a) }
  const clusterKeys = [...clusters.keys()]

  console.log(`\nMedian UV split = ${medUv.toFixed(2)}   ·   distinct (city|day) clusters = ${clusterKeys.length}`)
  console.log(`  low-UV (humid/cloudy) n=${lowArm.length}: excess edge ${exLow >= 0 ? '+' : ''}${(100 * exLow).toFixed(1)} pp`)
  console.log(`  high-UV (dry/sunny)   n=${highArm.length}: excess edge ${exHigh >= 0 ? '+' : ''}${(100 * exHigh).toFixed(1)} pp`)
  console.log(`  → differential D (high−low) = ${D >= 0 ? '+' : ''}${(100 * D).toFixed(1)} pp   [thesis predicts D>0]`)
  console.log(`  → OLS slope (edge-surprise per +1 UV) = ${slopePt >= 0 ? '+' : ''}${(100 * slopePt).toFixed(2)} pp/UV`)

  // ---- clustered bootstrap (resample whole days) ----
  const rnd = mulberry32(0xC0FFEE)
  const Ds: number[] = [], slopes: number[] = []
  for (let b = 0; b < B; b++) {
    const sample: Cell[] = []
    for (let i = 0; i < clusterKeys.length; i++) {
      sample.push(...clusters.get(clusterKeys[Math.floor(rnd() * clusterKeys.length)])!)
    }
    const lo = sample.filter(c => c.uv < medUv), hi = sample.filter(c => c.uv >= medUv)
    if (!lo.length || !hi.length) continue
    Ds.push(mean(hi.map(c => c.surprise)) - mean(lo.map(c => c.surprise)))
    slopes.push(slope(sample.map(c => c.uv), sample.map(c => c.surprise)))
  }
  Ds.sort((a, b) => a - b); slopes.sort((a, b) => a - b)
  const pD = Ds.filter(d => d <= 0).length / Ds.length
  const pS = slopes.filter(s => s <= 0).length / slopes.length

  console.log(`\nClustered bootstrap (resampling ${clusterKeys.length} days, ${Ds.length} valid draws):`)
  console.log(`  D 95% CI    : [${(100 * pctile(Ds, 0.025)).toFixed(1)}, ${(100 * pctile(Ds, 0.975)).toFixed(1)}] pp   one-sided p(D≤0)=${pD.toFixed(3)}`)
  console.log(`  slope 95% CI: [${(100 * pctile(slopes, 0.025)).toFixed(2)}, ${(100 * pctile(slopes, 0.975)).toFixed(2)}] pp/UV   one-sided p(slope≤0)=${pS.toFixed(3)}`)
  const sig = pD < 0.05 && pS < 0.05
  console.log(`\n  VERDICT: ${sig ? 'edge signal SIGNIFICANT at p<0.05 (both metrics) — worth building emission-time UV capture' : 'NOT significant — directional at best; do NOT invest in ingestion changes yet'}`)
  console.log('  CAVEAT: near-peak UV = optimistic UPPER BOUND (look-ahead); tests taken trades, not offense expansion.\n')

  await closeClient()
}

main().catch(async (e) => { console.error(e); await closeClient(); process.exit(1) })
