/**
 * Reaction-speed / nowcast lead-lag test (read-only) — does an intraday
 * atmospheric innovation LEAD cold-bracket price, leaving an exploitable lag?
 *
 * Preregistered spec (from independent design review 2026-06-19):
 *  - Unit: (event, city-local hour). Event = cold/high (marketType=high).
 *  - Window: hoursToResolution ∈ [8,30] primary (avoids the convergence
 *    tautology); far half [19,30] vs near half [8,18] reported.
 *  - Target price: a FIXED executable cold bracket = the cold-side bracket
 *    immediately below the modal (market-center) bracket at the first in-window
 *    hour. P = YES mid (bid+ask)/2; require two-sided quote.
 *  - Atm signal: shortwave_radiation INNOVATION = ΔswInto(h) − clim Δsw for
 *    (city, hour-of-day) [strips the deterministic diurnal cycle], z-scored
 *    within event. (raw Δ would fake a signal via the day/night schedule.)
 *  - PRIMARY existence test: cross-correlation CC(k)=corr(innov_into_h,
 *    ΔP_into_(h+k)) for k∈{-2..+2}. Exploitable lag ⇒ peak |CC| at k≥+1,
 *    physically-correct sign (insolation-down → cold-price-up ⇒ NEGATIVE CC),
 *    and CC(k*) magnitude > CC(0). k*=0 (contemporaneous) ⇒ KILL.
 *  - k=-1 FALSIFICATION: if price also leads atm (|CC(-1)| large) ⇒ ERA5
 *    bidirectional leakage ⇒ artifact ⇒ KILL.
 *  - Effect size: within-event ΔP_next ~ β·innov + γ·ΔP_prev; judge β vs spread.
 *  - Inference: event-clustered bootstrap (resample whole events), 2000x.
 *  - CAVEAT: ERA5 reanalysis ⇒ any positive is an UPPER BOUND, confirm on the
 *    lookahead-free live capture before risking capital.
 *
 * Usage: npx tsx --tsconfig tsconfig.json scripts/atm-leadlag-test.ts
 */
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config()
import { getDb, closeClient } from '../src/lib/db/mongodb'
import { CITY_COORDS } from '../src/lib/utils/cityCoordinates'

const ATM_EPOCH = Date.parse('2026-05-03T00:00:00Z')
const WIN_LO = 8, WIN_HI = 30
const KS = [-2, -1, 0, 1, 2]
const B = 2000
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN)
const sd = (xs: number[]) => { const m = mean(xs); return Math.sqrt(mean(xs.map(x => (x - m) ** 2))) }
function pearson(x: number[], y: number[]): number {
  const n = x.length; if (n < 3) return NaN
  const mx = mean(x), my = mean(y); let sxy = 0, sxx = 0, syy = 0
  for (let i = 0; i < n; i++) { const dx = x[i] - mx, dy = y[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy }
  return sxx === 0 || syy === 0 ? NaN : sxy / Math.sqrt(sxx * syy)
}
function pctile(s: number[], q: number): number { if (!s.length) return NaN; const i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo) }
function mulberry32(seed: number) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
function localHourParts(ts: number, tz: string): { dateHour: string; hourInt: number; hod: number } | null {
  try {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false }).formatToParts(new Date(ts))
    const g = (t: string) => p.find(x => x.type === t)?.value
    let H = g('hour'); if (H === '24') H = '00'
    const y = g('year'), m = g('month'), d = g('day')
    if (!y || !m || !d || H == null) return null
    const hourInt = Math.floor(Date.UTC(+y, +m - 1, +d, +H) / 3_600_000)
    return { dateHour: `${y}-${m}-${d}T${H}`, hourInt, hod: +H }
  } catch { return null }
}

/** OLS (with intercept implied by pre-demeaning); returns coefs for given cols */
function ols(X: number[][], y: number[]): number[] | null {
  const p = X[0].length, A = Array.from({ length: p }, () => new Array(p).fill(0)), b = new Array(p).fill(0)
  for (let i = 0; i < X.length; i++) for (let j = 0; j < p; j++) { b[j] += X[i][j] * y[i]; for (let k = 0; k < p; k++) A[j][k] += X[i][j] * X[i][k] }
  for (let c = 0; c < p; c++) { let pv = c; for (let r = c + 1; r < p; r++) if (Math.abs(A[r][c]) > Math.abs(A[pv][c])) pv = r; if (Math.abs(A[pv][c]) < 1e-12) return null;[A[c], A[pv]] = [A[pv], A[c]];[b[c], b[pv]] = [b[pv], b[c]]; for (let r = 0; r < p; r++) { if (r === c) continue; const f = A[r][c] / A[c][c]; for (let k = c; k < p; k++) A[r][k] -= f * A[c][k]; b[r] -= f * b[c] } }
  return b.map((v, i) => v / A[i][i])
}

interface EventRows {
  event: string
  // per local hourInt → innov(into h, z-scored within event), ΔPinto(h)
  innov: Map<number, number>
  dP: Map<number, number>
}

async function main(): Promise<void> {
  const db = getDb()
  const snapCol = db.collection<any>('kalshi_market_snapshots')
  const atmCol = db.collection<any>('om_atm_hourly')

  // atm: (city:date) → Map<dateHour, shortwave>
  const atm = await atmCol.find({}).toArray()
  const swByCityHour = new Map<string, number>() // key `${city}|${dateHour}`
  for (const a of atm) {
    const times: string[] = a.hourly?.time ?? []
    const sw: any[] = a.hourly?.shortwave_radiation ?? []
    times.forEach((t, i) => { const dh = t.slice(0, 13); const v = num(sw[i]); if (v !== null) swByCityHour.set(`${a.cityCode}|${dh}`, v) })
  }

  // high events since atm epoch
  const snaps = await snapCol.find(
    { marketType: 'high', cityCode: { $ne: null }, snapshotTime: { $gte: ATM_EPOCH } },
    { projection: { eventTicker: 1, cityCode: 1, snapshotTime: 1, hoursToResolution: 1, brackets: 1 } },
  ).toArray()

  // group by event
  const byEvent = new Map<string, any[]>()
  for (const s of snaps) { const a = byEvent.get(s.eventTicker) ?? []; a.push(s); byEvent.set(s.eventTicker, a) }

  // Pass 1: per event, collapse to hourly (last snap in hour, in window), pick target bracket,
  // build hourInt → {P (yes mid of target), sw}. Collect raw Δsw for climatology.
  interface HourPt { hourInt: number; hod: number; P: number; sw: number }
  const eventPts = new Map<string, HourPt[]>()
  const climSamples = new Map<string, number[]>() // `${city}|${hod}` → Δsw raw
  let evUsed = 0, evNoTarget = 0, evNoAtm = 0
  for (const [event, list] of byEvent) {
    const city = list[0].cityCode
    const tz = CITY_COORDS[city]?.timezone
    if (!tz) continue
    list.sort((a, b) => a.snapshotTime - b.snapshotTime)
    // collapse to hourly: last snapshot per local hour, within window
    const perHour = new Map<number, any>()
    const hodOf = new Map<number, number>(); const dhOf = new Map<number, string>()
    for (const s of list) {
      const htr = num(s.hoursToResolution); if (htr === null || htr < WIN_LO || htr > WIN_HI) continue
      const lh = localHourParts(s.snapshotTime, tz); if (!lh) continue
      perHour.set(lh.hourInt, s); hodOf.set(lh.hourInt, lh.hod); dhOf.set(lh.hourInt, lh.dateHour)
    }
    if (perHour.size < 6) continue
    const hourInts = [...perHour.keys()].sort((a, b) => a - b)
    // target bracket: modal at first in-window hour, nearest cold bracket below it
    const first = perHour.get(hourInts[0])
    let modal: any = null
    for (const b of first.brackets ?? []) { const y = num(b.yesPrice); if (y !== null && (!modal || y > num(modal.yesPrice)!)) modal = b }
    if (!modal) { evNoTarget++; continue }
    const modalLo = num(modal.floorF) ?? (num(modal.capF) ?? Infinity)
    let target: any = null // cold-side bracket with largest capF <= modalLo
    for (const b of first.brackets ?? []) {
      const cap = num(b.capF); const lo = num(b.floorF) ?? -Infinity
      if (cap === null) continue
      if (cap <= modalLo && lo < modalLo) { if (!target || cap > num(target.capF)!) target = b }
    }
    if (!target) { evNoTarget++; continue }
    const targetTicker = target.ticker

    const pts: HourPt[] = []
    let anyAtm = false
    for (const h of hourInts) {
      const s = perHour.get(h)
      const b = (s.brackets ?? []).find((x: any) => x.ticker === targetTicker)
      const bid = num(b?.yesBid), ask = num(b?.yesAsk)
      if (bid === null || ask === null) continue
      const P = (bid + ask) / 2
      const sw = swByCityHour.get(`${city}|${dhOf.get(h)}`)
      if (sw === undefined) continue
      anyAtm = true
      pts.push({ hourInt: h, hod: hodOf.get(h)!, P, sw })
    }
    if (!anyAtm) { evNoAtm++; continue }
    if (pts.length < 4) continue
    eventPts.set(event, pts)
    evUsed++
    // climatology samples: Δsw into consecutive hours
    for (let i = 1; i < pts.length; i++) if (pts[i].hourInt === pts[i - 1].hourInt + 1) {
      const key = `${city}|${pts[i].hod}`; const arr = climSamples.get(key) ?? []; arr.push(pts[i].sw - pts[i - 1].sw); climSamples.set(key, arr)
    }
  }

  const clim = new Map<string, number>()
  for (const [k, arr] of climSamples) clim.set(k, mean(arr))

  // Pass 2: build per-event innov(into h, z) and ΔP(into h)
  const events: EventRows[] = []
  for (const [event, pts] of eventPts) {
    const city = byEvent.get(event)![0].cityCode
    const innovRaw = new Map<number, number>(), dP = new Map<number, number>()
    for (let i = 1; i < pts.length; i++) {
      if (pts[i].hourInt !== pts[i - 1].hourInt + 1) continue // consecutive only
      const h = pts[i].hourInt
      const dsw = pts[i].sw - pts[i - 1].sw
      const c = clim.get(`${city}|${pts[i].hod}`) ?? 0
      innovRaw.set(h, dsw - c)
      dP.set(h, pts[i].P - pts[i - 1].P)
    }
    if (innovRaw.size < 3) continue
    // z-score innov within event
    const vals = [...innovRaw.values()]; const m = mean(vals); const s = sd(vals) || 1
    const innov = new Map<number, number>()
    for (const [h, v] of innovRaw) innov.set(h, (v - m) / s)
    events.push({ event, innov, dP })
  }

  // CC(k) pooled over all events: pairs (innov[h], dP[h+k])
  function pairsAtK(evs: EventRows[], k: number): [number[], number[]] {
    const X: number[] = [], Y: number[] = []
    for (const e of evs) for (const [h, iv] of e.innov) { const d = e.dP.get(h + k); if (d !== undefined) { X.push(iv); Y.push(d) } }
    return [X, Y]
  }
  const ccAll: Record<number, number> = {}
  for (const k of KS) { const [X, Y] = pairsAtK(events, k); ccAll[k] = pearson(X, Y) }

  // regression β (within-event demean): dP[h+1] ~ innov[h] + dP[h]
  function regBeta(evs: EventRows[]): number {
    const Xr: number[][] = [], yr: number[] = []
    for (const e of evs) {
      const rows: Array<[number, number, number]> = [] // innov[h], dPprev=dP[h], dPnext=dP[h+1]
      for (const [h, iv] of e.innov) { const dn = e.dP.get(h + 1), dp = e.dP.get(h); if (dn !== undefined && dp !== undefined) rows.push([iv, dp, dn]) }
      if (rows.length < 3) continue
      const mi = mean(rows.map(r => r[0])), mp = mean(rows.map(r => r[1])), mn = mean(rows.map(r => r[2]))
      for (const r of rows) { Xr.push([r[0] - mi, r[1] - mp]); yr.push(r[2] - mn) }
    }
    if (Xr.length < 10) return NaN
    const b = ols(Xr, yr); return b ? b[0] : NaN
  }
  const betaAll = regBeta(events)

  // event-clustered bootstrap
  const rnd = mulberry32(0xA71)
  const bootK: Record<number, number[]> = {}; KS.forEach(k => bootK[k] = [])
  const bootKstarGEpos: number[] = []; const bootDiff: number[] = []; const bootBeta: number[] = []
  for (let b = 0; b < B; b++) {
    const samp: EventRows[] = []; for (let i = 0; i < events.length; i++) samp.push(events[Math.floor(rnd() * events.length)])
    const cc: Record<number, number> = {}
    for (const k of KS) { const [X, Y] = pairsAtK(samp, k); cc[k] = pearson(X, Y) }
    for (const k of KS) bootK[k].push(cc[k])
    // k* among k>=1 vs contemporaneous: does a positive-lag beat |CC(0)| with correct (neg) sign?
    const posLags = [1, 2].filter(k => Number.isFinite(cc[k]))
    const bestPos = posLags.length ? posLags.reduce((a, k) => Math.abs(cc[k]) > Math.abs(cc[a]) ? k : a, posLags[0]) : null
    if (bestPos !== null && cc[bestPos] < 0 && Math.abs(cc[bestPos]) > Math.abs(cc[0])) bootKstarGEpos.push(1); else bootKstarGEpos.push(0)
    if (bestPos !== null) bootDiff.push(Math.abs(cc[bestPos]) - Math.abs(cc[0]))
    const bb = regBeta(samp); if (Number.isFinite(bb)) bootBeta.push(bb)
  }
  const ci = (arr: number[]) => { const s = arr.slice().sort((a, b) => a - b); return `[${pctile(s, 0.025).toFixed(4)}, ${pctile(s, 0.975).toFixed(4)}]` }

  // far/near split CC at k=+1
  const farEvents = events // we approximate split by recomputing pairs filtered by hoursToRes is complex; report pooled + note
  const [Xp, Yp] = pairsAtK(events, 1)

  console.log('\n=================================================================')
  console.log('  ATM REACTION-SPEED LEAD-LAG TEST (cold/high) — ERA5 backfill')
  console.log(`  Run ${new Date().toISOString().slice(0, 16)} UTC · window htr∈[${WIN_LO},${WIN_HI}] · ${B} event-bootstraps`)
  console.log('=================================================================')
  console.log(`Events used: ${evUsed} (drop: noTarget ${evNoTarget}, noAtm ${evNoAtm}) | events in test: ${events.length} | k=+1 pairs: ${Xp.length}`)
  console.log('\nPRIMARY — cross-correlation CC(k) = corr(shortwave innovation into h, ΔP into h+k):')
  console.log('  (exploitable lag ⇒ peak at k≥+1, NEGATIVE sign, |CC(k*)|>|CC(0)|)')
  for (const k of KS) {
    const s = bootK[k].slice().sort((a, b) => a - b)
    const tag = k > 0 ? 'atm leads' : k < 0 ? 'price leads (falsif.)' : 'contemporaneous'
    console.log(`  k=${k >= 0 ? '+' : ''}${k}  CC=${ccAll[k] >= 0 ? '+' : ''}${ccAll[k].toFixed(4)}  95%CI ${ci(bootK[k])}  (${tag})`)
  }
  console.log(`\n  P(positive-lag beats contemporaneous w/ correct neg sign) = ${(mean(bootKstarGEpos) * 100).toFixed(1)}%  [GO needs ≥80%]`)
  console.log(`  |CC(best+lag)| − |CC(0)| 95%CI = ${ci(bootDiff)}  [GO needs CI excludes 0]`)
  console.log(`\nSECONDARY — within-event β (ΔP_next ~ innov + ΔP_prev), cents/contract per 1-SD cooling surprise:`)
  console.log(`  β = ${betaAll >= 0 ? '+' : ''}${betaAll.toFixed(4)}  95%CI ${ci(bootBeta)}  [expected NEGATIVE; judge |β| vs cold-bracket spread]`)

  // falsification verdict
  const kNeg1 = Math.abs(ccAll[-1]), kPos1 = Math.abs(ccAll[1])
  const leak = kNeg1 >= kPos1 * 0.8 && kNeg1 > 0.03
  const pGo = mean(bootKstarGEpos)
  console.log('\nVERDICT:')
  if (leak) console.log('  KILL — falsification FAILED: price appears to lead ERA5 atm too (bidirectional → reanalysis leakage artifact).')
  else if (pGo >= 0.80 && pctile(bootDiff.slice().sort((a, b) => a - b), 0.025) > 0) console.log('  GO (upper bound) — atm leads price; confirm on lookahead-free LIVE capture before any capital.')
  else console.log('  KILL — no exploitable lead (contemporaneous/!sign/insignificant). Closes the last atm avenue.')
  console.log('  NOTE: ERA5 reanalysis ⇒ any positive is an UPPER BOUND (mild lookahead). Far/near-half + live confirmation required before trading.\n')

  await closeClient()
}
main().catch(async (e) => { console.error(e); await closeClient(); process.exit(1) })
