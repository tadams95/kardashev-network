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

interface SourceAccuracyDoc {
  source: string
  forecastTemp: number
  actualTemp: number
  error: number
  absError: number
  temperatureType?: string
  cityCode: string
  leadHours?: number
  timestamp: number
}

// ============================================================================
// Constants
// ============================================================================

const CLEAN_ERA_EPOCH = 1774051200000 // 2026-03-21T00:00Z

const LEAD_BUCKETS = ['≤6h', '6-12h', '12-18h', '18-24h', '24-36h', '36-48h', '48h+'] as const

// ============================================================================
// Helpers
// ============================================================================

function mean(arr: number[]): number {
  if (arr.length === 0) return 0
  return arr.reduce((s, v) => s + v, 0) / arr.length
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0
  const sorted = [...arr].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function rmse(errors: number[]): number {
  if (errors.length === 0) return 0
  return Math.sqrt(errors.reduce((s, e) => s + e * e, 0) / errors.length)
}

function pct(n: number, total: number): string {
  if (total === 0) return '0.0%'
  return ((n / total) * 100).toFixed(1) + '%'
}

function leadBucket(hours: number | undefined): string {
  if (hours == null || !isFinite(hours)) return '48h+'
  if (hours <= 6) return '≤6h'
  if (hours <= 12) return '6-12h'
  if (hours <= 18) return '12-18h'
  if (hours <= 24) return '18-24h'
  if (hours <= 36) return '24-36h'
  if (hours <= 48) return '36-48h'
  return '48h+'
}

function pad(s: string, width: number): string {
  return s.padEnd(width)
}

function padL(s: string, width: number): string {
  return s.padStart(width)
}

function printHeader(title: string): void {
  const line = '═'.repeat(65)
  console.log()
  console.log(line)
  console.log(`  ${title}`)
  console.log(line)
}

function printTable(headers: string[], rows: string[][], colWidths: number[]): void {
  // Header
  const headerLine = headers.map((h, i) => i === 0 ? pad(h, colWidths[i]) : padL(h, colWidths[i])).join('  ')
  console.log(headerLine)
  const divider = colWidths.map((w) => '─'.repeat(w)).join('  ')
  console.log(divider)
  // Rows
  for (const row of rows) {
    const line = row.map((cell, i) => i === 0 ? pad(cell, colWidths[i]) : padL(cell, colWidths[i])).join('  ')
    console.log(line)
  }
}

function formatDate(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10)
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const db = getDb()

  // ── Fetch data ──────────────────────────────────────────────────────

  const tempBiasDocs = await db.collection<TempBiasDoc>('temp_bias')
    .find({
      timestamp: { $gte: CLEAN_ERA_EPOCH },
      marketType: 'high',
      forecastTemp: { $type: 'number' },
      actualTemp: { $type: 'number' },
    } as any)
    .project({ forecastTemp: 1, actualTemp: 1, error: 1, leadHours: 1, cityCode: 1, marketType: 1, marketId: 1, timestamp: 1 })
    .toArray()

  const sourceAccDocs = await db.collection<SourceAccuracyDoc>('source_accuracy')
    .find({
      timestamp: { $gte: CLEAN_ERA_EPOCH },
      temperatureType: 'high',
      forecastTemp: { $type: 'number' },
      actualTemp: { $type: 'number' },
    } as any)
    .project({ source: 1, forecastTemp: 1, actualTemp: 1, error: 1, absError: 1, temperatureType: 1, cityCode: 1, leadHours: 1, timestamp: 1 })
    .toArray() as unknown as SourceAccuracyDoc[]

  console.log(`Fetched ${tempBiasDocs.length} temp_bias docs, ${sourceAccDocs.length} source_accuracy docs`)

  if (tempBiasDocs.length === 0) {
    console.log('No temp_bias data found for clean era. Exiting.')
    return
  }

  // Compute derived fields
  type Event = TempBiasDoc & { absError: number }
  const events: Event[] = tempBiasDocs.map(d => ({
    ...d,
    absError: Math.abs(d.error),
  } as Event))

  const absErrors = events.map(e => e.absError)
  const signedErrors = events.map(e => e.error)
  const minTs = Math.min(...events.map(e => e.timestamp))
  const maxTs = Math.max(...events.map(e => e.timestamp))

  // ══════════════════════════════════════════════════════════════════════
  // Analysis 1: Point Forecast Accuracy
  // ══════════════════════════════════════════════════════════════════════

  printHeader('Analysis 1: Point Forecast Accuracy (temp-high, clean era)')
  console.log(`Data range: ${formatDate(minTs)} to ${formatDate(maxTs)} | Events: ${events.length}`)
  console.log()

  const maeVal = mean(absErrors)
  const medianAE = median(absErrors)
  const rmseVal = rmse(signedErrors)
  const within1 = events.filter(e => e.absError <= 1).length
  const within2 = events.filter(e => e.absError <= 2).length
  const within3 = events.filter(e => e.absError <= 3).length
  const within5 = events.filter(e => e.absError <= 5).length
  const bias = mean(signedErrors)

  const metrics: [string, string][] = [
    ['MAE', `${maeVal.toFixed(2)}°F`],
    ['Median AE', `${medianAE.toFixed(2)}°F`],
    ['RMSE', `${rmseVal.toFixed(2)}°F`],
    ['Within 1°F', pct(within1, events.length)],
    ['Within 2°F', pct(within2, events.length)],
    ['Within 3°F', pct(within3, events.length)],
    ['Within 5°F', pct(within5, events.length)],
    ['Mean Signed Bias', `${bias >= 0 ? '+' : ''}${bias.toFixed(2)}°F ${bias > 0 ? '(hot)' : bias < 0 ? '(cold)' : ''}`],
  ]
  printTable(['Metric', 'Value'], metrics, [20, 20])

  // Worst 10 misses
  console.log()
  console.log('Worst 10 misses:')
  const worst = [...events].sort((a, b) => b.absError - a.absError).slice(0, 10)
  printTable(
    ['City', 'Date', 'Forecast', 'Actual', 'Error', 'Lead'],
    worst.map(e => [
      e.cityCode,
      formatDate(e.timestamp),
      `${e.forecastTemp.toFixed(1)}°F`,
      `${e.actualTemp.toFixed(1)}°F`,
      `${e.error >= 0 ? '+' : ''}${e.error.toFixed(1)}°F`,
      e.leadHours != null ? `${e.leadHours}h` : '?',
    ]),
    [8, 12, 10, 10, 10, 6],
  )

  // ══════════════════════════════════════════════════════════════════════
  // Analysis 2: By Lead Time
  // ══════════════════════════════════════════════════════════════════════

  printHeader('Analysis 2: Accuracy by Lead Time')

  const byLead = new Map<string, typeof events>()
  for (const e of events) {
    const bucket = leadBucket(e.leadHours)
    const arr = byLead.get(bucket) || []
    arr.push(e)
    byLead.set(bucket, arr)
  }

  const leadRows: string[][] = []
  for (const bucket of LEAD_BUCKETS) {
    const group = byLead.get(bucket)
    if (!group || group.length === 0) {
      leadRows.push([bucket, '0', '-', '-', '-', '-'])
      continue
    }
    const ae = group.map(e => e.absError)
    const w2 = group.filter(e => e.absError <= 2).length
    const w3 = group.filter(e => e.absError <= 3).length
    const b = mean(group.map(e => e.error))
    leadRows.push([
      bucket,
      String(group.length),
      mean(ae).toFixed(2),
      pct(w2, group.length),
      pct(w3, group.length),
      `${b >= 0 ? '+' : ''}${b.toFixed(2)}`,
    ])
  }
  printTable(['Bucket', 'N', 'MAE', '≤2°F', '≤3°F', 'Bias'], leadRows, [10, 6, 8, 8, 8, 8])

  // ══════════════════════════════════════════════════════════════════════
  // Analysis 3: By City
  // ══════════════════════════════════════════════════════════════════════

  printHeader('Analysis 3: Accuracy by City')

  const byCity = new Map<string, typeof events>()
  for (const e of events) {
    const arr = byCity.get(e.cityCode) || []
    arr.push(e)
    byCity.set(e.cityCode, arr)
  }

  const cityRows: string[][] = []
  for (const [city, group] of [...byCity.entries()].sort((a, b) => mean(a[1].map(e => e.absError)) - mean(b[1].map(e => e.absError)))) {
    const ae = group.map(e => e.absError)
    const w2 = group.filter(e => e.absError <= 2).length
    const w3 = group.filter(e => e.absError <= 3).length
    const b = mean(group.map(e => e.error))
    cityRows.push([
      city,
      String(group.length),
      mean(ae).toFixed(2),
      pct(w2, group.length),
      pct(w3, group.length),
      `${b >= 0 ? '+' : ''}${b.toFixed(2)}`,
    ])
  }
  printTable(['City', 'N', 'MAE', '≤2°F', '≤3°F', 'Bias'], cityRows, [10, 6, 8, 8, 8, 8])

  // ══════════════════════════════════════════════════════════════════════
  // Analysis 4: Bracket Hit Rate (2°F bins)
  // ══════════════════════════════════════════════════════════════════════

  printHeader('Analysis 4: Bracket Hit Rate (2°F bins)')

  const bracketOf = (temp: number) => Math.floor(temp / 2) * 2
  const bracketDists = events.map(e => Math.abs(bracketOf(e.forecastTemp) - bracketOf(e.actualTemp)) / 2)
  const exactHit = bracketDists.filter(d => d === 0).length
  const within1b = bracketDists.filter(d => d <= 1).length
  const within2b = bracketDists.filter(d => d <= 2).length

  const bracketMetrics: [string, string][] = [
    ['Exact bracket (±0)', pct(exactHit, events.length)],
    ['±1 bracket (≤2°F)', pct(within1b, events.length)],
    ['±2 brackets (≤4°F)', pct(within2b, events.length)],
  ]
  printTable(['Metric', 'Rate'], bracketMetrics, [24, 10])

  // ══════════════════════════════════════════════════════════════════════
  // Analysis 5: Tail Distance Analysis
  // ══════════════════════════════════════════════════════════════════════

  printHeader('Analysis 5: Tail Distance Analysis')

  // Part A — Bracket-distance bins
  console.log('Part A — Bracket-distance distribution:')
  const distBins = [
    { label: '±0 (0-2°F)', min: 0, max: 0 },
    { label: '±1 (2-4°F)', min: 1, max: 1 },
    { label: '±2 (4-6°F)', min: 2, max: 2 },
    { label: '±3 (6-8°F)', min: 3, max: 3 },
    { label: '±4 (8-10°F)', min: 4, max: 4 },
    { label: '±5+ (10°F+)', min: 5, max: Infinity },
  ]

  const distRows: string[][] = []
  for (const bin of distBins) {
    const count = bracketDists.filter(d => d >= bin.min && d <= bin.max).length
    const atOrFarther = bracketDists.filter(d => d >= bin.min).length
    distRows.push([
      bin.label,
      String(count),
      pct(count, events.length),
      pct(atOrFarther, events.length),
    ])
  }
  printTable(['Distance', 'N', '%', '≥ this'], distRows, [16, 6, 8, 10])

  // Part B — Continuous thresholds
  console.log()
  console.log('Part B — Continuous error thresholds:')
  const thresholds = [2, 3, 5, 7, 10, 15]
  const threshRows: string[][] = []
  for (const t of thresholds) {
    const count = events.filter(e => e.absError > t).length
    threshRows.push([`|error| > ${t}°F`, String(count), pct(count, events.length)])
  }
  printTable(['Threshold', 'N', '%'], threshRows, [16, 6, 8])

  // Part C — Cross-tab: bracket distance by lead time
  console.log()
  console.log('Part C — Bracket distance by lead time (% at ±2+ brackets):')
  const crossRows: string[][] = []
  for (const bucket of LEAD_BUCKETS) {
    const group = byLead.get(bucket)
    if (!group || group.length === 0) {
      crossRows.push([bucket, '0', '-', '-', '-'])
      continue
    }
    const gDists = group.map(e => Math.abs(bracketOf(e.forecastTemp) - bracketOf(e.actualTemp)) / 2)
    const exact = gDists.filter(d => d === 0).length
    const w1 = gDists.filter(d => d <= 1).length
    const far = gDists.filter(d => d >= 2).length
    crossRows.push([
      bucket,
      String(group.length),
      pct(exact, group.length),
      pct(w1, group.length),
      pct(far, group.length),
    ])
  }
  printTable(['Bucket', 'N', '±0', '≤±1', '≥±2'], crossRows, [10, 6, 8, 8, 8])

  // ══════════════════════════════════════════════════════════════════════
  // Analysis 6: Per-Source Comparison
  // ══════════════════════════════════════════════════════════════════════

  printHeader('Analysis 6: Per-Source Comparison')

  if (sourceAccDocs.length === 0) {
    console.log('No source_accuracy data found for clean era.')
  } else {
    const bySource = new Map<string, SourceAccuracyDoc[]>()
    for (const doc of sourceAccDocs) {
      const arr = bySource.get(doc.source) || []
      arr.push(doc)
      bySource.set(doc.source, arr)
    }

    const sourceRows: string[][] = []
    const ensembleMAE = maeVal

    for (const [source, docs] of [...bySource.entries()].sort((a, b) => mean(a[1].map(d => Math.abs(d.error))) - mean(b[1].map(d => Math.abs(d.error))))) {
      const ae = docs.map(d => Math.abs(d.error))
      const sourceMae = mean(ae)
      const w2 = docs.filter(d => Math.abs(d.error) <= 2).length
      const b = mean(docs.map(d => d.error))
      const delta = sourceMae - ensembleMAE
      sourceRows.push([
        source,
        String(docs.length),
        sourceMae.toFixed(2),
        pct(w2, docs.length),
        `${b >= 0 ? '+' : ''}${b.toFixed(2)}`,
        `${delta >= 0 ? '+' : ''}${delta.toFixed(2)}`,
      ])
    }

    console.log(`Ensemble MAE (from Analysis 1): ${ensembleMAE.toFixed(2)}°F`)
    console.log()
    printTable(
      ['Source', 'N', 'MAE', '≤2°F', 'Bias', 'vs Ens'],
      sourceRows,
      [16, 6, 8, 8, 8, 8],
    )
  }

  // ── Summary ─────────────────────────────────────────────────────────

  printHeader('Summary')
  console.log(`Total ensemble events: ${events.length}`)
  console.log(`Total source_accuracy events: ${sourceAccDocs.length}`)
  console.log(`Date range: ${formatDate(minTs)} → ${formatDate(maxTs)}`)
  console.log(`Ensemble MAE: ${maeVal.toFixed(2)}°F | RMSE: ${rmseVal.toFixed(2)}°F | Bias: ${bias >= 0 ? '+' : ''}${bias.toFixed(2)}°F`)
  console.log(`Bracket hit rate: ${pct(exactHit, events.length)} exact, ${pct(within1b, events.length)} ±1`)
  console.log()
}

main()
  .then(() => closeClient())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[audit-forecast-accuracy] Fatal:', err)
    closeClient().finally(() => process.exit(1))
  })
