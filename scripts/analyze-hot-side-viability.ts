// Hot-Side High-Temp Tail-Sell Viability Analysis
//
// Tests whether selling YES on bracket ranges ≥6°F ABOVE forecast (heat-wave
// tails) carries enough prospect-theory premium to justify deployment as a
// new quadrant of the tail-sell strategy. Cold-side high (≥6°F BELOW forecast)
// is currently live with ~93% win rate; this analysis tests the symmetric
// opposite direction.
//
// Methodology mirrors scripts/audit-tail-sell-ev.ts but flips the directional
// gate. The existing audit already shows warm-side events are 60% of cohort;
// this extends to a full GO/NO-GO/CONTINUE decision.
//
// Run: tsx scripts/analyze-hot-side-viability.ts > docs/work/hot-side-viability-2026-05-03.md

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config()

import { getDb, closeClient } from '../src/lib/db/mongodb'

// ============================================================================
// Types
// ============================================================================

interface TempBiasDoc {
  forecastTemp: number
  actualTemp: number
  error: number
  leadHours?: number
  cityCode: string
  marketType?: string
  marketId?: string
  timestamp: number
}

type Event = TempBiasDoc & { absError: number; dist: number; signedDist: number }

// ============================================================================
// Constants
// ============================================================================

const CLEAN_ERA_EPOCH = 1774051200000 // 2026-03-21T00:00Z
const FEE_RATE = 0.10                  // Kalshi 10% of profit on wins (memory: DEFAULT_FEE_RATE)
const TAIL_MIN_DISTANCE_BRACKETS = 3   // ≥6°F = 3 brackets at 2°F each

// Decision-rule thresholds (from approved plan, Phase 3)
const GATE_MEAN_EV_MIN = 0.03          // +3¢ mean EV per trade
const GATE_HIT_RATE_MAX = 0.05         // <5% hit rate at +6°F
const GATE_MIN_SAMPLE_N = 50           // ≥50 hot-side bracket-events
const GATE_MIN_CITIES = 3              // ≥3 cities must pass per-city EV gate

// YES price bands tested (mirrors cold-side audit)
const YES_PRICE_BANDS = [0.05, 0.07, 0.10, 0.15, 0.20]

// ============================================================================
// Helpers
// ============================================================================

function bracketOf(temp: number): number {
  return Math.floor(temp / 2) * 2
}

function bracketDist(forecastTemp: number, actualTemp: number): number {
  return Math.abs(bracketOf(forecastTemp) - bracketOf(actualTemp)) / 2
}

function signedBracketDist(forecastTemp: number, actualTemp: number): number {
  // Positive = actual was WARMER than forecast (relevant for hot-side tails)
  // Negative = actual was COLDER than forecast (cold-side relevant)
  return (bracketOf(actualTemp) - bracketOf(forecastTemp)) / 2
}

function pct(n: number, total: number): string {
  if (total === 0) return '0.0%'
  return ((n / total) * 100).toFixed(2) + '%'
}

function fmtCents(n: number): string {
  const sign = n >= 0 ? '+' : ''
  return sign + (n * 100).toFixed(2) + '¢'
}

function formatDate(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10)
}

/** Per-trade EV for selling YES at `yesPrice` on a bracket with `hitRate`.
 *  Win (bracket misses): collect yesPrice * (1 - feeRate)
 *  Lose (bracket hits): pay (1 - yesPrice) full
 *  EV = (1 - hitRate) * yesPrice * (1 - fee) - hitRate * (1 - yesPrice) */
function expectedValue(hitRate: number, yesPrice: number): number {
  return (1 - hitRate) * yesPrice * (1 - FEE_RATE) - hitRate * (1 - yesPrice)
}

// ============================================================================
// Analyses
// ============================================================================

function printHeader(title: string): void {
  console.log()
  console.log('## ' + title)
  console.log()
}

interface DistRates {
  hits: number  // events where signedDist === D (hot-side hit)
  total: number // total events in cohort
  hitRate: number
}

function computeHotSideRates(events: Event[], maxDist: number): Map<number, DistRates> {
  const result = new Map<number, DistRates>()
  for (let d = 0; d <= maxDist; d++) {
    const hits = events.filter(e => e.signedDist === d).length
    result.set(d, { hits, total: events.length, hitRate: events.length > 0 ? hits / events.length : 0 })
  }
  return result
}

function computeColdSideRates(events: Event[], maxDist: number): Map<number, DistRates> {
  const result = new Map<number, DistRates>()
  for (let d = 0; d <= maxDist; d++) {
    const hits = events.filter(e => e.signedDist === -d).length
    result.set(d, { hits, total: events.length, hitRate: events.length > 0 ? hits / events.length : 0 })
  }
  return result
}

function runDirectionalSummary(events: Event[]): void {
  printHeader('Analysis 1 — Directional asymmetry baseline')

  const total = events.length
  const cold = events.filter(e => e.signedDist < 0).length
  const same = events.filter(e => e.signedDist === 0).length
  const warm = events.filter(e => e.signedDist > 0).length

  console.log(`Total events: ${total}`)
  console.log(`- Actual COLDER than forecast (signedDist < 0): ${cold} (${pct(cold, total)})`)
  console.log(`- Actual SAME bracket as forecast (signedDist = 0): ${same} (${pct(same, total)})`)
  console.log(`- Actual WARMER than forecast (signedDist > 0): ${warm} (${pct(warm, total)})`)
  console.log()
  console.log(`**Asymmetry sanity check:** if forecasts are unbiased, cold ≈ warm.`)
  console.log(`Observed warm/cold ratio: ${cold > 0 ? (warm / cold).toFixed(2) : 'N/A'}`)
  console.log(`Memory baseline (audit-tail-sell-ev.ts): warm-side at ~60% of cohort due to cold-bias of sources.`)
  console.log()

  if (warm < cold) {
    console.log('> ⚠️  Observed cold > warm. Either (a) cold-bias has been corrected, or (b) sample is in a regime where forecasts run hot. Check seasonal coverage.')
  } else {
    console.log('> Pattern matches: actuals run hotter than forecast more often than colder. Foundation for the hot-side tail-sell hypothesis is intact.')
  }
}

function runHotSideHitRateTable(rates: Map<number, DistRates>, label: string): void {
  printHeader(`Analysis 2 — ${label}`)
  console.log('Hit rate at distance +D = fraction of events where actual landed in the bracket exactly +D above the forecast bracket.')
  console.log('A hot-side tail-sell at distance +D LOSES when this hit occurs.')
  console.log()
  console.log('| Distance (above forecast) | °F equivalent | Events | Hit rate |')
  console.log('|---|---|---:|---:|')
  for (let d = 1; d <= 7; d++) {
    const r = rates.get(d)!
    console.log(`| +${d} | +${d * 2}°F | ${r.hits} | ${pct(r.hits, r.total)} |`)
  }
}

function runColdSideControlTable(rates: Map<number, DistRates>): void {
  printHeader('Analysis 3 — Cold-side baseline (sanity control)')
  console.log('Mirror of hot-side hit rate but for cold-side. Should match `memory/tail-sell-viability-2026-03-28.md` baseline.')
  console.log('Memory baseline: 0.24% cold-side hit rate at ±3.')
  console.log()
  console.log('| Distance (below forecast) | °F equivalent | Events | Hit rate |')
  console.log('|---|---|---:|---:|')
  for (let d = 1; d <= 7; d++) {
    const r = rates.get(d)!
    console.log(`| -${d} | -${d * 2}°F | ${r.hits} | ${pct(r.hits, r.total)} |`)
  }
}

function runEVTable(hotRates: Map<number, DistRates>, label: string): { passingDistance: number | null; bestEV: number } {
  printHeader(`Analysis 4 — ${label}`)
  console.log(`Per-trade EV for selling YES at price P on a hot-side bracket at distance +D from forecast.`)
  console.log(`Formula: EV = (1 - hitRate) × P × (1 - ${FEE_RATE}) - hitRate × (1 - P)`)
  console.log(`Fee model: ${(FEE_RATE * 100).toFixed(0)}% of profit on winning trades only (Kalshi standard).`)
  console.log()

  const distances = [3, 4, 5, 6, 7]
  console.log('| Distance | °F | Hit rate | ' + YES_PRICE_BANDS.map(p => `YES=${(p*100).toFixed(0)}¢`).join(' | ') + ' |')
  console.log('|---|---|---:|' + YES_PRICE_BANDS.map(() => '---:').join('|') + '|')

  let bestEV = -Infinity
  let passingDistance: number | null = null
  for (const d of distances) {
    const r = hotRates.get(d)!
    const cells: string[] = [`+${d}`, `+${d*2}°F`, pct(r.hits, r.total)]
    let rowMaxEV = -Infinity
    for (const p of YES_PRICE_BANDS) {
      const ev = expectedValue(r.hitRate, p)
      cells.push(fmtCents(ev) + (ev >= GATE_MEAN_EV_MIN ? ' ✓' : ''))
      rowMaxEV = Math.max(rowMaxEV, ev)
    }
    if (d === TAIL_MIN_DISTANCE_BRACKETS && rowMaxEV > bestEV) {
      bestEV = rowMaxEV
      // Passing distance: where best YES band yields EV ≥ gate
      if (rowMaxEV >= GATE_MEAN_EV_MIN) passingDistance = d
    }
    console.log('| ' + cells.join(' | ') + ' |')
  }

  console.log()
  console.log('Breakeven YES price by distance (where EV crosses 0 ignoring fees):')
  for (const d of distances) {
    const r = hotRates.get(d)!
    // (1-h)p(1-f) - h(1-p) = 0  →  p[(1-h)(1-f) + h] = h  →  p = h / [(1-h)(1-f) + h]
    const denom = (1 - r.hitRate) * (1 - FEE_RATE) + r.hitRate
    const breakeven = denom > 0 ? r.hitRate / denom : 0
    console.log(`  +${d}: hit rate ${pct(r.hits, r.total)} → breakeven YES = ${(breakeven * 100).toFixed(2)}¢`)
  }

  return { passingDistance, bestEV }
}

function runPerCity(events: Event[]): { passingCities: number; rows: Array<{city: string; total: number; hits: number; hitRate: number}> } {
  printHeader('Analysis 5 — Per-city hot-side hit rate at ≥+6°F')

  const byCity = new Map<string, { total: number; hits3plus: number }>()
  for (const e of events) {
    const cur = byCity.get(e.cityCode) ?? { total: 0, hits3plus: 0 }
    cur.total++
    if (e.signedDist >= TAIL_MIN_DISTANCE_BRACKETS) cur.hits3plus++
    byCity.set(e.cityCode, cur)
  }

  console.log('Hit rate at ≥+6°F (any hot-side outcome that would have closed a tail-sell at distance ≥3).')
  console.log('Per the GO criteria, ≥3 cities must pass the per-city EV gate.')
  console.log()
  console.log('| City | Events | ≥+6°F hits | Hit rate | EV at YES=10¢ | Pass? |')
  console.log('|---|---:|---:|---:|---:|---|')

  const rows: Array<{city: string; total: number; hits: number; hitRate: number}> = []
  let passingCities = 0
  for (const [city, c] of [...byCity.entries()].sort((a, b) => b[1].total - a[1].total)) {
    const hitRate = c.total > 0 ? c.hits3plus / c.total : 0
    const evAt10c = expectedValue(hitRate, 0.10)
    const pass = evAt10c >= GATE_MEAN_EV_MIN && hitRate < GATE_HIT_RATE_MAX
    if (pass) passingCities++
    rows.push({ city, total: c.total, hits: c.hits3plus, hitRate })
    console.log(`| ${city} | ${c.total} | ${c.hits3plus} | ${pct(c.hits3plus, c.total)} | ${fmtCents(evAt10c)} | ${pass ? '✓' : '✗'} |`)
  }
  console.log()
  console.log(`Passing cities: ${passingCities} / ${byCity.size} (gate requires ≥${GATE_MIN_CITIES})`)

  return { passingCities, rows }
}

// Production position-limit constants (mirrors src/lib/models/tailSellTracker.ts)
const MAX_PER_CITY_TYPE = 2      // per (city, temperatureType) — hot+cold high share
const MAX_NE_CORRIDOR = 5        // NY+DC+BOS+PHIL+PHI cap
const MAX_TOTAL_LIVE = 8
const NE_CORRIDOR_CITIES = new Set(['NY', 'DC', 'BOS', 'PHIL', 'PHI'])

/** Apply production position caps to a set of would-be-active hits on one day.
 *  On a heat-wave day, cold-side wouldn't fire (forecasts aren't running cold);
 *  so the 2-per-(city,type) cap is effectively all available to hot-side. */
function applyPositionCaps(hits: Event[]): { capped: Event[]; capExplanation: string } {
  // Step 1: per (city, marketType=high) → keep first 2
  const byCity = new Map<string, Event[]>()
  for (const e of hits) {
    if (!byCity.has(e.cityCode)) byCity.set(e.cityCode, [])
    byCity.get(e.cityCode)!.push(e)
  }
  let postCity: Event[] = []
  for (const [, list] of byCity) {
    postCity = postCity.concat(list.slice(0, MAX_PER_CITY_TYPE))
  }

  // Step 2: NE corridor cap
  const neHits = postCity.filter(e => NE_CORRIDOR_CITIES.has(e.cityCode))
  const neAllowed = neHits.slice(0, MAX_NE_CORRIDOR)
  const neBlocked = neHits.length - neAllowed.length
  const nonNe = postCity.filter(e => !NE_CORRIDOR_CITIES.has(e.cityCode))
  let postNe = neAllowed.concat(nonNe)

  // Step 3: total cap
  const totalAllowed = postNe.slice(0, MAX_TOTAL_LIVE)
  const totalBlocked = postNe.length - totalAllowed.length

  const capExplanation = `${hits.length} raw hits → ${postCity.length} after per-city cap → ${postNe.length} after NE-corridor cap → ${totalAllowed.length} after total cap`

  return { capped: totalAllowed, capExplanation }
}

function runCorrelatedBlowup(events: Event[]): { worstDayLossAt20: number; worstDayLossAt50: number; worstDate: string | null; rawWorstHits: number } {
  printHeader('Analysis 6 — Correlated blowup risk (heat-wave drawdown)')
  console.log('Hot-side tails are MORE correlated than cold-side because heat waves are regional and persistent.')
  console.log()
  console.log('Production position caps applied:')
  console.log(`- MAX_PER_CITY_TYPE = ${MAX_PER_CITY_TYPE} (per (city, temperatureType=high))`)
  console.log(`- MAX_NE_CORRIDOR = ${MAX_NE_CORRIDOR} (NY+DC+BOS+PHIL+PHI cap)`)
  console.log(`- MAX_TOTAL_LIVE = ${MAX_TOTAL_LIVE}`)
  console.log()
  console.log('On a heat-wave day, cold-side high wouldn\'t fire (forecasts running cold ≠ heat wave). So the 2-per-(city,type) cap is effectively all available to hot-side.')
  console.log()

  // For each day, gather events where bracket at ≥6°F above forecast was hit
  const byDate = new Map<string, Event[]>()
  for (const e of events) {
    if (e.signedDist < TAIL_MIN_DISTANCE_BRACKETS) continue
    const date = formatDate(e.timestamp)
    if (!byDate.has(date)) byDate.set(date, [])
    byDate.get(date)!.push(e)
  }

  if (byDate.size === 0) {
    console.log('No hot-side ≥+6°F events in clean era. Either forecasts are very accurate on warm side OR sample is too thin.')
    return { worstDayLossAt20: 0, worstDayLossAt50: 0, worstDate: null, rawWorstHits: 0 }
  }

  // For each day, apply caps and compute capped P&L
  const dayLosses: Array<{ date: string; rawHits: number; cappedHits: number; cities: string[]; explanation: string }> = []
  const lossPerContract = 0.90
  const contractsAt20 = Math.floor(20 / lossPerContract)  // ~22 contracts
  const contractsAt50 = Math.floor(50 / lossPerContract)  // ~55 contracts

  for (const [date, hits] of byDate) {
    const { capped, capExplanation } = applyPositionCaps(hits)
    dayLosses.push({
      date,
      rawHits: hits.length,
      cappedHits: capped.length,
      cities: [...new Set(capped.map(e => e.cityCode))],
      explanation: capExplanation,
    })
  }

  // Worst day = most CAPPED simultaneous active losses
  dayLosses.sort((a, b) => b.cappedHits - a.cappedHits || b.rawHits - a.rawHits)
  const worst = dayLosses[0]
  const worstDayLossAt20 = worst.cappedHits * contractsAt20 * lossPerContract
  const worstDayLossAt50 = worst.cappedHits * contractsAt50 * lossPerContract

  console.log('| Metric | Value |')
  console.log('|---|---|')
  console.log(`| Worst single day | ${worst.date} |`)
  console.log(`| Raw hits on worst day | ${worst.rawHits} |`)
  console.log(`| Active positions after caps | ${worst.cappedHits} (cities: ${worst.cities.join(', ')}) |`)
  console.log(`| Cap chain | ${worst.explanation} |`)
  console.log(`| Worst-day P&L drawdown @ $20 position | -$${worstDayLossAt20.toFixed(2)} |`)
  console.log(`| Worst-day P&L drawdown @ $50 position | -$${worstDayLossAt50.toFixed(2)} |`)
  console.log()
  console.log('Top 5 worst days (by capped active positions):')
  console.log('| Date | Raw hits | Capped active | Cities |')
  console.log('|---|---:|---:|---|')
  for (const d of dayLosses.slice(0, 5)) {
    console.log(`| ${d.date} | ${d.rawHits} | ${d.cappedHits} | ${d.cities.join(', ')} |`)
  }

  return { worstDayLossAt20, worstDayLossAt50, worstDate: worst.date, rawWorstHits: worst.rawHits }
}

function runDecisionRules(args: {
  events: Event[]
  hotRates: Map<number, DistRates>
  passingCities: number
  worstDayLossAt20: number
  worstDayLossAt50: number
  bestEV: number
}): void {
  printHeader('Decision Rules — GO / NO-GO / CONTINUE')

  const { events, hotRates, passingCities, worstDayLossAt20, worstDayLossAt50, bestEV } = args

  const r3 = hotRates.get(3)!
  const sample = events.filter(e => e.signedDist >= TAIL_MIN_DISTANCE_BRACKETS).length

  const checks: { name: string; passed: boolean; detail: string }[] = []

  checks.push({
    name: `Hit rate at +6°F < ${(GATE_HIT_RATE_MAX*100).toFixed(0)}%`,
    passed: r3.hitRate < GATE_HIT_RATE_MAX,
    detail: `Observed: ${pct(r3.hits, r3.total)}`,
  })

  // Mean EV across the +3 distance population: average over the YES price bands
  const mean3EV = YES_PRICE_BANDS.reduce((s, p) => s + expectedValue(r3.hitRate, p), 0) / YES_PRICE_BANDS.length
  checks.push({
    name: `Mean per-trade EV at +6°F across YES bands ≥ ${(GATE_MEAN_EV_MIN*100).toFixed(0)}¢`,
    passed: mean3EV >= GATE_MEAN_EV_MIN,
    detail: `Observed: ${fmtCents(mean3EV)}`,
  })

  checks.push({
    name: 'Worst-day drawdown at $20 position < $200',
    passed: worstDayLossAt20 < 200,
    detail: `Observed: -$${worstDayLossAt20.toFixed(2)}`,
  })

  checks.push({
    name: 'Worst-day drawdown at $50 position < $500',
    passed: worstDayLossAt50 < 500,
    detail: `Observed: -$${worstDayLossAt50.toFixed(2)}`,
  })

  checks.push({
    name: `Sample n at +6°F+ ≥ ${GATE_MIN_SAMPLE_N}`,
    passed: sample >= GATE_MIN_SAMPLE_N,
    detail: `Observed: ${sample}`,
  })

  checks.push({
    name: `≥${GATE_MIN_CITIES} cities pass per-city EV gate`,
    passed: passingCities >= GATE_MIN_CITIES,
    detail: `Observed: ${passingCities}`,
  })

  console.log('| Check | Result | Detail |')
  console.log('|---|---|---|')
  for (const c of checks) {
    console.log(`| ${c.name} | ${c.passed ? '✓ PASS' : '✗ FAIL'} | ${c.detail} |`)
  }
  console.log()

  // Apply decision rules
  const allPass = checks.every(c => c.passed)
  // NO-GO triggers (any one fatal)
  const fatalNoGo =
    r3.hitRate > 0.08 ||
    mean3EV <= 0 ||
    worstDayLossAt50 > 500 ||
    sample < 30
  // CONTINUE: marginal positive
  const marginalContinue = !allPass && !fatalNoGo && mean3EV > 0

  if (allPass) {
    console.log('## **VERDICT: GO**')
    console.log()
    console.log('All decision criteria pass. Proceed to Phase 4 (hot-side high-temp tail-sell deployment scope).')
    console.log('Recommended initial deployment: `HOT_TAIL_HIGH_MODE=paper` for 30 days, then evaluate flip-to-live.')
  } else if (fatalNoGo) {
    console.log('## **VERDICT: NO-GO**')
    console.log()
    console.log('At least one fatal criterion failed. Document the null result, drop hot-side high deployment.')
    console.log('Mechanism explanation: heat waves are common enough OR YES pricing is efficient enough that prospect-theory premium does not survive the fee structure. Cold-side high remains the deployed quadrant.')
  } else if (marginalContinue) {
    console.log('## **VERDICT: CONTINUE**')
    console.log()
    console.log('Mean EV is marginally positive but full criteria not met. Recommendation: deploy `HOT_TAIL_HIGH_MODE=paper` and re-evaluate at +30 days with paper-resolved data.')
  } else {
    console.log('## **VERDICT: AMBIGUOUS**')
    console.log()
    console.log('Mixed signals. Recommend continued data accumulation and re-analysis at +30 days.')
  }
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const db = getDb()

  console.log('# Hot-Side High-Temp Tail-Sell Viability Analysis')
  console.log()
  console.log(`Generated: ${new Date().toISOString()}`)
  console.log(`Clean-era epoch: ${formatDate(CLEAN_ERA_EPOCH)}`)
  console.log(`Fee model: ${(FEE_RATE * 100).toFixed(0)}% of profit on wins (Kalshi standard)`)
  console.log()

  const tempBiasDocs = await db.collection<TempBiasDoc>('temp_bias')
    .find({
      timestamp: { $gte: CLEAN_ERA_EPOCH },
      marketType: 'high',
      forecastTemp: { $type: 'number' },
      actualTemp: { $type: 'number' },
    } as any)
    .project<TempBiasDoc>({ forecastTemp: 1, actualTemp: 1, error: 1, leadHours: 1, cityCode: 1, marketType: 1, marketId: 1, timestamp: 1 })
    .toArray()

  console.log(`Fetched ${tempBiasDocs.length} clean-era temp_bias docs (high markets only).`)
  console.log()

  if (tempBiasDocs.length === 0) {
    console.log('No data. Cannot analyze.')
    await closeClient()
    return
  }

  const events: Event[] = tempBiasDocs.map(d => ({
    ...d,
    absError: Math.abs(d.error ?? (d.forecastTemp - d.actualTemp)),
    dist: bracketDist(d.forecastTemp, d.actualTemp),
    signedDist: signedBracketDist(d.forecastTemp, d.actualTemp),
  }))

  // Date coverage
  const ts = events.map(e => e.timestamp).sort((a, b) => a - b)
  console.log(`Coverage: ${formatDate(ts[0])} → ${formatDate(ts[ts.length - 1])}`)
  console.log(`Cities: ${[...new Set(events.map(e => e.cityCode))].sort().join(', ')}`)
  console.log()

  // Analyses
  runDirectionalSummary(events)

  const hotRates = computeHotSideRates(events, 7)
  runHotSideHitRateTable(hotRates, 'Hot-side bracket hit rate by distance (signedDist === +D)')

  const coldRates = computeColdSideRates(events, 7)
  runColdSideControlTable(coldRates)

  const { passingDistance, bestEV } = runEVTable(hotRates, 'Per-trade EV table — hot-side (selling YES at price P)')

  const { passingCities, rows } = runPerCity(events)

  const { worstDayLossAt20, worstDayLossAt50, worstDate, rawWorstHits } = runCorrelatedBlowup(events)

  runDecisionRules({
    events,
    hotRates,
    passingCities,
    worstDayLossAt20,
    worstDayLossAt50,
    bestEV,
  })

  // Caveats
  printHeader('Caveats')
  console.log('- Coverage window is clean era (2026-03-21 onwards). May not include peak summer heat-wave months.')
  console.log('- YES price bands assumed (5-20¢) match cold-side observed range. Hot-side actual price distribution requires `kalshi_market_snapshots` join for full validation. This analysis tests structural EV at canonical price points.')
  console.log('- `temp_bias` retention is 180 days; sample beyond that is excluded.')
  console.log('- Hit-rate computation uses 2°F bracket convention. Kalshi threshold brackets (T-suffix) and inner brackets are bucketed identically.')
  console.log('- Correlated blowup analysis applies production position caps (MAX_PER_CITY_TYPE=2, MAX_NE_CORRIDOR=5, MAX_TOTAL_LIVE=8). Without caps, the worst-day raw-loss number would be much higher; capping is the realistic risk view.')
  console.log("- On a heat-wave day, cold-side high wouldn't fire (cold-side requires actual < forecast - 6°F, the opposite condition). So cold-side does not consume the 2-per-(city,type) budget on hot-side disaster days. Budget contention only matters on mild-bias days, which by definition are low-loss.")

  await closeClient()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
