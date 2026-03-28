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

// ============================================================================
// Constants
// ============================================================================

const CLEAN_ERA_EPOCH = 1774051200000 // 2026-03-21T00:00Z
const FEE_PER_CONTRACT = 0.018 // $0.018 per $1 contract (1.8%)

// ============================================================================
// Helpers
// ============================================================================

function pad(s: string, w: number): string { return s.padEnd(w) }
function padL(s: string, w: number): string { return s.padStart(w) }

function printHeader(title: string): void {
  const line = '═'.repeat(70)
  console.log()
  console.log(line)
  console.log(`  ${title}`)
  console.log(line)
}

function printTable(headers: string[], rows: string[][], colWidths: number[]): void {
  const headerLine = headers.map((h, i) => i === 0 ? pad(h, colWidths[i]) : padL(h, colWidths[i])).join('  ')
  console.log(headerLine)
  console.log(colWidths.map(w => '─'.repeat(w)).join('  '))
  for (const row of rows) {
    console.log(row.map((cell, i) => i === 0 ? pad(cell, colWidths[i]) : padL(cell, colWidths[i])).join('  '))
  }
}

function pct(n: number, total: number): string {
  if (total === 0) return '0.0%'
  return ((n / total) * 100).toFixed(1) + '%'
}

function bracketOf(temp: number): number {
  return Math.floor(temp / 2) * 2
}

function bracketDist(forecastTemp: number, actualTemp: number): number {
  return Math.abs(bracketOf(forecastTemp) - bracketOf(actualTemp)) / 2
}

// Signed bracket distance: positive = actual was WARMER than forecast
function signedBracketDist(forecastTemp: number, actualTemp: number): number {
  return (bracketOf(actualTemp) - bracketOf(forecastTemp)) / 2
}

function formatDate(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10)
}

type Event = TempBiasDoc & { absError: number; dist: number; signedDist: number }

// ============================================================================
// Analysis Functions
// ============================================================================

function runLandingRate(events: Event[], label: string): Map<number, { count: number; pct: number; tailPct: number }> {
  printHeader(`${label}`)
  console.log(`Events: ${events.length}`)
  console.log()

  const maxDist = 7
  const distCounts = new Map<number, number>()
  for (let d = 0; d <= maxDist; d++) distCounts.set(d, 0)

  for (const e of events) {
    const d = Math.min(e.dist, maxDist)
    distCounts.set(d, (distCounts.get(d) || 0) + 1)
  }

  const result = new Map<number, { count: number; pct: number; tailPct: number }>()
  let cumFromTop = events.length

  const rows: string[][] = []
  for (let d = 0; d <= maxDist; d++) {
    const count = distCounts.get(d) || 0
    const p = count / events.length
    const tailP = cumFromTop / events.length
    result.set(d, { count, pct: p, tailPct: tailP })

    rows.push([
      d < maxDist ? `±${d}` : `±${maxDist}+`,
      String(count),
      pct(count, events.length),
      (tailP * 100).toFixed(1) + '%',
    ])
    cumFromTop -= count
  }

  printTable(['Distance', 'Events', '% of total', 'Cum tail %'], rows, [10, 8, 12, 12])
  return result
}

function runDirectionalSplit(events: Event[]): void {
  printHeader('Analysis 3: Directional Split (Cold vs Warm Side)')
  console.log(`Events: ${events.length} | Model cold bias: forecast runs cold → actual is often WARMER`)
  console.log()

  const maxDist = 7
  const cold = new Map<number, number>()  // actual BELOW forecast (signedDist < 0)
  const warm = new Map<number, number>()  // actual ABOVE forecast (signedDist > 0)
  for (let d = 0; d <= maxDist; d++) { cold.set(d, 0); warm.set(d, 0) }

  for (const e of events) {
    const absDist = Math.min(e.dist, maxDist)
    if (e.signedDist < 0) {
      cold.set(absDist, (cold.get(absDist) || 0) + 1)
    } else if (e.signedDist > 0) {
      warm.set(absDist, (warm.get(absDist) || 0) + 1)
    }
    // signedDist === 0 means same bracket, no directional info
  }

  const rows: string[][] = []
  for (let d = 0; d <= maxDist; d++) {
    const c = cold.get(d) || 0
    const w = warm.get(d) || 0
    const total = c + w
    rows.push([
      d < maxDist ? `±${d}` : `±${maxDist}+`,
      String(c),
      total > 0 ? pct(c, total) : '-',
      String(w),
      total > 0 ? pct(w, total) : '-',
      String(total),
    ])
  }

  printTable(
    ['Distance', 'Cold', 'Cold %', 'Warm', 'Warm %', 'Total'],
    rows,
    [10, 6, 8, 6, 8, 6],
  )

  // Cumulative tail by direction
  console.log()
  console.log('Cumulative tail rate by direction (% of ALL events at distance ≥ D):')
  let coldCum = 0, warmCum = 0
  // Count total cold/warm at each distance for cumulative from far end
  const coldArr: number[] = [], warmArr: number[] = []
  for (let d = 0; d <= maxDist; d++) {
    coldArr.push(cold.get(d) || 0)
    warmArr.push(warm.get(d) || 0)
  }
  // Cumulative from the right (far distances)
  const coldTail: number[] = new Array(maxDist + 1).fill(0)
  const warmTail: number[] = new Array(maxDist + 1).fill(0)
  for (let d = maxDist; d >= 0; d--) {
    coldCum += coldArr[d]
    warmCum += warmArr[d]
    coldTail[d] = coldCum
    warmTail[d] = warmCum
  }

  const tailRows: string[][] = []
  for (let d = 1; d <= maxDist; d++) {
    tailRows.push([
      d < maxDist ? `≥±${d}` : `≥±${maxDist}+`,
      String(coldTail[d]),
      pct(coldTail[d], events.length),
      String(warmTail[d]),
      pct(warmTail[d], events.length),
    ])
  }
  printTable(
    ['Distance', 'Cold N', 'Cold %', 'Warm N', 'Warm %'],
    tailRows,
    [10, 8, 8, 8, 8],
  )
}

function runEVTable(
  rates: Map<number, { count: number; pct: number; tailPct: number }>,
  totalEvents: number,
  label: string,
): void {
  printHeader(label)
  console.log(`Fee per contract: $${FEE_PER_CONTRACT.toFixed(3)}`)
  console.log(`Tail sell = selling NO at (1 - YES_price), profit if bracket does NOT hit`)
  console.log()

  // For a bracket at distance D from forecast:
  //   hit_rate = rate.pct (probability actual lands in EXACTLY this bracket)
  //   miss_rate = 1 - hit_rate
  //   Selling NO at (1 - YES_price):
  //     Win: collect YES_price (the NO seller's profit when YES expires worthless)
  //     Lose: pay (1 - YES_price) (the NO seller's loss when YES resolves to $1)
  //   EV = miss_rate * YES_price - hit_rate * (1 - YES_price) - fee

  const distances = [2, 3, 4, 5]
  const yesPrices = [0.03, 0.05, 0.08, 0.10, 0.15, 0.20]

  const headers = ['Distance', ...yesPrices.map(p => `YES=${Math.round(p * 100)}¢`)]
  const colWidths = [10, ...yesPrices.map(() => 10)]

  const rows: string[][] = []
  for (const d of distances) {
    const rateInfo = rates.get(d)
    const hitRate = rateInfo ? rateInfo.pct : 0
    const missRate = 1 - hitRate

    const cells: string[] = [`±${d} (${(hitRate * 100).toFixed(1)}%)`]
    for (const yesPrice of yesPrices) {
      const ev = missRate * yesPrice - hitRate * (1 - yesPrice) - FEE_PER_CONTRACT
      const evStr = (ev >= 0 ? '+' : '') + ev.toFixed(3)
      cells.push(ev >= 0 ? `${evStr} ✓` : evStr)
    }
    rows.push(cells)
  }

  printTable(headers, rows, colWidths)

  // Also show the breakeven YES price for each distance
  console.log()
  console.log('Breakeven YES price (EV = 0 before fees):')
  for (const d of distances) {
    const rateInfo = rates.get(d)
    const hitRate = rateInfo ? rateInfo.pct : 0
    // EV = (1-h)*p - h*(1-p) - fee = 0
    // (1-h)*p - h + h*p - fee = 0
    // p - h*p - h + h*p - fee = 0
    // p - h - fee = 0
    // p = h + fee
    const breakeven = hitRate + FEE_PER_CONTRACT
    console.log(`  ±${d}: hit rate ${(hitRate * 100).toFixed(1)}% → breakeven at YES = ${(breakeven * 100).toFixed(1)}¢ (sell NO above ${((1 - breakeven) * 100).toFixed(1)}¢)`)
  }
}

function runWorstCase(events: Event[]): void {
  printHeader('Analysis 6: Worst Case Scenario Analysis')

  // Worst single events
  const sorted = [...events].sort((a, b) => b.absError - a.absError)
  console.log('Top 10 worst single-event misses:')
  printTable(
    ['City', 'Date', 'Error', 'Brackets', 'Lead'],
    sorted.slice(0, 10).map(e => [
      e.cityCode,
      formatDate(e.timestamp),
      `${e.error >= 0 ? '+' : ''}${e.error.toFixed(1)}°F`,
      `±${e.dist}`,
      e.leadHours != null ? `${e.leadHours.toFixed(0)}h` : '?',
    ]),
    [8, 12, 10, 10, 6],
  )

  // Events with > 5°F error
  const badMisses = events.filter(e => e.absError > 5)
  console.log()
  console.log(`Events with |error| > 5°F: ${badMisses.length} (${pct(badMisses.length, events.length)} of all)`)
  if (badMisses.length > 0) {
    console.log()
    console.log('Bracket distance distribution of > 5°F misses:')
    const distCounts = new Map<number, number>()
    for (const e of badMisses) {
      const d = e.dist
      distCounts.set(d, (distCounts.get(d) || 0) + 1)
    }
    for (const [d, count] of [...distCounts.entries()].sort((a, b) => a[0] - b[0])) {
      console.log(`  ±${d} brackets: ${count} events`)
    }

    // City concentration
    console.log()
    console.log('City concentration of > 5°F misses:')
    const cityCounts = new Map<string, number>()
    for (const e of badMisses) {
      cityCounts.set(e.cityCode, (cityCounts.get(e.cityCode) || 0) + 1)
    }
    for (const [city, count] of [...cityCounts.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${city}: ${count} events`)
    }

    // Date concentration
    console.log()
    console.log('Date concentration of > 5°F misses:')
    const dateCounts = new Map<string, number>()
    for (const e of badMisses) {
      const date = formatDate(e.timestamp)
      dateCounts.set(date, (dateCounts.get(date) || 0) + 1)
    }
    for (const [date, count] of [...dateCounts.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${date}: ${count} events`)
    }
  }

  // Correlated blowup scenario
  console.log()
  console.log('Correlated blowup risk:')
  console.log('If selling NO on ±4+ brackets across 10 cities simultaneously:')
  const dist4plus = events.filter(e => e.dist >= 4)
  // Group by date
  const byDate = new Map<string, Event[]>()
  for (const e of dist4plus) {
    const date = formatDate(e.timestamp)
    const arr = byDate.get(date) || []
    arr.push(e)
    byDate.set(date, arr)
  }
  const worstDay = [...byDate.entries()].sort((a, b) => b[1].length - a[1].length)[0]
  if (worstDay) {
    console.log(`  Worst single day: ${worstDay[0]} with ${worstDay[1].length} events at ±4+ brackets`)
    console.log(`  Cities affected: ${[...new Set(worstDay[1].map(e => e.cityCode))].join(', ')}`)
  } else {
    console.log('  No events at ±4+ brackets in clean era')
  }
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const db = getDb()

  const tempBiasDocs = await db.collection<TempBiasDoc>('temp_bias')
    .find({
      timestamp: { $gte: CLEAN_ERA_EPOCH },
      marketType: 'high',
      forecastTemp: { $type: 'number' },
      actualTemp: { $type: 'number' },
    } as any)
    .project({ forecastTemp: 1, actualTemp: 1, error: 1, leadHours: 1, cityCode: 1, marketType: 1, marketId: 1, timestamp: 1 })
    .toArray()

  console.log(`Fetched ${tempBiasDocs.length} clean-era temp_bias docs (high only)`)

  if (tempBiasDocs.length === 0) {
    console.log('No data. Exiting.')
    return
  }

  const events: Event[] = tempBiasDocs.map(d => ({
    ...d,
    absError: Math.abs(d.error),
    dist: bracketDist(d.forecastTemp, d.actualTemp),
    signedDist: signedBracketDist(d.forecastTemp, d.actualTemp),
  } as Event))

  // ═══ Analysis 1 ═══
  const globalRates = runLandingRate(events, 'Analysis 1: Per-Bracket Landing Rate by Distance (All Events)')

  // ═══ Analysis 2 ═══
  let sweetSpotEvents = events.filter(e => e.leadHours != null && e.leadHours >= 24 && e.leadHours <= 36)
  let sweetSpotLabel = '24-36h'
  if (sweetSpotEvents.length < 50) {
    sweetSpotEvents = events.filter(e => e.leadHours != null && e.leadHours >= 18 && e.leadHours <= 36)
    sweetSpotLabel = '18-36h (expanded, 24-36h had < 50 events)'
  }
  const sweetSpotRates = runLandingRate(
    sweetSpotEvents,
    `Analysis 2: Per-Bracket Landing Rate — ${sweetSpotLabel} Lead Time`,
  )

  // ═══ Analysis 3 ═══
  runDirectionalSplit(events)

  // ═══ Analysis 4 ═══
  runEVTable(globalRates, events.length, 'Analysis 4: EV Table — All Events')

  // ═══ Analysis 5 ═══
  runEVTable(sweetSpotRates, sweetSpotEvents.length, `Analysis 5: EV Table — ${sweetSpotLabel} Lead Time`)

  // ═══ Analysis 6 ═══
  runWorstCase(events)

  // ═══ Summary ═══
  printHeader('Summary')
  console.log(`Total events: ${events.length}`)
  console.log(`Sweet spot events (${sweetSpotLabel}): ${sweetSpotEvents.length}`)
  console.log(`Fee assumed: $${FEE_PER_CONTRACT.toFixed(3)}/contract`)
  console.log()

  // Quick summary of profitable zones
  console.log('Profitable zones (EV > 0):')
  const distances = [2, 3, 4, 5]
  const yesPrices = [0.03, 0.05, 0.08, 0.10, 0.15, 0.20]
  for (const d of distances) {
    const rateInfo = globalRates.get(d)
    const hitRate = rateInfo ? rateInfo.pct : 0
    const missRate = 1 - hitRate
    const profitable = yesPrices.filter(p => {
      const ev = missRate * p - hitRate * (1 - p) - FEE_PER_CONTRACT
      return ev > 0
    })
    if (profitable.length > 0) {
      console.log(`  ±${d} brackets: profitable at YES ≥ ${Math.round(profitable[0] * 100)}¢`)
    } else {
      console.log(`  ±${d} brackets: NOT profitable at tested prices`)
    }
  }
  console.log()
}

main()
  .then(() => closeClient())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[audit-tail-sell-ev] Fatal:', err)
    closeClient().finally(() => process.exit(1))
  })
