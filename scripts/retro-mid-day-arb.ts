// Retrospective Mid-Day Arbitrage Audit
//
// Tests a WEAKER version of the late-day arb hypothesis using existing data:
// for each resolved market in the last 30 days, find the latest
// `market_predictions` snapshot taken between 4h and 24h before resolution,
// query Iowa Mesonet for actual hourly temps in that window, compute
// observed-so-far at the snapshot moment, and check if the bracket was already
// "decided" by observation. If yes, was Kalshi pricing reflecting that?
//
// This is a one-shot audit. Outputs a markdown summary.
//
// Run: tsx scripts/retro-mid-day-arb.ts > docs/work/late-day-arb-retro-2026-05-02.md

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config()

import { getDb, closeClient } from '../src/lib/db/mongodb'
import { CITY_COORDS } from '../src/lib/utils/cityCoordinates'

// ============================================================================
// Constants
// ============================================================================

const LOOKBACK_DAYS = 30
const MIN_HOURS_BEFORE_RESOLUTION = 4
const MAX_HOURS_BEFORE_RESOLUTION = 24
const IOWA_USER_AGENT = 'KardashevNetwork retro-arb/1.0'
const SLEEP_MS = 200

const MONTHS: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
}

// ============================================================================
// Types
// ============================================================================

type BracketKind = 'le' | 'ge' | 'inner'
type MarketType = 'temperature-high' | 'temperature-low'

interface MarketPredictionDoc {
  marketId: string
  cityCode?: string
  marketType?: string
  timestamp: number
  marketPrice: number
  correctedProbability: number
  resolvedOutcome: 0 | 1
  resolvedAt: number
}

interface UnifiedObservation {
  timestampMs: number
  temperatureF: number
}

interface RetroResult {
  marketId: string
  cityCode: string
  marketType: MarketType
  bracketKind: BracketKind
  bracketLow: number | null
  bracketHigh: number | null
  weatherDate: string
  snapshotTs: number
  resolvedAt: number
  hoursBeforeResolution: number
  marketYes: number              // Kalshi YES price at snapshot
  modelYes: number               // our model's correctedProbability
  observedSoFar: number | null
  observedAtTs: number | null
  obsImpliedYesProb_sigma2: number | null
  decided: boolean               // observation already locks the outcome
  resolvedYes: number            // 0 or 1 from resolvedOutcome
  marketGap: number | null       // marketYes - obsImplied (positive = market too high)
  modelGap: number | null        // modelYes - obsImplied
  marketCorrect: boolean | null  // did marketYes side with the actual outcome?
  obsImpliedCorrect: boolean | null  // did obs-implied side with the actual outcome?
}

// ============================================================================
// Helpers
// ============================================================================

async function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

function erf(x: number): number {
  const sign = x >= 0 ? 1 : -1
  x = Math.abs(x)
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911
  const t = 1.0 / (1.0 + p * x)
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x)
  return sign * y
}

function phi(z: number): number { return 0.5 * (1 + erf(z / Math.SQRT2)) }

function localDayUtcWindow(date: string, timezone: string): { startUtcMs: number; endUtcMs: number } {
  const yyyy = parseInt(date.slice(0, 4), 10)
  const mm = parseInt(date.slice(4, 6), 10)
  const dd = parseInt(date.slice(6, 8), 10)
  const targetLocal = `${yyyy.toString().padStart(4, '0')}-${mm.toString().padStart(2, '0')}-${dd.toString().padStart(2, '0')}`
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
  const probeStart = Date.UTC(yyyy, mm - 1, dd, 0, 0, 0)
  for (let h = -14; h <= 14; h++) {
    const candidate = probeStart + h * 3600_000
    const parts = fmt.formatToParts(new Date(candidate))
    const partsObj: Record<string, string> = {}
    for (const p of parts) partsObj[p.type] = p.value
    const localDate = `${partsObj.year}-${partsObj.month}-${partsObj.day}`
    const localTime = `${partsObj.hour}:${partsObj.minute}`
    if (localDate === targetLocal && localTime === '00:00') {
      return { startUtcMs: candidate, endUtcMs: candidate + 24 * 3600_000 }
    }
  }
  return { startUtcMs: probeStart, endUtcMs: probeStart + 24 * 3600_000 }
}

async function fetchIowaAsosObservations(
  station: string,
  startUtcMs: number,
  endUtcMs: number,
): Promise<UnifiedObservation[]> {
  const queryStart = new Date(startUtcMs - 24 * 3600_000)
  const queryEnd = new Date(endUtcMs + 24 * 3600_000)
  const qs = new URLSearchParams({
    station, data: 'tmpf',
    year1: String(queryStart.getUTCFullYear()),
    month1: String(queryStart.getUTCMonth() + 1),
    day1: String(queryStart.getUTCDate()),
    year2: String(queryEnd.getUTCFullYear()),
    month2: String(queryEnd.getUTCMonth() + 1),
    day2: String(queryEnd.getUTCDate()),
    tz: 'Etc/UTC', format: 'onlycomma', latlon: 'no', elev: 'no',
    missing: 'M', trace: 'T',
  })
  const url = `https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?${qs.toString()}`
  const res = await fetch(url, { headers: { 'User-Agent': IOWA_USER_AGENT, Accept: 'text/csv' } })
  if (!res.ok) throw new Error(`IowaMesonet HTTP ${res.status} for ${station}`)
  const body = await res.text()
  const lines = body.split('\n')
  if (lines.length < 2) return []
  if (!lines[0].toLowerCase().startsWith('station,valid,tmpf')) {
    throw new Error(`IowaMesonet unexpected header for ${station}`)
  }
  const out: UnifiedObservation[] = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    const parts = line.split(',')
    if (parts.length < 3) continue
    const tmpfRaw = parts[2]
    if (tmpfRaw === 'M' || tmpfRaw === '') continue
    const temperatureF = parseFloat(tmpfRaw)
    if (!isFinite(temperatureF)) continue
    const m = parts[1].match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/)
    if (!m) continue
    const ts = Date.UTC(
      parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10),
      parseInt(m[4], 10), parseInt(m[5], 10),
    )
    if (ts < startUtcMs || ts >= endUtcMs) continue
    out.push({ timestampMs: ts, temperatureF })
  }
  return out
}

function parseMarketId(marketId: string): { weatherDate: string; cityCode: string; bracketKind: BracketKind; bracketLow: number | null; bracketHigh: number | null; marketType: MarketType } | null {
  // KXHIGH<CITY>-26MAY02-T58, KXHIGHT<CITY>-26MAY02-B58.5, KXLOWT<CITY>-..., etc.
  const m = marketId.match(/^(KXHIGHT?|KXLOWT?)([A-Z]+)-(\d{2})([A-Z]{3})(\d{2})(?:-([BT])(\d+(?:\.\d+)?))?$/)
  if (!m) return null
  const [, prefix, cityCode, yy, mmm, dd, suffixKind, suffixVal] = m
  const month = MONTHS[mmm]
  if (!month) return null
  const weatherDate = `20${yy}${month.toString().padStart(2, '0')}${dd}`
  const marketType: MarketType = prefix.startsWith('KXHIGH') ? 'temperature-high' : 'temperature-low'
  // The B/T → le/ge mapping is unreliable across series; for retro we go with
  // the convention seen in `signals` collection (KXHIGHT...-B<v> = ≤<v>;
  // -T<v> behavior varies). We default to suffix-based interpretation here
  // and rely on the actual resolved outcome to validate. For inner brackets
  // (no suffix), bracket values aren't recoverable from marketId — skip.
  if (!suffixKind) return null
  const valueF = parseFloat(suffixVal)
  return suffixKind === 'B'
    ? { weatherDate, cityCode, bracketKind: 'le', bracketLow: null, bracketHigh: valueF, marketType }
    : { weatherDate, cityCode, bracketKind: 'ge', bracketLow: valueF, bracketHigh: null, marketType }
}

function obsImpliedYesProb(
  bracketKind: BracketKind,
  low: number | null,
  high: number | null,
  observedSoFar: number,
  marketType: MarketType,
  remainingHours: number,
  sigmaPerHour: number,
  sigmaCap: number,
): number {
  const sigma = Math.min(sigmaPerHour * Math.max(0, remainingHours), sigmaCap)
  if (marketType === 'temperature-high') {
    if (bracketKind === 'le') {
      const cap = high!
      if (observedSoFar > cap) return 0
      if (sigma === 0) return 1
      return phi((cap - observedSoFar) / sigma)
    }
    if (bracketKind === 'ge') {
      const floor = low!
      if (observedSoFar >= floor) return 1
      if (sigma === 0) return 0
      return 1 - phi((floor - observedSoFar) / sigma)
    }
    return 0.5
  }
  // temperature-low
  if (bracketKind === 'le') {
    const cap = high!
    if (observedSoFar <= cap) return 1
    if (sigma === 0) return 0
    return 1 - phi((observedSoFar - cap) / sigma)
  }
  if (bracketKind === 'ge') {
    const floor = low!
    if (observedSoFar < floor) return 0
    if (sigma === 0) return 1
    return phi((observedSoFar - floor) / sigma)
  }
  return 0.5
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const db = await getDb()
  const since = Date.now() - LOOKBACK_DAYS * 86400_000

  // Pull resolved trade predictions in lookback window
  const predictions = await db.collection('market_predictions').aggregate<MarketPredictionDoc>([
    { $match: {
      timestamp: { $gte: since },
      resolvedOutcome: { $in: [0, 1] },
      resolvedAt: { $exists: true, $ne: null },
      marketPrice: { $type: 'number', $gte: 0, $lte: 1 },
    }},
    // For each marketId, take the snapshot closest to (but ≥4h before) resolution.
    { $addFields: { hoursBeforeResolution: { $divide: [{ $subtract: ['$resolvedAt', '$timestamp'] }, 3600_000] } } },
    { $match: {
      hoursBeforeResolution: { $gte: MIN_HOURS_BEFORE_RESOLUTION, $lte: MAX_HOURS_BEFORE_RESOLUTION },
    }},
    { $sort: { marketId: 1, hoursBeforeResolution: 1 } },  // closest-to-resolution first
    { $group: {
      _id: '$marketId',
      doc: { $first: '$$ROOT' },
    }},
    { $replaceRoot: { newRoot: '$doc' } },
    { $sort: { resolvedAt: -1 } },
    { $limit: 500 },
  ]).toArray()

  console.error(`[retro] candidate markets in 4-24h pre-resolution window: ${predictions.length}`)

  // Group by (cityCode, weatherDate) so we fetch obs once per city-day
  type Job = { pred: MarketPredictionDoc; parsed: NonNullable<ReturnType<typeof parseMarketId>> }
  const byCityDate = new Map<string, Job[]>()
  for (const pred of predictions) {
    const parsed = parseMarketId(pred.marketId)
    if (!parsed) continue
    const cityInfo = CITY_COORDS[parsed.cityCode]
    if (!cityInfo?.resolutionStation || !cityInfo?.timezone) continue
    const key = `${parsed.cityCode}|${parsed.weatherDate}`
    const arr = byCityDate.get(key) || []
    arr.push({ pred, parsed })
    byCityDate.set(key, arr)
  }

  console.error(`[retro] unique city-days to fetch obs for: ${byCityDate.size}`)

  const results: RetroResult[] = []
  let cityDayIdx = 0
  for (const [, jobs] of byCityDate) {
    cityDayIdx++
    if (cityDayIdx % 10 === 0) {
      console.error(`[retro] processed ${cityDayIdx}/${byCityDate.size} city-days; results=${results.length}`)
    }
    const first = jobs[0]
    const cityInfo = CITY_COORDS[first.parsed.cityCode]
    const window = localDayUtcWindow(first.parsed.weatherDate, cityInfo.timezone)
    let allObs: UnifiedObservation[] = []
    try {
      allObs = await fetchIowaAsosObservations(cityInfo.resolutionStation!, window.startUtcMs, window.endUtcMs)
      await sleep(SLEEP_MS)
    } catch (err) {
      console.error(`[retro] obs fetch failed for ${first.parsed.cityCode} ${first.parsed.weatherDate}:`, (err as Error).message)
      continue
    }
    if (allObs.length === 0) continue

    for (const job of jobs) {
      // Filter obs to those at or before snapshot time
      const obsUpToSnapshot = allObs.filter(o => o.timestampMs <= job.pred.timestamp)
      if (obsUpToSnapshot.length === 0) continue

      let observedSoFar: number | null = null
      let observedAtTs: number | null = null
      if (job.parsed.marketType === 'temperature-high') {
        let best = -Infinity, bestTs = 0
        for (const o of obsUpToSnapshot) if (o.temperatureF > best) { best = o.temperatureF; bestTs = o.timestampMs }
        if (isFinite(best)) { observedSoFar = best; observedAtTs = bestTs }
      } else {
        let best = Infinity, bestTs = 0
        for (const o of obsUpToSnapshot) if (o.temperatureF < best) { best = o.temperatureF; bestTs = o.timestampMs }
        if (isFinite(best)) { observedSoFar = best; observedAtTs = bestTs }
      }

      const remainingHours = Math.max(0, (window.endUtcMs - job.pred.timestamp) / 3600_000)
      const obsImplied = observedSoFar != null
        ? obsImpliedYesProb(
            job.parsed.bracketKind, job.parsed.bracketLow, job.parsed.bracketHigh,
            observedSoFar, job.parsed.marketType, remainingHours, 2, 5,
          )
        : null

      const decided = obsImplied != null && (obsImplied < 0.03 || obsImplied > 0.97)
      const marketGap = obsImplied != null ? job.pred.marketPrice - obsImplied : null
      const modelGap = obsImplied != null ? job.pred.correctedProbability - obsImplied : null

      const resolvedYes = job.pred.resolvedOutcome
      const marketCorrect =
        (job.pred.marketPrice >= 0.5 && resolvedYes === 1) ||
        (job.pred.marketPrice < 0.5 && resolvedYes === 0)
      const obsImpliedCorrect = obsImplied != null
        ? (obsImplied >= 0.5 && resolvedYes === 1) || (obsImplied < 0.5 && resolvedYes === 0)
        : null

      results.push({
        marketId: job.pred.marketId,
        cityCode: job.parsed.cityCode,
        marketType: job.parsed.marketType,
        bracketKind: job.parsed.bracketKind,
        bracketLow: job.parsed.bracketLow,
        bracketHigh: job.parsed.bracketHigh,
        weatherDate: job.parsed.weatherDate,
        snapshotTs: job.pred.timestamp,
        resolvedAt: job.pred.resolvedAt,
        hoursBeforeResolution: (job.pred.resolvedAt - job.pred.timestamp) / 3600_000,
        marketYes: job.pred.marketPrice,
        modelYes: job.pred.correctedProbability,
        observedSoFar,
        observedAtTs,
        obsImpliedYesProb_sigma2: obsImplied,
        decided,
        resolvedYes,
        marketGap,
        modelGap,
        marketCorrect,
        obsImpliedCorrect,
      })
    }
  }

  console.error(`[retro] total results: ${results.length}`)

  // ==========================================================================
  // Markdown output
  // ==========================================================================

  const decided = results.filter(r => r.decided)
  const undecided = results.filter(r => !r.decided)
  const decidedAgreedWithMarket = decided.filter(r => r.obsImpliedYesProb_sigma2 != null && r.marketYes != null && Math.abs((r.obsImpliedYesProb_sigma2 ?? 0) - r.marketYes) < 0.05).length
  const decidedDisagreedBig = decided.filter(r => r.marketGap != null && Math.abs(r.marketGap) > 0.20).length
  const decidedDisagreedMed = decided.filter(r => r.marketGap != null && Math.abs(r.marketGap) > 0.10 && Math.abs(r.marketGap) <= 0.20).length

  const obsImpliedCorrectRate = decided.length > 0
    ? decided.filter(r => r.obsImpliedCorrect).length / decided.length
    : null
  const marketCorrectRate = results.length > 0
    ? results.filter(r => r.marketCorrect).length / results.length
    : null

  const lines: string[] = []
  lines.push(`# Late-Day Arbitrage — Mid-Day Retrospective (Phase 2)`)
  lines.push('')
  lines.push(`**Generated:** ${new Date().toISOString()}`)
  lines.push(`**Lookback:** last ${LOOKBACK_DAYS} days resolved markets`)
  lines.push(`**Snapshot window:** ${MIN_HOURS_BEFORE_RESOLUTION}–${MAX_HOURS_BEFORE_RESOLUTION}h before resolution`)
  lines.push(`**σ heuristic:** σ_2 (medium — 2°F/h, cap 5°F)`)
  lines.push('')
  lines.push(`## Sample sizes`)
  lines.push('')
  lines.push(`- Candidate markets in pre-resolution window: ${predictions.length}`)
  lines.push(`- Successfully joined with observation data: ${results.length}`)
  lines.push(`- "Decided" by observation (obs-implied YES <3% or >97%): ${decided.length}`)
  lines.push(`- Undecided (obs-implied between 3-97%): ${undecided.length}`)
  lines.push('')
  lines.push(`## Headline finding`)
  lines.push('')
  if (decided.length > 0) {
    lines.push(`Of ${decided.length} markets where observation already locked the outcome ${MIN_HOURS_BEFORE_RESOLUTION}–${MAX_HOURS_BEFORE_RESOLUTION}h before resolution:`)
    lines.push(`- Market price within 5pts of obs-implied: ${decidedAgreedWithMarket} (${(100 * decidedAgreedWithMarket / decided.length).toFixed(1)}%)`)
    lines.push(`- Disagreed by 10-20pts: ${decidedDisagreedMed} (${(100 * decidedDisagreedMed / decided.length).toFixed(1)}%)`)
    lines.push(`- Disagreed by >20pts: ${decidedDisagreedBig} (${(100 * decidedDisagreedBig / decided.length).toFixed(1)}%)`)
  } else {
    lines.push(`No markets in the sample met the "decided" criterion at the ${MIN_HOURS_BEFORE_RESOLUTION}–${MAX_HOURS_BEFORE_RESOLUTION}h window.`)
  }
  lines.push('')
  lines.push(`## Predictive accuracy`)
  lines.push('')
  if (decided.length > 0 && obsImpliedCorrectRate != null) {
    lines.push(`- Obs-implied prediction agrees with resolved outcome (decided cases only): ${(100 * obsImpliedCorrectRate).toFixed(1)}% of ${decided.length}`)
  }
  if (marketCorrectRate != null) {
    lines.push(`- Kalshi mid-day price (≥0.5 → YES) agrees with outcome (all cases): ${(100 * marketCorrectRate).toFixed(1)}% of ${results.length}`)
  }
  lines.push('')

  // Gap distribution
  if (decided.length > 0) {
    lines.push(`## Gap distribution (decided cases only)`)
    lines.push('')
    lines.push(`marketGap = marketYes − obsImpliedYes (positive = market YES priced higher than obs-implies)`)
    lines.push('')
    const buckets = [
      { label: '< -0.20 (market severely underprices YES)', f: (g: number) => g < -0.20 },
      { label: '[-0.20, -0.10)', f: (g: number) => g >= -0.20 && g < -0.10 },
      { label: '[-0.10, -0.05)', f: (g: number) => g >= -0.10 && g < -0.05 },
      { label: '[-0.05, 0.05] (efficient)', f: (g: number) => g >= -0.05 && g <= 0.05 },
      { label: '(0.05, 0.10]', f: (g: number) => g > 0.05 && g <= 0.10 },
      { label: '(0.10, 0.20]', f: (g: number) => g > 0.10 && g <= 0.20 },
      { label: '> 0.20 (market severely overprices YES)', f: (g: number) => g > 0.20 },
    ]
    lines.push('| Gap bucket | Count | Pct |')
    lines.push('|---|---|---|')
    for (const b of buckets) {
      const n = decided.filter(r => r.marketGap != null && b.f(r.marketGap)).length
      lines.push(`| ${b.label} | ${n} | ${(100 * n / decided.length).toFixed(1)}% |`)
    }
    lines.push('')
  }

  // Per-city breakdown
  if (results.length > 0) {
    lines.push(`## By city (top 10 by sample size)`)
    lines.push('')
    const byCity = new Map<string, { total: number; decided: number; meanAbsGap: number }>()
    for (const r of results) {
      const e = byCity.get(r.cityCode) || { total: 0, decided: 0, meanAbsGap: 0 }
      e.total++
      if (r.decided) e.decided++
      if (r.marketGap != null) e.meanAbsGap += Math.abs(r.marketGap)
      byCity.set(r.cityCode, e)
    }
    const cityRows = [...byCity.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 10)
    lines.push('| City | Total | Decided | Mean |gap| |')
    lines.push('|---|---|---|---|')
    for (const [city, e] of cityRows) {
      lines.push(`| ${city} | ${e.total} | ${e.decided} | ${(e.meanAbsGap / Math.max(1, e.total)).toFixed(3)} |`)
    }
    lines.push('')
  }

  // Sample of largest-gap decided cases
  if (decided.length > 0) {
    lines.push(`## Sample: largest-gap decided cases`)
    lines.push('')
    const sorted = [...decided].filter(r => r.marketGap != null).sort((a, b) => Math.abs(b.marketGap!) - Math.abs(a.marketGap!)).slice(0, 10)
    lines.push('| Market | City | obs°F | obs-implied | mktYES | gap | resolved |')
    lines.push('|---|---|---|---|---|---|---|')
    for (const r of sorted) {
      lines.push(`| ${r.marketId} | ${r.cityCode} | ${r.observedSoFar?.toFixed(1) ?? '—'} | ${r.obsImpliedYesProb_sigma2?.toFixed(3) ?? '—'} | ${r.marketYes.toFixed(3)} | ${r.marketGap?.toFixed(3) ?? '—'} | ${r.resolvedYes === 1 ? 'YES' : 'NO'} |`)
    }
    lines.push('')
  }

  // Caveats
  lines.push(`## Caveats`)
  lines.push('')
  lines.push(`- **Survivorship bias:** \`market_predictions\` rows only exist for markets where our pipeline emitted a non-HOLD signal. HOLDs are filtered. So this sample over-represents markets with clear forecasts (one direction dominant) and under-represents the most-uncertain markets — exactly where late-day arb might appear most.`)
  lines.push(`- **Inner brackets excluded:** the marketId regex skips inner-bracket events (no -B/-T suffix). Phase 1 forward instrumentation captures these via the structured Kalshi response.`)
  lines.push(`- **σ heuristic is a guess:** σ=2°F/h cap 5°F is one of three candidates. Phase 1 captures all three; this retro uses only σ_2.`)
  lines.push(`- **Pre-resolution snapshot is at least 4h before settlement, often 8-24h.** Late-day-arb hypothesis is most relevant in the LAST few hours; this retro tests a much weaker version. A null finding here doesn't rule out a strong late-window edge.`)
  lines.push('')

  console.log(lines.join('\n'))

  await closeClient()
  process.exit(0)
}

main().catch(err => {
  console.error('[retro] fatal:', err)
  process.exit(1)
})
