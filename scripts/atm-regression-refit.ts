/**
 * Atm Phase 0 — humidity/UV regression refit (read-only).
 *
 * The ~Jul 17 bundled-review deliverable from
 * [[atm-stage-1-decision-2026-06-03]] + [[atm-magnitude-finding-2026-06-08]]:
 * fit a SINGLE humidity/UV-conditioned per-source bias term — the structured,
 * state-dependent correction that layers ON TOP of the constant MU_CORRECTION.
 *
 * Model (per source):  residual ≈ a + b·uvIndex (+ c·humidity)
 *   residual = source_accuracy.error = forecastTemp − actualTemp  (+ = ran HOT)
 * The intercept `a` ≈ the constant per-source bias (what MU_CORRECTION already
 * captures); coefficients b/c are the ATM term — variation AROUND that bias.
 *
 * Grading:
 *  (a) OOS MAE drop — 5-fold CV. Baseline = predict the per-source mean
 *      (the μ-correction equivalent). Atm model = a + b·uv (+ c·hum).
 *      H2 bar from the magnitude memo: ≥0.2°F OOS MAE reduction.
 *  (b) tail-sell bracket calibration — needs the matured loss sample; thin now.
 *      Reported as a coverage note, not graded (same constraint as the gate
 *      forensic). The deliverable is the per-source coefficients to wire in.
 *
 * Pooled (high+low); stratification is Stage 2. Same join as atm-stage1-eda.ts.
 *
 * Usage: npx tsx --tsconfig tsconfig.json scripts/atm-regression-refit.ts
 */
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config()

import { getDb, closeClient } from '../src/lib/db/mongodb'

const DEPLOY_EPOCH = Date.parse('2026-05-03T00:00:00Z')
const SOURCES = ['NWS', 'Open-Meteo', 'Google-Weather', 'AccuWeather', 'Tomorrow.io']
const K_FOLDS = 5
const H2_BAR = 0.2 // °F OOS MAE reduction bar (magnitude memo)

type Row = { resid: number; uv: number; hum: number }

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** OLS via normal equations + Gaussian elimination. X cols include intercept. */
function ols(X: number[][], y: number[]): number[] | null {
  const p = X[0].length
  // A = XᵀX (p×p), b = Xᵀy (p)
  const A = Array.from({ length: p }, () => new Array(p).fill(0))
  const b = new Array(p).fill(0)
  for (let i = 0; i < X.length; i++) {
    for (let j = 0; j < p; j++) {
      b[j] += X[i][j] * y[i]
      for (let k = 0; k < p; k++) A[j][k] += X[i][j] * X[i][k]
    }
  }
  // Solve A·β = b
  for (let col = 0; col < p; col++) {
    let piv = col
    for (let r = col + 1; r < p; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r
    if (Math.abs(A[piv][col]) < 1e-12) return null
    ;[A[col], A[piv]] = [A[piv], A[col]]
    ;[b[col], b[piv]] = [b[piv], b[col]]
    for (let r = 0; r < p; r++) {
      if (r === col) continue
      const f = A[r][col] / A[col][col]
      for (let c = col; c < p; c++) A[r][c] -= f * A[col][c]
      b[r] -= f * b[col]
    }
  }
  return b.map((v, i) => v / A[i][i])
}

const mae = (vals: number[]) => vals.reduce((s, v) => s + Math.abs(v), 0) / vals.length

/** 5-fold CV OOS MAE for a model spec; returns {oosMae, baselineMae}. */
function cvMae(rows: Row[], cols: (r: Row) => number[]): { oos: number; base: number } {
  const oosResid: number[] = []
  const baseResid: number[] = []
  for (let f = 0; f < K_FOLDS; f++) {
    const train = rows.filter((_, i) => i % K_FOLDS !== f)
    const test = rows.filter((_, i) => i % K_FOLDS === f)
    if (train.length < 10 || test.length === 0) continue
    const beta = ols(train.map(cols), train.map(r => r.resid))
    const trainMean = train.reduce((s, r) => s + r.resid, 0) / train.length
    for (const r of test) {
      if (beta) {
        const pred = cols(r).reduce((s, x, i) => s + x * beta[i], 0)
        oosResid.push(r.resid - pred)
      }
      baseResid.push(r.resid - trainMean) // baseline = predict train mean (μ-corr equiv)
    }
  }
  return { oos: mae(oosResid), base: mae(baseResid) }
}

async function main(): Promise<void> {
  const db = getDb()
  const snapCol = db.collection('source_prediction_snapshots')
  const accCol = db.collection('source_accuracy')

  const snaps: any[] = await snapCol.find(
    { timestamp: { $gte: DEPLOY_EPOCH }, 'perSourceAtmosphere.Open-Meteo': { $exists: true } },
    { projection: { signalId: 1, perSourceAtmosphere: 1 } },
  ).toArray()
  const omBySignal = new Map<string, Record<string, unknown>>()
  for (const s of snaps) if (s.signalId) omBySignal.set(s.signalId, s.perSourceAtmosphere['Open-Meteo'])

  const accs: any[] = await accCol.find(
    { timestamp: { $gte: DEPLOY_EPOCH }, signalId: { $exists: true } },
    { projection: { source: 1, error: 1, signalId: 1 } },
  ).toArray()

  const bySource = new Map<string, Row[]>()
  for (const a of accs) {
    const om = omBySignal.get(a.signalId)
    if (!om) continue
    const resid = num(a.error), uv = num(om.uvIndex), hum = num(om.humidity)
    if (resid === null || uv === null || hum === null) continue
    const arr = bySource.get(a.source) ?? []
    arr.push({ resid, uv, hum })
    bySource.set(a.source, arr)
  }

  console.log('\n========================================================')
  console.log('  ATM PHASE 0 — HUMIDITY/UV REGRESSION REFIT')
  console.log(`  Run: ${new Date().toISOString().slice(0, 16)} UTC  ·  early read (target ~Jul 17)`)
  console.log('========================================================')
  console.log(`\nGrading: OOS MAE drop via ${K_FOLDS}-fold CV; H2 bar ≥${H2_BAR}°F.`)
  console.log('Baseline = predict per-source mean residual (the constant μ-correction).')
  console.log('residual = forecastTemp − actualTemp (+ = forecast ran HOT)\n')

  console.log('Source           |   n  | model            | intercept | β·uv  | β·hum |  R²  | OOSΔMAE | verdict')
  console.log('-----------------|------|------------------|-----------|-------|-------|------|---------|--------')

  for (const src of SOURCES) {
    const rows = bySource.get(src) ?? []
    if (rows.length < 50) { console.log(`${src.padEnd(16)} | ${String(rows.length).padStart(4)} | (insufficient n)`); continue }

    const my = rows.reduce((s, r) => s + r.resid, 0) / rows.length
    const sst = rows.reduce((s, r) => s + (r.resid - my) ** 2, 0)

    // Three model specs: uv-only, hum-only, uv+hum.
    const specs: Array<{ name: string; cols: (r: Row) => number[] }> = [
      { name: 'a + b·uv',        cols: r => [1, r.uv] },
      { name: 'a + c·hum',       cols: r => [1, r.hum] },
      { name: 'a + b·uv + c·hum', cols: r => [1, r.uv, r.hum] },
    ]

    for (const spec of specs) {
      const beta = ols(rows.map(spec.cols), rows.map(r => r.resid))
      if (!beta) continue
      const sse = rows.reduce((s, r) => {
        const pred = spec.cols(r).reduce((acc, x, i) => acc + x * beta[i], 0)
        return s + (r.resid - pred) ** 2
      }, 0)
      const r2 = 1 - sse / sst
      const { oos, base } = cvMae(rows, spec.cols)
      const drop = base - oos
      const bUv = spec.name.includes('uv') ? beta[1].toFixed(3) : '  -  '
      const bHum = spec.name.includes('hum') ? beta[spec.name.includes('uv') ? 2 : 1].toFixed(3) : '  -  '
      const verdict = drop >= H2_BAR ? 'PASS ✅' : `below bar (${drop >= 0 ? '+' : ''}${drop.toFixed(3)})`
      console.log(
        `${(spec === specs[0] ? src : '').padEnd(16)} | ${String(rows.length).padStart(4)} | ` +
        `${spec.name.padEnd(16)} | ${beta[0].toFixed(3).padStart(9)} | ${bUv.padStart(5)} | ${bHum.padStart(5)} | ` +
        `${r2.toFixed(3)} | ${(drop >= 0 ? '+' : '') + drop.toFixed(3)} | ${verdict}`,
      )
    }
    console.log('-----------------|------|------------------|-----------|-------|-------|------|---------|--------')
  }

  console.log('\nGrade (b) tail-sell bracket calibration: NOT graded — matured loss sample')
  console.log('does not exist yet (early read; ~15 paper losses, same constraint as gate forensic).')
  console.log('Deliverable = per-source (intercept, β·uv, β·hum) above, to layer on μ-correction')
  console.log('at emission time. Re-run at ~Jul 17 against the matured sample before wiring live.\n')

  await closeClient()
}

main().catch(async (e) => {
  console.error(e)
  await closeClient()
  process.exit(1)
})
