/**
 * Backfill intraday atmospheric history (Open-Meteo ERA5 archive) for the dates
 * we already have intraday Kalshi price snapshots, so the reaction-speed /
 * lead-lag hypothesis can be tested NOW instead of waiting ~8 weeks for the
 * going-forward live capture (commit b6e7704) to accumulate.
 *
 * ERA5 = ACTUAL observed hourly conditions (the cloudy.day mechanism reacts to
 * observed conditions). CAVEAT: reanalysis has mild LOOKAHEAD vs real-time
 * observability → a null lead-lag result is a strong kill; a positive is an
 * upper bound needing confirmation on the lookahead-free live data. ERA5 lags
 * ~5 days, so the most recent dates are skipped (live capture covers those).
 *
 * Storage: one doc per (cityCode, date) in `om_atm_hourly`, hourly arrays in
 * city-local time. One archive call per city (full date range) → split by day.
 * Idempotent (upsert by _id). Read-only on Kalshi; writes only om_atm_hourly.
 *
 * Usage: npx tsx --tsconfig tsconfig.json scripts/backfill-om-atm-hourly.ts [--dry]
 */
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config()
import { getDb, closeClient } from '../src/lib/db/mongodb'
import { CITY_COORDS } from '../src/lib/utils/cityCoordinates'

const DRY = process.argv.includes('--dry')
const VARS = [
  'cloud_cover', 'uv_index', 'relative_humidity_2m', 'wind_speed_10m',
  'wind_gusts_10m', 'surface_pressure', 'dew_point_2m', 'shortwave_radiation', 'precipitation',
]
const RETENTION_DAYS = 120

function addDaysUTC(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const t = Date.UTC(y, m - 1, d) + n * 86400000
  const dt = new Date(t)
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
}
function todayUTC(): string {
  const n = Date.now()
  const dt = new Date(n)
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
}

async function fetchArchive(lat: number, lng: number, start: string, end: string, tz: string): Promise<any> {
  const u = new URL('https://archive-api.open-meteo.com/v1/archive')
  u.searchParams.set('latitude', String(lat))
  u.searchParams.set('longitude', String(lng))
  u.searchParams.set('start_date', start)
  u.searchParams.set('end_date', end)
  u.searchParams.set('hourly', VARS.join(','))
  u.searchParams.set('timezone', tz)
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 30000)
  try {
    const r = await fetch(u.toString(), { signal: ctl.signal })
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
    return await r.json()
  } finally { clearTimeout(t) }
}

async function main(): Promise<void> {
  const db = getDb()
  const snapCol = db.collection<any>('kalshi_market_snapshots')
  const outCol = db.collection<any>('om_atm_hourly')

  // distinct (cityCode, resolutionDate) we have price snapshots for
  const pairs: Array<{ city: string; date: string }> = await snapCol.aggregate([
    { $match: { cityCode: { $ne: null } } },
    { $group: { _id: { city: '$cityCode', date: '$resolutionDate' } } },
    { $project: { _id: 0, city: '$_id.city', date: '$_id.date' } },
  ]).toArray()

  // group dates by city; cap end at today-5 (ERA5 delay)
  const cutoff = addDaysUTC(todayUTC(), -5)
  const byCity = new Map<string, string[]>()
  for (const p of pairs) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date) || p.date > cutoff) continue
    if (!CITY_COORDS[p.city]) continue
    const a = byCity.get(p.city) ?? []; a.push(p.date); byCity.set(p.city, a)
  }

  console.log(`\n=== ERA5 atm backfill ${DRY ? '(DRY)' : ''} ===`)
  console.log(`distinct city-dates with price snapshots: ${pairs.length} | cities to fetch: ${byCity.size} | date cap (ERA5 −5d): ${cutoff}`)

  let cities = 0, daysWritten = 0, skippedRecent = 0, failed = 0
  for (const [city, dates] of byCity) {
    const coords = CITY_COORDS[city]
    const sorted = dates.slice().sort()
    const start = sorted[0], end = sorted[sorted.length - 1]
    let resp: any
    try {
      resp = await fetchArchive(coords.lat, coords.lng, start, end, coords.timezone)
    } catch (e) {
      console.warn(`  ${city}: archive fetch failed (${start}..${end}): ${e instanceof Error ? e.message : e}`)
      failed++; continue
    }
    cities++
    const h = resp.hourly ?? {}
    const times: string[] = h.time ?? []
    // bucket hourly indices by local date (time is "YYYY-MM-DDTHH:MM")
    const byDate = new Map<string, number[]>()
    times.forEach((t, i) => { const d = t.slice(0, 10); const a = byDate.get(d) ?? []; a.push(i); byDate.set(d, a) })

    const wantDates = new Set(sorted)
    for (const [date, idxs] of byDate) {
      if (!wantDates.has(date)) continue
      const hourly: Record<string, any[]> = { time: idxs.map(i => times[i]) }
      for (const v of VARS) hourly[v] = idxs.map(i => h[v]?.[i] ?? null)
      const doc = {
        _id: `${city}:${date}`, cityCode: city, date, timezone: coords.timezone,
        lat: coords.lat, lng: coords.lng, source: 'era5-archive',
        hourly, fetchedAt: Date.now(),
        expiresAt: new Date(Date.now() + RETENTION_DAYS * 86400000),
      }
      if (!DRY) {
        await outCol.updateOne({ _id: doc._id }, { $set: doc }, { upsert: true })
      }
      daysWritten++
    }
    // small politeness delay
    await new Promise(r => setTimeout(r, 150))
  }
  // count recent skips
  skippedRecent = pairs.filter(p => /^\d{4}-\d{2}-\d{2}$/.test(p.date) && p.date > cutoff).length

  if (!DRY) {
    await outCol.createIndex({ cityCode: 1, date: 1 })
    await outCol.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
  }
  console.log(`\ncities fetched: ${cities} (failed ${failed}) | city-date docs written: ${daysWritten} | skipped (within ERA5 −5d): ${skippedRecent}`)
  console.log(DRY ? '(DRY — no writes)\n' : '(applied)\n')
  await closeClient()
}
main().catch(async (e) => { console.error(e); await closeClient(); process.exit(1) })
