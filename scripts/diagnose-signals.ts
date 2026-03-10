import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config()

import { getDb, closeClient } from '../src/lib/db/mongodb'
import { extractCityCode } from '../src/lib/utils/tickerParsing'

interface SignalDoc {
  _id: unknown
  id?: string
  marketId: string
  modelProbability: number
  marketPrice: number
  direction?: 'YES' | 'NO'
  signal?: string
  outcome?: boolean
  cityCode?: string
  temperatureType?: string
  forecastTemp?: number
  actualTemp?: number
  hoursToResolution?: number
  edge?: number
  timestamp: number
  resolvedAt?: number
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

function dateStr(ts: number): string {
  return new Date(ts).toISOString().slice(0, 16).replace('T', ' ')
}

async function main(): Promise<void> {
  const db = getDb()
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000

  const docs = await db.collection<SignalDoc>('signals')
    .find({
      outcome: { $exists: true },
      signal: { $nin: ['HOLD'] },
      timestamp: { $gte: cutoff },
    })
    .sort({ timestamp: 1 })
    .toArray()

  console.log(`\n=== RESOLVED NON-HOLD SIGNALS (last 30 days) ===`)
  console.log(`Total: ${docs.length}\n`)

  if (docs.length === 0) {
    console.log('No resolved signals found.')
    return
  }

  // Per-signal detail dump
  console.log('--- Per-Signal Detail ---')
  console.log(
    'idx'.padStart(3) + '  ' +
    'date'.padEnd(16) + '  ' +
    'marketId'.padEnd(35) + '  ' +
    'city'.padEnd(5) + '  ' +
    'type'.padEnd(4) + '  ' +
    'dir'.padEnd(3) + '  ' +
    'modelP'.padEnd(6) + '  ' +
    'mktP'.padEnd(6) + '  ' +
    'edge'.padEnd(6) + '  ' +
    'outcome'.padEnd(7) + '  ' +
    'won'
  )

  for (let i = 0; i < docs.length; i++) {
    const s = docs[i]
    const derivedDir = s.modelProbability > s.marketPrice ? 'YES' : 'NO'
    const storedDir = s.direction || derivedDir
    const won = storedDir === 'YES' ? s.outcome === true : s.outcome === false
    const derivedCity = extractCityCode(s.marketId)

    console.log(
      String(i + 1).padStart(3) + '  ' +
      dateStr(s.timestamp).padEnd(16) + '  ' +
      s.marketId.slice(0, 35).padEnd(35) + '  ' +
      (s.cityCode || derivedCity || '???').padEnd(5) + '  ' +
      (s.temperatureType || '?').slice(0, 4).padEnd(4) + '  ' +
      storedDir.padEnd(3) + '  ' +
      s.modelProbability.toFixed(3).padEnd(6) + '  ' +
      s.marketPrice.toFixed(3).padEnd(6) + '  ' +
      (s.edge ?? Math.abs(s.modelProbability - s.marketPrice)).toFixed(3).padEnd(6) + '  ' +
      String(s.outcome).padEnd(7) + '  ' +
      (won ? 'WIN' : 'LOSS')
    )
  }

  // === YES/NO Breakdown ===
  console.log('\n--- YES/NO Direction Breakdown ---')
  const yesBets = docs.filter(s => {
    const dir = s.direction || (s.modelProbability > s.marketPrice ? 'YES' : 'NO')
    return dir === 'YES'
  })
  const noBets = docs.filter(s => {
    const dir = s.direction || (s.modelProbability > s.marketPrice ? 'YES' : 'NO')
    return dir === 'NO'
  })

  const yesWins = yesBets.filter(s => s.outcome === true).length
  const noWins = noBets.filter(s => s.outcome === false).length

  console.log(`YES bets: ${yesBets.length} (won ${yesWins}, lost ${yesBets.length - yesWins}) — win rate ${yesBets.length > 0 ? pct(yesWins / yesBets.length) : 'N/A'}`)
  console.log(`NO  bets: ${noBets.length} (won ${noWins}, lost ${noBets.length - noWins}) — win rate ${noBets.length > 0 ? pct(noWins / noBets.length) : 'N/A'}`)

  // Average model probability by direction
  if (yesBets.length > 0) {
    const avgModelP = yesBets.reduce((s, d) => s + d.modelProbability, 0) / yesBets.length
    const avgMktP = yesBets.reduce((s, d) => s + d.marketPrice, 0) / yesBets.length
    console.log(`  YES avg modelProb=${avgModelP.toFixed(3)}, avg marketPrice=${avgMktP.toFixed(3)}, avg edge=${(avgModelP - avgMktP).toFixed(3)}`)
  }
  if (noBets.length > 0) {
    const avgModelP = noBets.reduce((s, d) => s + d.modelProbability, 0) / noBets.length
    const avgMktP = noBets.reduce((s, d) => s + d.marketPrice, 0) / noBets.length
    console.log(`  NO  avg modelProb=${avgModelP.toFixed(3)}, avg marketPrice=${avgMktP.toFixed(3)}, avg edge=${Math.abs(avgModelP - avgMktP).toFixed(3)}`)
  }

  // === Outcome Distribution ===
  console.log('\n--- Outcome Distribution ---')
  const outcomeTrue = docs.filter(s => s.outcome === true).length
  const outcomeFalse = docs.filter(s => s.outcome === false).length
  console.log(`Market resolved YES (outcome=true):  ${outcomeTrue}`)
  console.log(`Market resolved NO  (outcome=false): ${outcomeFalse}`)

  // === Direction Consistency ===
  console.log('\n--- Direction Consistency ---')
  let dirMismatch = 0
  let dirMissing = 0
  for (const s of docs) {
    const derived = s.modelProbability > s.marketPrice ? 'YES' : 'NO'
    if (!s.direction) {
      dirMissing++
    } else if (s.direction !== derived) {
      dirMismatch++
      console.log(`  MISMATCH: ${s.marketId} stored=${s.direction} derived=${derived} modelP=${s.modelProbability.toFixed(3)} mktP=${s.marketPrice.toFixed(3)}`)
    }
  }
  console.log(`Stored direction missing: ${dirMissing}`)
  console.log(`Stored vs derived mismatch: ${dirMismatch}`)

  // === CityCode Status ===
  console.log('\n--- CityCode Status ---')
  const withCity = docs.filter(s => s.cityCode).length
  const withoutCity = docs.filter(s => !s.cityCode).length
  const derivable = docs.filter(s => !s.cityCode && extractCityCode(s.marketId)).length
  console.log(`Has cityCode: ${withCity}`)
  console.log(`Missing cityCode: ${withoutCity} (${derivable} derivable from marketId)`)

  if (withoutCity > 0) {
    const sample = docs.filter(s => !s.cityCode).slice(0, 5)
    for (const s of sample) {
      console.log(`  marketId=${s.marketId} → extractCityCode=${extractCityCode(s.marketId) || 'null'}`)
    }
  }

  // === City Distribution ===
  console.log('\n--- City Distribution ---')
  const cityMap = new Map<string, number>()
  for (const s of docs) {
    const city = s.cityCode || extractCityCode(s.marketId) || 'unknown'
    cityMap.set(city, (cityMap.get(city) || 0) + 1)
  }
  for (const [city, count] of [...cityMap.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${city}: ${count}`)
  }

  // === Market Type Distribution ===
  console.log('\n--- Market Type (temperatureType) ---')
  const typeMap = new Map<string, number>()
  for (const s of docs) {
    typeMap.set(s.temperatureType || 'unknown', (typeMap.get(s.temperatureType || 'unknown') || 0) + 1)
  }
  for (const [type, count] of [...typeMap.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type}: ${count}`)
  }

  // === Ticker Prefix Analysis ===
  console.log('\n--- Ticker Prefix Analysis ---')
  const prefixMap = new Map<string, number>()
  for (const s of docs) {
    // Extract series prefix from ticker (e.g., KXHIGHTATL-26MAR04-B77.5 → KXHIGHT)
    const match = s.marketId.match(/^(KX[A-Z]+?)(?:NY|CHI|ATL|LA|SF|DAL|HOU|PHX|SEA|BOS|DEN|MIA|AUS|PHI|DC|LV|NYC|LAX|SFO|PHIL)/i)
    const prefix = match ? match[1] : s.marketId.slice(0, 7)
    prefixMap.set(prefix, (prefixMap.get(prefix) || 0) + 1)
  }
  for (const [prefix, count] of [...prefixMap.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${prefix}: ${count}`)
  }

  // === Time Distribution ===
  console.log('\n--- Date Distribution ---')
  const dateMap = new Map<string, number>()
  for (const s of docs) {
    const d = new Date(s.timestamp).toISOString().slice(0, 10)
    dateMap.set(d, (dateMap.get(d) || 0) + 1)
  }
  for (const [date, count] of [...dateMap.entries()].sort()) {
    console.log(`  ${date}: ${count}`)
  }

  // === Model Probability Distribution ===
  console.log('\n--- Model Probability Distribution ---')
  const probBuckets = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0001]
  for (let i = 0; i < probBuckets.length - 1; i++) {
    const lo = probBuckets[i]
    const hi = probBuckets[i + 1]
    const count = docs.filter(s => s.modelProbability >= lo && s.modelProbability < hi).length
    if (count > 0) {
      console.log(`  ${pct(lo).padStart(5)}-${pct(Math.min(hi, 1)).padStart(5)}: ${count}`)
    }
  }
}

main()
  .then(() => closeClient())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[diagnose-signals] Fatal:', err)
    closeClient().finally(() => process.exit(1))
  })
