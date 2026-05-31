/**
 * Atmospheric Phase 0 — Stage 1 pooled univariate EDA (read-only).
 *
 * Tests H1: does each source's Tmax/Tmin forecast residual correlate with
 * Open-Meteo's peak-hour atmospheric covariates captured in
 * `source_prediction_snapshots.perSourceAtmosphere['Open-Meteo']`?
 *
 * Join: source_accuracy (per-source residual `error`) × snapshot (by signalId)
 *       → OM atm covariate. Pearson r per (residual-source × OM covariate).
 *
 * Dry-run for the 2026-06-02 Stage 1 interim review. Pooled (high+low) —
 * stratified analysis is Stage 2. Significance is normal-approx (|t|>2.58 ≈
 * p<0.01 for large n); exact p deferred to the formal review write-up.
 *
 * Usage: npx tsx --tsconfig tsconfig.json scripts/atm-stage1-eda.ts
 */
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config()

import { getDb, closeClient } from '../src/lib/db/mongodb'

const DEPLOY_EPOCH = Date.parse('2026-05-03T00:00:00Z')
const POWER_TARGET = 350 // per-source n for r=0.15 @ p<0.01, 80% power
const COVARIATES = ['humidity', 'windSpeed', 'windGust', 'uvIndex', 'pressure', 'cloudCover', 'dewPoint']
const SOURCES = ['NWS', 'Open-Meteo', 'Google-Weather', 'AccuWeather', 'Tomorrow.io']

function pearson(pairs: Array<[number, number]>): { r: number; n: number; t: number } {
  const n = pairs.length
  if (n < 3) return { r: NaN, n, t: NaN }
  let sx = 0, sy = 0
  for (const [x, y] of pairs) { sx += x; sy += y }
  const mx = sx / n, my = sy / n
  let sxx = 0, syy = 0, sxy = 0
  for (const [x, y] of pairs) {
    const dx = x - mx, dy = y - my
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy
  }
  const denom = Math.sqrt(sxx * syy)
  const r = denom === 0 ? NaN : sxy / denom
  const t = Number.isNaN(r) ? NaN : r * Math.sqrt((n - 2) / (1 - r * r))
  return { r, n, t }
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

async function main(): Promise<void> {
  const db = getDb()
  const snapCol = db.collection('source_prediction_snapshots')
  const accCol = db.collection('source_accuracy')

  // 1. Build signalId -> OM atm covariates map (snapshots since deploy, OM present).
  const snaps: any[] = await snapCol.find(
    { timestamp: { $gte: DEPLOY_EPOCH }, 'perSourceAtmosphere.Open-Meteo': { $exists: true } },
    { projection: { signalId: 1, perSourceAtmosphere: 1 } },
  ).toArray()
  const omBySignal = new Map<string, Record<string, unknown>>()
  for (const s of snaps) {
    if (s.signalId) omBySignal.set(s.signalId, s.perSourceAtmosphere['Open-Meteo'])
  }

  // 2. Pull resolved per-source residuals since deploy, join to OM atm by signalId.
  const accs: any[] = await accCol.find(
    { timestamp: { $gte: DEPLOY_EPOCH }, signalId: { $exists: true } },
    { projection: { source: 1, error: 1, signalId: 1, temperatureType: 1 } },
  ).toArray()

  // source -> covariate -> [residual, covariateValue][]
  const data = new Map<string, Map<string, Array<[number, number]>>>()
  let joined = 0
  for (const a of accs) {
    const om = omBySignal.get(a.signalId)
    if (!om) continue
    const resid = num(a.error)
    if (resid === null) continue
    joined++
    let perCov = data.get(a.source)
    if (!perCov) { perCov = new Map(); data.set(a.source, perCov) }
    for (const cov of COVARIATES) {
      const cv = num(om[cov])
      if (cv === null) continue
      let arr = perCov.get(cov)
      if (!arr) { arr = []; perCov.set(cov, arr) }
      arr.push([cv, resid])
    }
  }

  console.log('\n========================================================')
  console.log('  ATM PHASE 0 — STAGE 1 EDA DRY-RUN (pooled univariate)')
  console.log(`  Run: ${new Date().toISOString().slice(0, 16)} UTC`)
  console.log('========================================================\n')

  console.log('SAMPLE READINESS  (resolved residual × OM-atm joined pairs since 2026-05-03)')
  console.log(`  OM-present snapshots since deploy : ${omBySignal.size}`)
  console.log(`  joined per-source residual rows   : ${joined}`)
  console.log(`  power target per source           : ${POWER_TARGET}\n`)
  for (const src of SOURCES) {
    const perCov = data.get(src)
    const n = perCov ? Math.max(0, ...[...perCov.values()].map(a => a.length)) : 0
    const ready = n >= POWER_TARGET ? 'READY ✅' : (n > 0 ? `n<${POWER_TARGET}` : 'none')
    console.log(`  ${src.padEnd(16)} max-n ${String(n).padStart(5)}   ${ready}`)
  }

  console.log('\nPEARSON r  (residual-source × OM covariate;  ** = |t|>2.58 ≈ p<0.01)')
  const header = 'covariate'.padEnd(12) + SOURCES.map(s => s.slice(0, 7).padStart(9)).join('')
  console.log('  ' + header)
  for (const cov of COVARIATES) {
    let line = cov.padEnd(12)
    for (const src of SOURCES) {
      const arr = data.get(src)?.get(cov) ?? []
      const { r, t } = pearson(arr)
      if (Number.isNaN(r)) { line += '      n/a'; continue }
      const sig = Math.abs(t) > 2.58 ? '*' : ' '
      line += (r >= 0 ? '+' : '') + r.toFixed(2) + sig
      line = line.padEnd(12 + 9 * (SOURCES.indexOf(src) + 1))
    }
    console.log('  ' + line)
  }
  console.log('\n  (dry-run only — no Stage 1 decision; formal review 2026-06-02)\n')

  await closeClient()
}

main().catch(async (e) => {
  console.error(e)
  await closeClient()
  process.exit(1)
})
