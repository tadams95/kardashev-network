// scripts/backfill-noaa-accuracy.ts
//
// Generalized ground-truth backfill for clean-era events that lack
// kalshi_midpoint source_accuracy rows (typically threshold-winner events).
//
// FALLBACK CHAIN (Item A2 — 2026-04-11):
//   1. NOAA api.weather.gov /observations       (primary — within ~7d retention)
//   2. Iowa Environmental Mesonet ASOS archive  (fallback — archival, no retention cliff)
//
// The Iowa Mesonet fallback exists because api.weather.gov drops observations
// older than ~7 days from the live `/stations/{id}/observations` feed. The vast
// majority of Item A's SKIP_NOAA_NODATA events (2026-03-24 through 2026-03-31)
// fall into that cliff. Iowa Mesonet wraps the same underlying NCEI ASOS data
// with indefinite retention, no auth, Fahrenheit direct.
//
// Strictly additive: never overwrites existing kalshi_midpoint or v1_poc_apr5_ny
// rows. Tags every row with policyVersion: v2_threshold_backfill and groundTruthSource:
//   - noaa_metar_<station>  when NOAA primary hit
//   - iowa_asos_<station>   when Iowa Mesonet fallback hit
// so they can be filtered out of the BMA weight rollup (which is restricted to
// kalshi_midpoint) and so Item B can audit per-provenance if needed.
//
// Usage:
//   npx tsx scripts/backfill-noaa-accuracy.ts                                # full DRY-RUN
//   npx tsx scripts/backfill-noaa-accuracy.ts --event srv_NY_20260405_high  # single-event dry-run
//   npx tsx scripts/backfill-noaa-accuracy.ts --only-failed                  # dry-run, skip events that already have any source_accuracy row
//   npx tsx scripts/backfill-noaa-accuracy.ts --apply                        # full backfill (writes)
//   npx tsx scripts/backfill-noaa-accuracy.ts --apply --only-failed          # apply, only currently-uncovered events
//   npx tsx scripts/backfill-noaa-accuracy.ts --apply --event srv_X_..._...  # single-event write

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config()

import { getDb, closeClient } from '../src/lib/db/mongodb'
import { recordSourceAccuracy, type GroundTruthSource } from '../src/lib/models/sourceAccuracy'
import { CITY_COORDS } from '../src/lib/utils/cityCoordinates'

const APPLY = process.argv.includes('--apply')
const DRY_RUN = !APPLY
const ONLY_FAILED = process.argv.includes('--only-failed')
const eventArgIdx = process.argv.indexOf('--event')
const SINGLE_EVENT = eventArgIdx >= 0 ? process.argv[eventArgIdx + 1] : null

const CLEAN_EPOCH = new Date('2026-03-21').getTime()
const POLICY_VERSION = 'v2_threshold_backfill'
const MAX_STALENESS_HOURS = 168 // 7 days
const NOAA_USER_AGENT = 'KardashevNetwork/1.0 (weather-trading-research; contact: ops@kardashev.network)'
const IOWA_USER_AGENT = 'KardashevNetwork/1.0 (weather-trading-research; contact: ops@kardashev.network)'

// ============================================================================
// Types
// ============================================================================

interface SnapshotDoc {
  _id: any
  signalId: string
  cityCode: string
  marketId: string
  marketType: 'high' | 'low'
  perSourceForecasts: Record<string, number>
  timestamp: number
}

interface ParsedSignalId {
  cityCode: string
  date: string // YYYYMMDD
  type: 'high' | 'low'
}

interface CandidateEvent {
  snapshot: SnapshotDoc
  parsed: ParsedSignalId
  station: string
  timezone: string
  settlementUtcMs: number
  snapshotLeadHours: number
}

interface BackfillRow {
  source: string
  forecastTemp: number
  actualTemp: number
  residual: number
  absResidual: number
}

type ObservationProvenance = 'noaa' | 'iowa_asos'

interface EventResult {
  signalId: string
  cityCode: string
  date: string
  type: 'high' | 'low'
  station: string
  status: 'OK' | 'SKIP_STALE' | 'SKIP_ALL_SOURCES_NODATA' | 'SKIP_ALL_SOURCES_ERROR' | 'SKIP_NO_STATION' | 'SKIP_TIMEZONE' | 'SKIP_NO_SOURCES'
  reason?: string
  snapshotLeadHours: number
  actualTemp?: number
  observationCount?: number
  observationSource?: ObservationProvenance
  rows?: BackfillRow[]
  written?: number
}

// ============================================================================
// Signal ID parsing
// ============================================================================

function parseSignalId(signalId: string): ParsedSignalId | null {
  const m = signalId.match(/^srv_([A-Z]+)_(\d{8})_(high|low)$/)
  if (!m) return null
  return { cityCode: m[1], date: m[2], type: m[3] as 'high' | 'low' }
}

// ============================================================================
// Settlement window: convert local event date to UTC observation window
// ============================================================================

/**
 * Returns [startUtcMs, endUtcMs] for the LOCAL day in the city's timezone.
 * Used to fetch the METAR observation window for daily max/min aggregation.
 *
 * Implementation note: we walk backwards from a candidate UTC midnight,
 * checking what local-date that lands on in the target timezone, until we
 * find the right offset. This avoids hand-rolling DST math.
 */
function localDayUtcWindow(
  date: string, // YYYYMMDD
  timezone: string
): { startUtcMs: number; endUtcMs: number } {
  const yyyy = parseInt(date.slice(0, 4), 10)
  const mm = parseInt(date.slice(4, 6), 10) // 1-12
  const dd = parseInt(date.slice(6, 8), 10)

  // Build the target local date string we want to match
  const targetLocal = `${yyyy.toString().padStart(4, '0')}-${mm.toString().padStart(2, '0')}-${dd.toString().padStart(2, '0')}`

  // Try UTC midnight ± 24h to find the boundary where local-time crosses to the target date
  // We want startUtcMs such that formatting (startUtcMs) in the target timezone yields targetLocal at 00:00
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

  // Probe: start at UTC midnight of the date, then adjust by hours
  const probeStart = Date.UTC(yyyy, mm - 1, dd, 0, 0, 0)
  // Local time is UTC + offset; for US timezones offset is negative (UTC-5 to UTC-8)
  // So local midnight = UTC midnight + |offset| hours; iterate ±24h
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
  // Shouldn't happen for valid timezones; return UTC midnight as fallback
  return {
    startUtcMs: probeStart,
    endUtcMs: probeStart + 24 * 3600_000,
  }
}

// ============================================================================
// Observation fetchers (unified shape: temperatureF + UTC timestamp ms)
// ============================================================================

interface UnifiedObservation {
  timestampMs: number
  temperatureF: number
}

/**
 * NOAA api.weather.gov /stations/{id}/observations
 * Returns Celsius — converted to Fahrenheit at the boundary.
 * Limitation: ~7-day retention window on the live endpoint.
 */
async function fetchNoaaObservations(
  station: string,
  startUtcMs: number,
  endUtcMs: number
): Promise<UnifiedObservation[]> {
  const startIso = new Date(startUtcMs).toISOString()
  const endIso = new Date(endUtcMs).toISOString()
  const url = `https://api.weather.gov/stations/${station}/observations?start=${startIso}&end=${endIso}&limit=500`

  const res = await fetch(url, {
    headers: {
      'User-Agent': NOAA_USER_AGENT,
      Accept: 'application/geo+json',
    },
  })
  if (!res.ok) {
    throw new Error(`NOAA HTTP ${res.status} for ${station}: ${await res.text().then(t => t.slice(0, 200))}`)
  }
  const data = await res.json() as { features?: Array<{ properties?: { timestamp?: string; temperature?: { value?: number | null; unitCode?: string } } }> }
  const features = data.features || []
  const observations: UnifiedObservation[] = []
  for (const f of features) {
    const ts = f.properties?.timestamp
    const temp = f.properties?.temperature
    if (!ts || !temp) continue
    const value = temp.value
    if (typeof value !== 'number') continue
    // unitCode may be 'wmoUnit:degC' — assume Celsius (METAR standard)
    const temperatureF = (value * 9) / 5 + 32
    const timestampMs = Date.parse(ts)
    if (!isFinite(timestampMs)) continue
    observations.push({ timestampMs, temperatureF })
  }
  return observations
}

/**
 * Iowa Environmental Mesonet ASOS archive
 * https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py
 *
 * Returns CSV: station,valid,tmpf  — where tmpf is already Fahrenheit and
 * "M" indicates a missing observation. Works for any historical date range
 * without auth, which is why this is the fallback for events outside
 * api.weather.gov's ~7-day retention.
 *
 * Implementation note: Iowa Mesonet's API takes year1/month1/day1 as the
 * query start (date-level precision, not hour). We widen the query by one
 * day on each side and filter returned rows by the exact UTC window to
 * guarantee correctness for local-day windows that cross UTC midnight.
 */
async function fetchIowaAsosObservations(
  station: string,
  startUtcMs: number,
  endUtcMs: number
): Promise<UnifiedObservation[]> {
  // Widen query by 1 day on each side for safety, then filter.
  const queryStart = new Date(startUtcMs - 24 * 3600_000)
  const queryEnd = new Date(endUtcMs + 24 * 3600_000)
  const qs = new URLSearchParams({
    station,
    data: 'tmpf',
    year1: String(queryStart.getUTCFullYear()),
    month1: String(queryStart.getUTCMonth() + 1),
    day1: String(queryStart.getUTCDate()),
    year2: String(queryEnd.getUTCFullYear()),
    month2: String(queryEnd.getUTCMonth() + 1),
    day2: String(queryEnd.getUTCDate()),
    tz: 'Etc/UTC',
    format: 'onlycomma',
    latlon: 'no',
    elev: 'no',
    missing: 'M',
    trace: 'T',
  })
  const url = `https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?${qs.toString()}`

  const res = await fetch(url, {
    headers: { 'User-Agent': IOWA_USER_AGENT, Accept: 'text/csv' },
  })
  if (!res.ok) {
    throw new Error(`IowaMesonet HTTP ${res.status} for ${station}: ${await res.text().then(t => t.slice(0, 200))}`)
  }
  const body = await res.text()
  const lines = body.split('\n')
  if (lines.length < 2) return []

  // Verify header
  const header = lines[0].trim().toLowerCase()
  if (!header.startsWith('station,valid,tmpf')) {
    throw new Error(`IowaMesonet unexpected header for ${station}: "${lines[0].slice(0, 80)}"`)
  }

  const observations: UnifiedObservation[] = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    const parts = line.split(',')
    if (parts.length < 3) continue
    const valid = parts[1]
    const tmpfRaw = parts[2]
    if (tmpfRaw === 'M' || tmpfRaw === '') continue
    const temperatureF = parseFloat(tmpfRaw)
    if (!isFinite(temperatureF)) continue
    // "YYYY-MM-DD HH:MM" is returned in UTC because we passed tz=Etc/UTC.
    // Parse as UTC explicitly — Date.parse on "YYYY-MM-DD HH:MM" is ambiguous.
    const m = valid.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/)
    if (!m) continue
    const timestampMs = Date.UTC(
      parseInt(m[1], 10),
      parseInt(m[2], 10) - 1,
      parseInt(m[3], 10),
      parseInt(m[4], 10),
      parseInt(m[5], 10)
    )
    // Filter strictly within the exact UTC window
    if (timestampMs < startUtcMs || timestampMs >= endUtcMs) continue
    observations.push({ timestampMs, temperatureF })
  }
  return observations
}

function aggregateDaily(
  observations: UnifiedObservation[],
  type: 'high' | 'low'
): { tempF: number; usedCount: number } | null {
  if (observations.length === 0) return null
  let extreme: number
  if (type === 'high') {
    extreme = Math.max(...observations.map(o => o.temperatureF))
  } else {
    extreme = Math.min(...observations.map(o => o.temperatureF))
  }
  return { tempF: Math.round(extreme * 100) / 100, usedCount: observations.length }
}

// ============================================================================
// Fallback chain: try NOAA, then Iowa Mesonet
// ============================================================================

interface FetchResult {
  observations: UnifiedObservation[]
  provenance: ObservationProvenance
  noaaError?: string
  iowaError?: string
}

async function fetchWithFallback(
  station: string,
  startUtcMs: number,
  endUtcMs: number
): Promise<FetchResult> {
  let noaaError: string | undefined
  let noaaObs: UnifiedObservation[] = []
  try {
    noaaObs = await fetchNoaaObservations(station, startUtcMs, endUtcMs)
  } catch (err: any) {
    noaaError = err?.message?.slice(0, 200) || 'unknown NOAA error'
  }

  if (noaaObs.length > 0) {
    return { observations: noaaObs, provenance: 'noaa', noaaError }
  }

  // Fall through to Iowa Mesonet archive. Rate-limit courtesy: small delay
  // before hitting the second service so the combined request rate stays
  // friendly.
  await new Promise(res => setTimeout(res, 150))

  let iowaError: string | undefined
  let iowaObs: UnifiedObservation[] = []
  try {
    iowaObs = await fetchIowaAsosObservations(station, startUtcMs, endUtcMs)
  } catch (err: any) {
    iowaError = err?.message?.slice(0, 200) || 'unknown Iowa error'
  }

  return {
    observations: iowaObs,
    provenance: 'iowa_asos',
    noaaError,
    iowaError,
  }
}

// ============================================================================
// Candidate enumeration
// ============================================================================

async function findCandidates(): Promise<CandidateEvent[]> {
  const db = getDb()
  const snapshots = db.collection<SnapshotDoc>('source_prediction_snapshots')
  const sourceAccuracy = db.collection('source_accuracy')

  const todayCompact = new Date().toISOString().slice(0, 10).replace(/-/g, '')

  const query: Record<string, any> = {
    timestamp: { $gte: CLEAN_EPOCH },
    signalId: /^srv_/,
  }
  if (SINGLE_EVENT) query.signalId = SINGLE_EVENT

  const allSnaps = await snapshots.find(query).toArray()

  // Pre-load the coverage sets in one pass so we don't issue per-event queries
  // for every snapshot (was O(N) round-trips, now O(1)).
  const coveredKalshi = new Set(
    (await sourceAccuracy.find(
      { signalId: { $regex: '^srv_' }, groundTruthSource: 'kalshi_midpoint' },
      { projection: { signalId: 1 } }
    ).toArray()).map(r => r.signalId as string)
  )
  const coveredAny = ONLY_FAILED
    ? new Set(
        (await sourceAccuracy.find(
          { signalId: { $regex: '^srv_' } },
          { projection: { signalId: 1 } }
        ).toArray()).map(r => r.signalId as string)
      )
    : null

  const candidates: CandidateEvent[] = []
  for (const snap of allSnaps) {
    const parsed = parseSignalId(snap.signalId)
    if (!parsed) continue
    if (parsed.date >= todayCompact) continue // not yet matured

    // Always skip if a kalshi_midpoint accuracy row already exists
    if (coveredKalshi.has(snap.signalId)) continue

    // In --only-failed mode, also skip if ANY source_accuracy row exists
    // (i.e. the event is already covered by a prior v2 backfill run)
    if (coveredAny && coveredAny.has(snap.signalId)) continue

    const cityInfo = CITY_COORDS[parsed.cityCode]
    if (!cityInfo?.resolutionStation) {
      candidates.push({
        snapshot: snap,
        parsed,
        station: '',
        timezone: cityInfo?.timezone || 'UTC',
        settlementUtcMs: 0,
        snapshotLeadHours: 0,
      })
      continue
    }

    const window = localDayUtcWindow(parsed.date, cityInfo.timezone)
    const settlementUtcMs = window.endUtcMs // end of local day == settlement boundary
    const snapshotLeadHours = (settlementUtcMs - snap.timestamp) / 3_600_000

    candidates.push({
      snapshot: snap,
      parsed,
      station: cityInfo.resolutionStation,
      timezone: cityInfo.timezone,
      settlementUtcMs,
      snapshotLeadHours,
    })
  }

  return candidates
}

// ============================================================================
// Per-event processing
// ============================================================================

async function processEvent(c: CandidateEvent): Promise<EventResult> {
  const base = {
    signalId: c.snapshot.signalId,
    cityCode: c.parsed.cityCode,
    date: c.parsed.date,
    type: c.parsed.type,
    station: c.station,
    snapshotLeadHours: c.snapshotLeadHours,
  }

  if (!c.station) {
    return { ...base, status: 'SKIP_NO_STATION', reason: `no resolutionStation for ${c.parsed.cityCode}` }
  }
  if (c.snapshotLeadHours > MAX_STALENESS_HOURS) {
    return { ...base, status: 'SKIP_STALE', reason: `${c.snapshotLeadHours.toFixed(1)}h > ${MAX_STALENESS_HOURS}h` }
  }
  // Negative lead means snapshot was taken AFTER settlement — also skip (post-event capture)
  if (c.snapshotLeadHours < 0) {
    return { ...base, status: 'SKIP_STALE', reason: `negative lead (${c.snapshotLeadHours.toFixed(1)}h) — snapshot taken post-settlement` }
  }

  const window = localDayUtcWindow(c.parsed.date, c.timezone)
  const fetchResult = await fetchWithFallback(c.station, window.startUtcMs, window.endUtcMs)

  const agg = aggregateDaily(fetchResult.observations, c.parsed.type)
  if (!agg) {
    // Both paths failed (either errored or returned no data)
    const errorNoted = fetchResult.noaaError || fetchResult.iowaError
    if (errorNoted && fetchResult.observations.length === 0) {
      return {
        ...base,
        status: 'SKIP_ALL_SOURCES_ERROR',
        reason: `NOAA: ${fetchResult.noaaError || 'n/a'} | IEM: ${fetchResult.iowaError || 'n/a'}`,
      }
    }
    return {
      ...base,
      status: 'SKIP_ALL_SOURCES_NODATA',
      reason: `no valid observations from ${c.station} in window (tried NOAA + Iowa Mesonet)`,
      observationCount: fetchResult.observations.length,
    }
  }

  const sources = Object.keys(c.snapshot.perSourceForecasts || {})
  if (sources.length === 0) {
    return {
      ...base,
      status: 'SKIP_NO_SOURCES',
      reason: 'snapshot has no perSourceForecasts',
      actualTemp: agg.tempF,
      observationCount: agg.usedCount,
      observationSource: fetchResult.provenance,
    }
  }

  const rows: BackfillRow[] = []
  for (const source of sources) {
    const forecastTemp = c.snapshot.perSourceForecasts[source]
    if (typeof forecastTemp !== 'number' || !isFinite(forecastTemp)) continue
    const residual = forecastTemp - agg.tempF
    rows.push({
      source,
      forecastTemp,
      actualTemp: agg.tempF,
      residual,
      absResidual: Math.abs(residual),
    })
  }

  let written = 0
  if (APPLY && rows.length > 0) {
    const station = c.station.toLowerCase()
    const groundTruthSource: GroundTruthSource = fetchResult.provenance === 'iowa_asos'
      ? `iowa_asos_${station}`
      : `noaa_metar_${station}`
    for (const row of rows) {
      const inserted = await recordSourceAccuracy(
        row.source,
        c.parsed.cityCode,
        row.forecastTemp,
        agg.tempF,
        {
          signalId: c.snapshot.signalId,
          marketId: c.snapshot.marketId,
          leadHours: c.snapshotLeadHours,
          temperatureType: c.parsed.type,
          groundTruthSource,
          policyVersion: POLICY_VERSION,
        }
      )
      if (inserted) written++
    }
  }

  return {
    ...base,
    status: 'OK',
    actualTemp: agg.tempF,
    observationCount: agg.usedCount,
    observationSource: fetchResult.provenance,
    rows,
    written,
  }
}

// ============================================================================
// Reporting
// ============================================================================

interface AggregateStats {
  eventsProcessed: number
  eventsOk: number
  eventsSkipped: number
  rowsWritten: number
  rowsCandidate: number
  bySkipReason: Map<string, number>
  byStatus: Map<string, number>
  byProvenance: Map<string, number>
  perSource: Map<string, { residuals: number[]; absResiduals: number[] }>
  perSourceLead: Map<string, Map<string, number[]>> // source → leadBucket → absResiduals
  perCity: Map<string, { absResiduals: number[]; residuals: number[]; count: number }>
  staleness: Map<string, number>
  failures: Array<{ signalId: string; status: string; reason?: string }>
}

function leadBucket(h: number): string {
  if (h < 12) return 'lt12h'
  if (h < 24) return '12to24h'
  if (h < 48) return '24to48h'
  if (h < 72) return '48to72h'
  if (h < 168) return 'gt72h'
  return 'gt7d'
}

function stalenessBucket(h: number): string {
  if (h < 24) return '<24h'
  if (h < 48) return '24-48h'
  if (h < 72) return '48-72h'
  if (h < 168) return '72h-7d'
  return '>7d'
}

function rmse(values: number[]): number {
  if (values.length === 0) return 0
  const sum = values.reduce((s, v) => s + v * v, 0)
  return Math.sqrt(sum / values.length)
}
function mean(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((s, v) => s + v, 0) / values.length
}

function aggregate(results: EventResult[]): AggregateStats {
  const stats: AggregateStats = {
    eventsProcessed: results.length,
    eventsOk: 0,
    eventsSkipped: 0,
    rowsWritten: 0,
    rowsCandidate: 0,
    bySkipReason: new Map(),
    byStatus: new Map(),
    byProvenance: new Map(),
    perSource: new Map(),
    perSourceLead: new Map(),
    perCity: new Map(),
    staleness: new Map(),
    failures: [],
  }
  for (const r of results) {
    stats.byStatus.set(r.status, (stats.byStatus.get(r.status) || 0) + 1)
    if (r.status === 'OK' && r.rows) {
      stats.eventsOk++
      stats.rowsCandidate += r.rows.length
      stats.rowsWritten += r.written ?? 0
      if (r.observationSource) {
        stats.byProvenance.set(r.observationSource, (stats.byProvenance.get(r.observationSource) || 0) + 1)
      }
      const lb = leadBucket(r.snapshotLeadHours)
      const sb = stalenessBucket(r.snapshotLeadHours)
      stats.staleness.set(sb, (stats.staleness.get(sb) || 0) + 1)
      const cityEntry = stats.perCity.get(r.cityCode) || { absResiduals: [], residuals: [], count: 0 }
      cityEntry.count++
      for (const row of r.rows) {
        cityEntry.absResiduals.push(row.absResidual)
        cityEntry.residuals.push(row.residual)
        const srcEntry = stats.perSource.get(row.source) || { residuals: [], absResiduals: [] }
        srcEntry.residuals.push(row.residual)
        srcEntry.absResiduals.push(row.absResidual)
        stats.perSource.set(row.source, srcEntry)
        const srcLeadMap = stats.perSourceLead.get(row.source) || new Map<string, number[]>()
        const arr = srcLeadMap.get(lb) || []
        arr.push(row.absResidual)
        srcLeadMap.set(lb, arr)
        stats.perSourceLead.set(row.source, srcLeadMap)
      }
      stats.perCity.set(r.cityCode, cityEntry)
    } else {
      stats.eventsSkipped++
      stats.bySkipReason.set(r.status, (stats.bySkipReason.get(r.status) || 0) + 1)
      stats.failures.push({ signalId: r.signalId, status: r.status, reason: r.reason })
    }
  }
  return stats
}

function printReport(stats: AggregateStats): void {
  console.log('')
  console.log('========== BACKFILL REPORT ==========')
  console.log(`Mode: ${APPLY ? 'APPLY (writes enabled)' : 'DRY-RUN (no writes)'}`)
  console.log(`Policy version: ${POLICY_VERSION}`)
  console.log(`Max staleness: ${MAX_STALENESS_HOURS}h`)
  console.log('')
  console.log(`Events processed: ${stats.eventsProcessed}`)
  console.log(`  OK:      ${stats.eventsOk}`)
  console.log(`  Skipped: ${stats.eventsSkipped}`)
  console.log(`Candidate rows: ${stats.rowsCandidate}`)
  console.log(`Rows written:   ${stats.rowsWritten}`)
  console.log('')
  console.log('Status breakdown:')
  for (const [k, v] of Array.from(stats.byStatus.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v}`)
  }

  if (stats.byProvenance.size > 0) {
    console.log('')
    console.log('OK events by observation provenance:')
    for (const [k, v] of Array.from(stats.byProvenance.entries()).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${k}: ${v}`)
    }
  }

  console.log('')
  console.log('Snapshot staleness distribution (snapshot → settlement):')
  const stOrder = ['<24h', '24-48h', '48-72h', '72h-7d', '>7d']
  for (const k of stOrder) {
    if (stats.staleness.has(k)) console.log(`  ${k}: ${stats.staleness.get(k)}`)
  }

  console.log('')
  console.log('Per-source overall (NOAA backfill subset):')
  console.log('  Source           |     n |   RMSE |   Bias (mean residual)')
  const srcOrder = Array.from(stats.perSource.keys()).sort()
  for (const s of srcOrder) {
    const e = stats.perSource.get(s)!
    const r = rmse(e.residuals)
    const b = mean(e.residuals)
    console.log(`  ${s.padEnd(16)} | ${String(e.residuals.length).padStart(5)} | ${r.toFixed(2).padStart(6)} | ${b >= 0 ? '+' : ''}${b.toFixed(2)}`)
  }

  console.log('')
  console.log('Per-source × lead-bucket RMSE (NOAA backfill subset):')
  console.log('  Source           | Bucket   |   n |   RMSE')
  for (const s of srcOrder) {
    const lm = stats.perSourceLead.get(s)
    if (!lm) continue
    const buckets = Array.from(lm.keys()).sort()
    for (const b of buckets) {
      const arr = lm.get(b)!
      console.log(`  ${s.padEnd(16)} | ${b.padEnd(8)} | ${String(arr.length).padStart(3)} | ${rmse(arr).toFixed(2).padStart(6)}`)
    }
  }

  console.log('')
  console.log('Per-city RMSE (NOAA backfill subset):')
  console.log('  City | Events | Rows |   RMSE |   Bias')
  const cityOrder = Array.from(stats.perCity.entries())
    .sort((a, b) => rmse(b[1].residuals) - rmse(a[1].residuals))
  for (const [city, e] of cityOrder) {
    const r = rmse(e.residuals)
    const b = mean(e.residuals)
    console.log(`  ${city.padEnd(4)} | ${String(e.count).padStart(6)} | ${String(e.residuals.length).padStart(4)} | ${r.toFixed(2).padStart(6)} | ${b >= 0 ? '+' : ''}${b.toFixed(2)}`)
  }

  if (stats.failures.length > 0) {
    console.log('')
    console.log(`Failures (${stats.failures.length}):`)
    const grouped = new Map<string, string[]>()
    for (const f of stats.failures) {
      const arr = grouped.get(f.status) || []
      arr.push(`${f.signalId}${f.reason ? ' — ' + f.reason : ''}`)
      grouped.set(f.status, arr)
    }
    for (const [status, examples] of grouped) {
      console.log(`  ${status} (${examples.length}):`)
      for (const e of examples.slice(0, 10)) console.log(`    ${e}`)
      if (examples.length > 10) console.log(`    ... and ${examples.length - 10} more`)
    }
  }

  console.log('')
  console.log('=====================================')
}

// ============================================================================
// Single-event verification print (used during dry-run on POC)
// ============================================================================

function printEventDetail(r: EventResult): void {
  console.log('')
  console.log('========== EVENT DETAIL ==========')
  console.log(`signalId: ${r.signalId}`)
  console.log(`status: ${r.status}${r.reason ? ' — ' + r.reason : ''}`)
  console.log(`station: ${r.station}`)
  console.log(`snapshotLeadHours: ${r.snapshotLeadHours.toFixed(2)}h`)
  if (r.observationSource) console.log(`observation provenance: ${r.observationSource}`)
  if (r.observationCount != null) console.log(`observations used: ${r.observationCount}`)
  if (r.actualTemp != null) console.log(`Actual ${r.type === 'high' ? 'max' : 'min'}: ${r.actualTemp.toFixed(2)}°F`)
  if (r.rows && r.rows.length > 0) {
    console.log('Per-source residuals:')
    for (const row of r.rows) {
      console.log(`  ${row.source.padEnd(16)} forecast=${row.forecastTemp.toFixed(2)}°F  actual=${agg(row).toFixed(2)}°F  residual=${row.residual >= 0 ? '+' : ''}${row.residual.toFixed(2)}°F  |abs|=${row.absResidual.toFixed(2)}°F`)
    }
    console.log(`Mean bias: ${(mean(r.rows.map(x => x.residual)) >= 0 ? '+' : '')}${mean(r.rows.map(x => x.residual)).toFixed(2)}°F`)
  }
  if (APPLY) console.log(`Rows written: ${r.written ?? 0}`)
  console.log('==================================')
}
function agg(row: BackfillRow): number {
  return row.actualTemp
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const modeFlags = [
    APPLY ? 'APPLY' : 'DRY-RUN',
    ONLY_FAILED ? 'only-failed' : 'all-uncovered',
    SINGLE_EVENT ? `single-event=${SINGLE_EVENT}` : 'full-sweep',
  ].join(' ')
  console.log(`[backfill-noaa] ${modeFlags}`)
  console.log(`[backfill-noaa] enumerating candidate events...`)

  const candidates = await findCandidates()
  console.log(`[backfill-noaa] candidates: ${candidates.length}`)

  if (candidates.length === 0) {
    console.log('[backfill-noaa] no candidates — exiting')
    await closeClient()
    return
  }

  if (SINGLE_EVENT && candidates.length > 1) {
    console.warn(`[backfill-noaa] WARNING: --event filter matched ${candidates.length} snapshots; expected 1`)
  }

  const results: EventResult[] = []
  let i = 0
  for (const c of candidates) {
    i++
    if (i % 25 === 0) console.log(`[backfill-noaa] progress: ${i}/${candidates.length}`)
    const r = await processEvent(c)
    results.push(r)
    if (SINGLE_EVENT) printEventDetail(r)
    // Be nice to api.weather.gov: ~5 req/sec
    await new Promise(res => setTimeout(res, 220))
  }

  const stats = aggregate(results)
  printReport(stats)

  await closeClient()
}

main().catch(err => {
  console.error('[backfill-noaa] FATAL:', err)
  process.exit(1)
})
