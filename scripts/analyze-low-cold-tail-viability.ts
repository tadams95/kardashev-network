// LOW Cold-Tail Tail-Sell Viability Analysis
//
// Tests whether selling YES on bracket ranges ≥6°F BELOW forecast on LOW-TEMP
// markets (deep-cold tails) carries enough prospect-theory premium to justify
// deployment as a new quadrant of the tail-sell strategy.
//
// Mirror of scripts/analyze-hot-side-viability.ts but for low markets +
// below-forecast direction. Hit rate at -D = events where actual landed in
// the bracket exactly -D below forecast (i.e., signedDist === -D for low markets).
//
// Run: tsx scripts/analyze-low-cold-tail-viability.ts > docs/work/low-cold-tail-viability-2026-05-04.md

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config()

import { getDb, closeClient } from '../src/lib/db/mongodb'

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

// Low-temp markets only became available 2026-04-03 (KXLOWT prefix). Use that
// as the start of useful sample. Earlier data may exist in temp_bias from
// pipeline pre-cuts but won't have proper market context.
const LOW_TEMP_EPOCH = new Date('2026-04-03').getTime()
const FEE_RATE = 0.10
const TAIL_MIN_DISTANCE_BRACKETS = 3   // ≥6°F at 2°F brackets

const GATE_MEAN_EV_MIN = 0.03
const GATE_HIT_RATE_MAX = 0.05
const GATE_MIN_SAMPLE_N = 50
const GATE_MIN_CITIES = 3

const YES_PRICE_BANDS = [0.05, 0.07, 0.10, 0.15, 0.20]

const MAX_PER_CITY_TYPE = 2
const MAX_NE_CORRIDOR = 5
const MAX_TOTAL_LIVE = 8
const NE_CORRIDOR_CITIES = new Set(['NY', 'NYC', 'DC', 'BOS', 'PHIL', 'PHI'])

function bracketOf(temp: number): number { return Math.floor(temp / 2) * 2 }
function bracketDist(forecast: number, actual: number): number {
  return Math.abs(bracketOf(forecast) - bracketOf(actual)) / 2
}
function signedBracketDist(forecast: number, actual: number): number {
  return (bracketOf(actual) - bracketOf(forecast)) / 2
}
function pct(n: number, total: number): string {
  if (total === 0) return '0.0%'
  return ((n / total) * 100).toFixed(2) + '%'
}
function fmtCents(n: number): string {
  return (n >= 0 ? '+' : '') + (n * 100).toFixed(2) + '¢'
}
function formatDate(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10)
}
function expectedValue(hitRate: number, yesPrice: number): number {
  return (1 - hitRate) * yesPrice * (1 - FEE_RATE) - hitRate * (1 - yesPrice)
}

function printHeader(title: string): void {
  console.log()
  console.log('## ' + title)
  console.log()
}

interface DistRates { hits: number; total: number; hitRate: number }

function computeColdSideRates(events: Event[], maxDist: number): Map<number, DistRates> {
  const result = new Map<number, DistRates>()
  for (let d = 0; d <= maxDist; d++) {
    // For LOW market cold-tail: bracket below forecast → hit when actual is BELOW forecast
    const hits = events.filter(e => e.signedDist === -d).length
    result.set(d, { hits, total: events.length, hitRate: events.length > 0 ? hits / events.length : 0 })
  }
  return result
}

function computeWarmSideRates(events: Event[], maxDist: number): Map<number, DistRates> {
  const result = new Map<number, DistRates>()
  for (let d = 0; d <= maxDist; d++) {
    const hits = events.filter(e => e.signedDist === d).length
    result.set(d, { hits, total: events.length, hitRate: events.length > 0 ? hits / events.length : 0 })
  }
  return result
}

function runDirectionalSummary(events: Event[]): void {
  printHeader('Analysis 1 — Directional asymmetry baseline (LOW markets)')

  const total = events.length
  const cold = events.filter(e => e.signedDist < 0).length
  const same = events.filter(e => e.signedDist === 0).length
  const warm = events.filter(e => e.signedDist > 0).length

  console.log(`Total events: ${total}`)
  console.log(`- Actual COLDER than forecast (signedDist < 0): ${cold} (${pct(cold, total)})`)
  console.log(`- Actual SAME bracket as forecast (signedDist = 0): ${same} (${pct(same, total)})`)
  console.log(`- Actual WARMER than forecast (signedDist > 0): ${warm} (${pct(warm, total)})`)
  console.log()
  console.log('**Memory baseline for LOW markets** (`memory/low-temp-phase-a-2026-04-03.md`): forecast bias is REVERSED from highs — sources tend to be warm-biased on low forecasts (predict warmer than actual), meaning actuals run COLDER than forecast more often than warmer.')
  console.log(`Observed cold/warm ratio: ${warm > 0 ? (cold / warm).toFixed(2) : 'N/A'}`)
  console.log()
  if (cold > warm) {
    console.log('> Pattern matches the LOW-market cold-bias: actuals run COLDER than forecast more often. This is the foundational asymmetry that powers cold-tail-LOW (deep-cold) tail-sell.')
  } else {
    console.log('> Cold-tail-LOW does NOT have the asymmetry advantage in this sample. Warm-side dominance suggests warm-tail-LOW (the existing paper quadrant) is structurally favored — and cold-tail-LOW may not have edge.')
  }
}

function runColdTailHitRateTable(rates: Map<number, DistRates>, label: string): void {
  printHeader(`Analysis 2 — ${label}`)
  console.log('Hit rate at distance -D = fraction of events where actual landed in the bracket exactly -D below the forecast bracket.')
  console.log('A cold-tail-LOW tail-sell at distance -D LOSES when this hit occurs.')
  console.log()
  console.log('| Distance (below forecast) | °F equivalent | Events | Hit rate |')
  console.log('|---|---|---:|---:|')
  for (let d = 1; d <= 7; d++) {
    const r = rates.get(d)!
    console.log(`| -${d} | -${d * 2}°F | ${r.hits} | ${pct(r.hits, r.total)} |`)
  }
}

function runWarmSideControlTable(rates: Map<number, DistRates>): void {
  printHeader('Analysis 3 — Warm-tail-LOW control (currently paper-mode)')
  console.log('Mirror of cold-tail hit rate but for warm-side. This is the existing paper-mode quadrant; numbers should match its observed paper performance.')
  console.log()
  console.log('| Distance (above forecast) | °F equivalent | Events | Hit rate |')
  console.log('|---|---|---:|---:|')
  for (let d = 1; d <= 7; d++) {
    const r = rates.get(d)!
    console.log(`| +${d} | +${d * 2}°F | ${r.hits} | ${pct(r.hits, r.total)} |`)
  }
}

function runEVTable(coldRates: Map<number, DistRates>): { passingDistance: number | null } {
  printHeader('Analysis 4 — Per-trade EV table — cold-tail-LOW (selling YES at price P)')
  console.log(`Formula: EV = (1 - hitRate) × P × (1 - ${FEE_RATE}) - hitRate × (1 - P)`)
  console.log()

  const distances = [3, 4, 5, 6, 7]
  console.log('| Distance | °F | Hit rate | ' + YES_PRICE_BANDS.map(p => `YES=${(p*100).toFixed(0)}¢`).join(' | ') + ' |')
  console.log('|---|---|---:|' + YES_PRICE_BANDS.map(() => '---:').join('|') + '|')

  let passingDistance: number | null = null
  for (const d of distances) {
    const r = coldRates.get(d)!
    const cells: string[] = [`-${d}`, `-${d*2}°F`, pct(r.hits, r.total)]
    let rowMaxEV = -Infinity
    for (const p of YES_PRICE_BANDS) {
      const ev = expectedValue(r.hitRate, p)
      cells.push(fmtCents(ev) + (ev >= GATE_MEAN_EV_MIN ? ' ✓' : ''))
      rowMaxEV = Math.max(rowMaxEV, ev)
    }
    if (d === TAIL_MIN_DISTANCE_BRACKETS && rowMaxEV >= GATE_MEAN_EV_MIN) passingDistance = d
    console.log('| ' + cells.join(' | ') + ' |')
  }

  console.log()
  console.log('Breakeven YES price by distance (where EV crosses 0):')
  for (const d of distances) {
    const r = coldRates.get(d)!
    const denom = (1 - r.hitRate) * (1 - FEE_RATE) + r.hitRate
    const breakeven = denom > 0 ? r.hitRate / denom : 0
    console.log(`  -${d}: hit rate ${pct(r.hits, r.total)} → breakeven YES = ${(breakeven * 100).toFixed(2)}¢`)
  }

  return { passingDistance }
}

function runPerCity(events: Event[]): { passingCities: number; rows: Array<{city: string; total: number; hits: number; hitRate: number}> } {
  printHeader('Analysis 5 — Per-city cold-tail-LOW hit rate at ≥-6°F')

  const byCity = new Map<string, { total: number; hits3plus: number }>()
  for (const e of events) {
    const cur = byCity.get(e.cityCode) ?? { total: 0, hits3plus: 0 }
    cur.total++
    if (e.signedDist <= -TAIL_MIN_DISTANCE_BRACKETS) cur.hits3plus++
    byCity.set(e.cityCode, cur)
  }

  console.log('| City | Events | ≥-6°F hits | Hit rate | EV at YES=10¢ | Pass? |')
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

function applyPositionCaps(hits: Event[]): { capped: Event[]; explanation: string } {
  const byCity = new Map<string, Event[]>()
  for (const e of hits) {
    if (!byCity.has(e.cityCode)) byCity.set(e.cityCode, [])
    byCity.get(e.cityCode)!.push(e)
  }
  let postCity: Event[] = []
  for (const [, list] of byCity) postCity = postCity.concat(list.slice(0, MAX_PER_CITY_TYPE))

  const neHits = postCity.filter(e => NE_CORRIDOR_CITIES.has(e.cityCode))
  const neAllowed = neHits.slice(0, MAX_NE_CORRIDOR)
  const nonNe = postCity.filter(e => !NE_CORRIDOR_CITIES.has(e.cityCode))
  const postNe = neAllowed.concat(nonNe)
  const totalAllowed = postNe.slice(0, MAX_TOTAL_LIVE)

  return {
    capped: totalAllowed,
    explanation: `${hits.length} → ${postCity.length} (city) → ${postNe.length} (NE) → ${totalAllowed.length} (total)`,
  }
}

function runCorrelatedBlowup(events: Event[]): { worstDayLossAt20: number; worstDayLossAt50: number; worstDate: string | null } {
  printHeader('Analysis 6 — Correlated blowup risk (cold-snap drawdown)')
  console.log('Cold snaps are regional; multiple cities can see deep-cold lows simultaneously.')
  console.log()

  const byDate = new Map<string, Event[]>()
  for (const e of events) {
    if (e.signedDist > -TAIL_MIN_DISTANCE_BRACKETS) continue
    const date = formatDate(e.timestamp)
    if (!byDate.has(date)) byDate.set(date, [])
    byDate.get(date)!.push(e)
  }

  if (byDate.size === 0) {
    console.log('No cold-tail-LOW ≤-6°F events in clean era. Cold snaps too rare in current sample window.')
    return { worstDayLossAt20: 0, worstDayLossAt50: 0, worstDate: null }
  }

  const lossPerContract = 0.90
  const contractsAt20 = Math.floor(20 / lossPerContract)
  const contractsAt50 = Math.floor(50 / lossPerContract)

  const dayLosses: Array<{ date: string; rawHits: number; cappedHits: number; cities: string[]; explanation: string }> = []
  for (const [date, hits] of byDate) {
    const { capped, explanation } = applyPositionCaps(hits)
    dayLosses.push({
      date,
      rawHits: hits.length,
      cappedHits: capped.length,
      cities: [...new Set(capped.map(e => e.cityCode))],
      explanation,
    })
  }
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

  return { worstDayLossAt20, worstDayLossAt50, worstDate: worst.date }
}

function runDecisionRules(args: {
  events: Event[]
  coldRates: Map<number, DistRates>
  passingCities: number
  worstDayLossAt20: number
  worstDayLossAt50: number
}): void {
  printHeader('Decision Rules — GO / NO-GO / CONTINUE')
  const { events, coldRates, passingCities, worstDayLossAt20, worstDayLossAt50 } = args

  const r3 = coldRates.get(3)!
  const sample = events.filter(e => e.signedDist <= -TAIL_MIN_DISTANCE_BRACKETS).length
  const checks: { name: string; passed: boolean; detail: string }[] = []

  checks.push({
    name: `Hit rate at -6°F < ${(GATE_HIT_RATE_MAX*100).toFixed(0)}%`,
    passed: r3.hitRate < GATE_HIT_RATE_MAX,
    detail: `Observed: ${pct(r3.hits, r3.total)}`,
  })

  const mean3EV = YES_PRICE_BANDS.reduce((s, p) => s + expectedValue(r3.hitRate, p), 0) / YES_PRICE_BANDS.length
  checks.push({
    name: `Mean per-trade EV at -6°F across YES bands ≥ ${(GATE_MEAN_EV_MIN*100).toFixed(0)}¢`,
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
    name: `Sample n at -6°F+ ≥ ${GATE_MIN_SAMPLE_N}`,
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

  const allPass = checks.every(c => c.passed)
  const fatalNoGo = r3.hitRate > 0.08 || mean3EV <= 0 || worstDayLossAt50 > 500 || sample < 30
  const marginalContinue = !allPass && !fatalNoGo && mean3EV > 0

  if (allPass) {
    console.log('## **VERDICT: GO**')
    console.log()
    console.log('All decision criteria pass. Proceed to Phase B (cold-tail-LOW signal generation deployment in paper mode).')
  } else if (fatalNoGo) {
    console.log('## **VERDICT: NO-GO**')
    console.log()
    console.log('At least one fatal criterion failed. Drop cold-tail-LOW from this work; ship hot-side-HIGH only.')
    console.log('Mechanism: cold snaps either too common in this regime OR YES pricing too efficient at deep-cold tails. Warm-tail-LOW (already paper) remains the deployed low-temp quadrant.')
  } else if (marginalContinue) {
    console.log('## **VERDICT: CONTINUE**')
    console.log()
    console.log('Mean EV marginally positive but full criteria not met. Recommend including cold-tail-LOW in Phase B with `LOW_TEMP_COLD_TAIL_MODE=paper`; re-evaluate at +30 days with paper-resolved data.')
  } else {
    console.log('## **VERDICT: AMBIGUOUS**')
    console.log()
    console.log('Mixed signals. Recommend deploying paper mode to gather forward data; re-analyze at +30 days.')
  }
}

async function main(): Promise<void> {
  const db = getDb()

  console.log('# LOW Cold-Tail Tail-Sell Viability Analysis')
  console.log()
  console.log(`Generated: ${new Date().toISOString()}`)
  console.log(`Low-temp epoch: ${formatDate(LOW_TEMP_EPOCH)}`)
  console.log(`Fee model: ${(FEE_RATE * 100).toFixed(0)}% of profit on wins`)
  console.log()

  const docs = await db.collection<TempBiasDoc>('temp_bias')
    .find({
      timestamp: { $gte: LOW_TEMP_EPOCH },
      marketType: 'low',
      forecastTemp: { $type: 'number' },
      actualTemp: { $type: 'number' },
    } as any)
    .project<TempBiasDoc>({ forecastTemp: 1, actualTemp: 1, error: 1, leadHours: 1, cityCode: 1, marketType: 1, marketId: 1, timestamp: 1 })
    .toArray()

  console.log(`Fetched ${docs.length} temp_bias docs (LOW markets, since ${formatDate(LOW_TEMP_EPOCH)}).`)
  console.log()

  if (docs.length === 0) {
    console.log('No data. Cannot analyze.')
    await closeClient()
    return
  }

  const events: Event[] = docs.map(d => ({
    ...d,
    absError: Math.abs(d.error ?? (d.forecastTemp - d.actualTemp)),
    dist: bracketDist(d.forecastTemp, d.actualTemp),
    signedDist: signedBracketDist(d.forecastTemp, d.actualTemp),
  }))

  const ts = events.map(e => e.timestamp).sort((a, b) => a - b)
  console.log(`Coverage: ${formatDate(ts[0])} → ${formatDate(ts[ts.length - 1])}`)
  console.log(`Cities: ${[...new Set(events.map(e => e.cityCode))].sort().join(', ')}`)
  console.log()

  runDirectionalSummary(events)

  const coldRates = computeColdSideRates(events, 7)
  runColdTailHitRateTable(coldRates, 'Cold-tail-LOW bracket hit rate by distance (signedDist === -D)')

  const warmRates = computeWarmSideRates(events, 7)
  runWarmSideControlTable(warmRates)

  runEVTable(coldRates)

  const { passingCities } = runPerCity(events)

  const { worstDayLossAt20, worstDayLossAt50 } = runCorrelatedBlowup(events)

  runDecisionRules({ events, coldRates, passingCities, worstDayLossAt20, worstDayLossAt50 })

  printHeader('Caveats')
  console.log('- Low-temp data starts 2026-04-03; sample window is roughly 1 month, smaller than the high-market clean-era sample.')
  console.log('- LOW market source rankings are REVERSED from highs (memory: GW best 2.65°F MAE, NWS 4th 4.38°F). Bias direction may differ.')
  console.log('- Cold snaps are seasonal — May-October sample under-represents winter regime. Re-evaluate after first cold snap if deployed in paper.')
  console.log('- Position caps applied per production tailSellTracker.ts logic (MAX_PER_CITY_TYPE=2, MAX_NE_CORRIDOR=5, MAX_TOTAL=8).')
  console.log('- YES price bands assumed 5-20¢; cold-tail-LOW actual price distribution unverified without kalshi_market_snapshots join.')

  await closeClient()
}

main().catch(err => { console.error(err); process.exit(1) })
