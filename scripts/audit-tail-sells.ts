import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config()

import { getDb, closeClient } from '../src/lib/db/mongodb'

// ============================================================================
// Types
// ============================================================================

interface TailSellDoc {
  id: string
  signalType: string
  ticker: string
  eventTicker: string
  cityCode: string
  forecastF: number
  actualF: number | null
  bracketFloorF: number | null
  bracketCapF: number
  bracketDistance: number
  direction: string
  yesPrice: number
  noSellPrice: number
  expectedProfit: number
  leadHours: number
  spreadF: number
  confidence: string
  sourceCount: number
  result: string | null
  pnl: number | null
  positionSize: number
  timestamp: number
  resolvedAt: number | null
}

const NE_CORRIDOR = new Set(['BOS', 'NY', 'NYC', 'PHI', 'PHIL', 'DC'])

// ============================================================================
// Helpers
// ============================================================================

function pct(n: number, total: number): string {
  if (total === 0) return '  N/A'
  return `${(100 * n / total).toFixed(1)}%`
}

function printTable(headers: string[], rows: string[][], colWidths: number[]): void {
  const header = headers.map((h, i) => h.padEnd(colWidths[i])).join('  ')
  console.log(header)
  console.log(colWidths.map(w => '─'.repeat(w)).join('  '))
  for (const row of rows) {
    console.log(row.map((cell, i) => cell.padEnd(colWidths[i])).join('  '))
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const db = getDb()
  const col = db.collection<TailSellDoc>('tail_sell_signals')

  const all = await col.find().sort({ timestamp: -1 }).toArray()

  if (all.length === 0) {
    console.log('No tail sell signals found in database.')
    return
  }

  const pending = all.filter(r => r.result === 'pending')
  const resolved = all.filter(r => r.result === 'win' || r.result === 'loss')
  const wins = resolved.filter(r => r.result === 'win')
  const losses = resolved.filter(r => r.result === 'loss')

  // ════════════════════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════════════')
  console.log('  Analysis 1: Tail Sell Summary')
  console.log('═══════════════════════════════════════════════════════════════')

  const dateRange = all.length > 0
    ? `${new Date(all[all.length - 1].timestamp).toISOString().slice(0, 10)} to ${new Date(all[0].timestamp).toISOString().slice(0, 10)}`
    : 'N/A'
  console.log(`Data range: ${dateRange} | Total: ${all.length} | Pending: ${pending.length} | Resolved: ${resolved.length}\n`)

  const totalPnl = resolved.reduce((s, r) => s + (r.pnl ?? 0) * r.positionSize, 0)
  const avgPnl = resolved.length > 0 ? totalPnl / resolved.length : 0

  printTable(
    ['Metric', 'Value'],
    [
      ['Win Rate', resolved.length > 0 ? pct(wins.length, resolved.length) : 'N/A'],
      ['Wins', `${wins.length}`],
      ['Losses', `${losses.length}`],
      ['Total PnL', `$${totalPnl.toFixed(2)}`],
      ['Avg PnL/Signal', `$${avgPnl.toFixed(2)}`],
      ['Avg YES Price (wins)', wins.length > 0 ? `${(100 * wins.reduce((s, r) => s + r.yesPrice, 0) / wins.length).toFixed(1)}¢` : 'N/A'],
      ['Avg YES Price (losses)', losses.length > 0 ? `${(100 * losses.reduce((s, r) => s + r.yesPrice, 0) / losses.length).toFixed(1)}¢` : 'N/A'],
    ],
    [25, 15],
  )

  // ════════════════════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════════════')
  console.log('  Analysis 2: By Bracket Distance')
  console.log('═══════════════════════════════════════════════════════════════\n')

  const distMap = new Map<number, TailSellDoc[]>()
  for (const r of all) {
    const d = r.bracketDistance
    if (!distMap.has(d)) distMap.set(d, [])
    distMap.get(d)!.push(r)
  }

  const distRows: string[][] = []
  for (const [dist, docs] of Array.from(distMap.entries()).sort((a, b) => a[0] - b[0])) {
    const res = docs.filter(d => d.result === 'win' || d.result === 'loss')
    const w = res.filter(d => d.result === 'win').length
    const l = res.filter(d => d.result === 'loss').length
    const pnl = res.reduce((s, d) => s + (d.pnl ?? 0) * d.positionSize, 0)
    distRows.push([
      `±${dist}`,
      `${docs.length}`,
      `${res.length}`,
      `${w}`,
      `${l}`,
      res.length > 0 ? pct(w, res.length) : 'N/A',
      `$${pnl.toFixed(2)}`,
    ])
  }
  printTable(
    ['Distance', 'Total', 'Resolved', 'Wins', 'Losses', 'Win%', 'PnL'],
    distRows,
    [10, 8, 10, 8, 8, 8, 10],
  )

  // ════════════════════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════════════')
  console.log('  Analysis 3: By City')
  console.log('═══════════════════════════════════════════════════════════════\n')

  const cityMap = new Map<string, TailSellDoc[]>()
  for (const r of all) {
    if (!cityMap.has(r.cityCode)) cityMap.set(r.cityCode, [])
    cityMap.get(r.cityCode)!.push(r)
  }

  const cityRows: string[][] = []
  for (const [city, docs] of Array.from(cityMap.entries()).sort((a, b) => b[1].length - a[1].length)) {
    const res = docs.filter(d => d.result === 'win' || d.result === 'loss')
    const w = res.filter(d => d.result === 'win').length
    const l = res.filter(d => d.result === 'loss').length
    const pnl = res.reduce((s, d) => s + (d.pnl ?? 0) * d.positionSize, 0)
    const neFlag = NE_CORRIDOR.has(city) ? ' [NE]' : ''
    cityRows.push([
      `${city}${neFlag}`,
      `${docs.length}`,
      `${w}`,
      `${l}`,
      res.length > 0 ? pct(w, res.length) : 'N/A',
      `$${pnl.toFixed(2)}`,
    ])
  }
  printTable(
    ['City', 'Total', 'Wins', 'Losses', 'Win%', 'PnL'],
    cityRows,
    [14, 8, 8, 8, 8, 10],
  )

  // ════════════════════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════════════')
  console.log('  Analysis 4: Worst Single-Day Losses')
  console.log('═══════════════════════════════════════════════════════════════\n')

  const dayMap = new Map<string, TailSellDoc[]>()
  for (const r of losses) {
    const day = new Date(r.resolvedAt ?? r.timestamp).toISOString().slice(0, 10)
    if (!dayMap.has(day)) dayMap.set(day, [])
    dayMap.get(day)!.push(r)
  }

  const dayRows: string[][] = Array.from(dayMap.entries())
    .map(([day, docs]) => {
      const pnl = docs.reduce((s, d) => s + (d.pnl ?? 0) * d.positionSize, 0)
      const cities = Array.from(new Set(docs.map(d => d.cityCode))).join(', ')
      return { day, count: docs.length, pnl, cities }
    })
    .sort((a, b) => a.pnl - b.pnl)
    .slice(0, 10)
    .map(r => [r.day, `${r.count}`, `$${r.pnl.toFixed(2)}`, r.cities])

  if (dayRows.length > 0) {
    printTable(
      ['Date', 'Losses', 'PnL', 'Cities'],
      dayRows,
      [12, 8, 10, 40],
    )
  } else {
    console.log('No losses recorded yet.')
  }

  // ════════════════════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════════════')
  console.log('  Analysis 5: NE Corridor Correlation')
  console.log('═══════════════════════════════════════════════════════════════\n')

  // Group losses by resolution day and check NE corridor overlap
  const neLossDays = new Map<string, string[]>()
  for (const r of losses) {
    if (!NE_CORRIDOR.has(r.cityCode)) continue
    const day = new Date(r.resolvedAt ?? r.timestamp).toISOString().slice(0, 10)
    if (!neLossDays.has(day)) neLossDays.set(day, [])
    neLossDays.get(day)!.push(r.cityCode)
  }

  const multiNeDays = Array.from(neLossDays.entries())
    .filter(([, cities]) => new Set(cities).size >= 2)
    .sort((a, b) => b[1].length - a[1].length)

  if (multiNeDays.length > 0) {
    console.log(`Days with multi-city NE corridor losses: ${multiNeDays.length}`)
    for (const [day, cities] of multiNeDays.slice(0, 5)) {
      const uniqueCities = Array.from(new Set(cities))
      console.log(`  ${day}: ${cities.length} losses across ${uniqueCities.join(', ')}`)
    }
  } else {
    console.log('No multi-city NE corridor loss events recorded.')
  }

  // ════════════════════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════════════')
  console.log('  Analysis 6: Confidence Breakdown')
  console.log('═══════════════════════════════════════════════════════════════\n')

  for (const conf of ['high', 'medium'] as const) {
    const confDocs = resolved.filter(r => r.confidence === conf)
    const confWins = confDocs.filter(r => r.result === 'win').length
    const confPnl = confDocs.reduce((s, r) => s + (r.pnl ?? 0) * r.positionSize, 0)
    console.log(
      `${conf.toUpperCase().padEnd(8)} ${confDocs.length} resolved, ` +
      `${confWins}W/${confDocs.length - confWins}L ` +
      `(${confDocs.length > 0 ? pct(confWins, confDocs.length) : 'N/A'}), ` +
      `PnL: $${confPnl.toFixed(2)}`
    )
  }

  // ════════════════════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════════════')
  console.log('  Recent Signals (last 10)')
  console.log('═══════════════════════════════════════════════════════════════\n')

  const recent = all.slice(0, 10)
  for (const r of recent) {
    const date = new Date(r.timestamp).toISOString().slice(0, 16)
    const result = r.result === 'pending' ? '⏳' : r.result === 'win' ? '✅' : '❌'
    const pnlStr = r.pnl != null ? `$${(r.pnl * r.positionSize).toFixed(2)}` : '—'
    const bracketStr = r.bracketFloorF != null
      ? `[${r.bracketFloorF}-${r.bracketCapF}°F]`
      : `[≤${r.bracketCapF}°F]`
    console.log(
      `  ${result} ${date} ${r.cityCode.padEnd(4)} ±${r.bracketDistance} ` +
      `${bracketStr} YES=${(r.yesPrice * 100).toFixed(0)}¢ ` +
      `forecast=${r.forecastF.toFixed(1)}°F ${r.confidence} ${pnlStr}`
    )
  }

  console.log('')
}

main()
  .catch(console.error)
  .finally(() => closeClient())
