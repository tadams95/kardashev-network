// Cache warmup — pre-warms caches for tracked cities on server startup.
// Runs once per cluster (dedup via Redis flag).

import { CITY_COORDS, getCityCoordinates } from '@/lib/utils/cityCoordinates'
import { fetchSolarData } from '@/lib/api/openMeteo'
import { fetchWeatherForecast } from '@/lib/api/openMeteo'
import { fetchGoogleWeather } from '@/lib/api/googleWeather'
import { fetchMETARByCity } from '@/lib/api/metar'
import { fetchNWSForecast } from '@/lib/api/nws'
import { fetchAccuWeather } from '@/lib/api/accuweather'
import { fetchTomorrowWeather } from '@/lib/api/tomorrow'
import { buildEnsemble } from '@/lib/models/weatherProbability'
import { rdel, rget, rset, rsetnx, rping } from '@/lib/cache/redis'
import { getSourceWeights, captureServerSideForecasts } from '@/lib/models/sourceAccuracy'
import type { WeatherForecast } from '@/types/weather'

const WARMUP_FLAG_KEY = 'warmup:done'
const WARMUP_FLAG_TTL_S = 3600 // 1 hour — matches Tomorrow.io 25/hr rate limit window
const WARMUP_LOCK_KEY = 'warmup:lock'
const WARMUP_LOCK_TTL_S = 15 * 60

// Process-local guard for warmup when Redis is unavailable
let localWarmupDone = false

/**
 * Deduplicate cities by coordinates (aliases like NY/NYC share coordinates).
 * Returns ~14 unique entries from ~18 total.
 */
function getUniqueCities(): Array<{ code: string; lat: number; lng: number }> {
  const seen = new Set<string>()
  const unique: Array<{ code: string; lat: number; lng: number }> = []

  for (const [code, info] of Object.entries(CITY_COORDS)) {
    const coordKey = `${info.lat.toFixed(4)},${info.lng.toFixed(4)}`
    if (seen.has(coordKey)) continue
    seen.add(coordKey)
    unique.push({ code, lat: info.lat, lng: info.lng })
  }

  return unique
}

/**
 * Pre-warm caches for all tracked cities.
 * Non-blocking — errors are logged but don't crash the server.
 *
 * Phase 1: Open-Meteo (no rate limits) — all cities
 * Phase 2: AccuWeather + Tomorrow.io (rate-limited, built-in limiters)
 *   Circuit breaker trips per-source on first failure/empty, skipping remaining cities.
 * Phase 3: Server-side forecast snapshots (captures per-source temps for accuracy tracking)
 * Phase 4: Pre-compute dynamic weights per city
 */
export async function warmupCaches(): Promise<void> {
  // Dedup: only one cluster worker runs warmup
  const alreadyDone = await rget<boolean>(WARMUP_FLAG_KEY)
  if (alreadyDone) {
    console.log('[warmup] skipping — already completed by another worker')
    return
  }

  // Atomically claim the warmup slot to avoid duplicate runs during PM2 overlap.
  const lockAcquired = await rsetnx(WARMUP_LOCK_KEY, { startedAt: Date.now() }, WARMUP_LOCK_TTL_S)
  if (!lockAcquired) {
    // Distinguish "lock held by another worker" from "Redis unavailable"
    const redisAlive = await rping()
    if (redisAlive) {
      console.log('[warmup] skipping — warmup lock held by another worker')
      return
    }
    // Redis unavailable — fall back to process-local guard
    if (localWarmupDone) {
      console.log('[warmup] skipping — Redis unavailable, local warmup already completed')
      return
    }
    console.warn('[warmup] Redis unavailable — running local warmup with process-local guard')
    localWarmupDone = true
  }

  // Double-check done flag after lock acquisition in case another worker just finished.
  const doneAfterLock = await rget<boolean>(WARMUP_FLAG_KEY)
  if (doneAfterLock) {
    await rdel(WARMUP_LOCK_KEY)
    console.log('[warmup] skipping — already completed by another worker')
    return
  }

  const cities = getUniqueCities()
  console.log(`[warmup] starting cache warmup for ${cities.length} cities...`)

  try {

  // ── Phase 1: Open-Meteo (unlimited) ────────────────────────────────────
  let p1Success = 0
  let p1Error = 0
  const p1Names = ['Open-Meteo Solar', 'Open-Meteo Weather'] as const
  const p1Tripped = new Set<number>()

  for (const city of cities) {
    const fetchers = [
      () => fetchSolarData({ lat: city.lat, lng: city.lng }),
      () => fetchWeatherForecast({ lat: city.lat, lng: city.lng }),
    ]

    const results = await Promise.allSettled(
      fetchers.map((fn, i) =>
        p1Tripped.has(i)
          ? Promise.resolve({ data: [], cached: false })
          : fn()
      )
    )

    let cityOk = true
    for (let i = 0; i < results.length; i++) {
      if (p1Tripped.has(i)) continue
      const r = results[i]
      const name = p1Names[i]
      if (r.status === 'rejected') {
        cityOk = false
        console.warn(`[warmup] ${city.code} ${name}: rejected — ${r.reason instanceof Error ? r.reason.message : r.reason}`)
        p1Tripped.add(i)
        console.warn(`[warmup] ${name}: circuit-breaker tripped, skipping remaining cities`)
      } else if (r.value && 'data' in r.value && Array.isArray(r.value.data) && r.value.data.length === 0) {
        cityOk = false
        console.warn(`[warmup] ${city.code} ${name}: empty data`)
        p1Tripped.add(i)
        console.warn(`[warmup] ${name}: circuit-breaker tripped, skipping remaining cities`)
      }
    }

    if (cityOk) p1Success++
    else p1Error++

    await new Promise(resolve => setTimeout(resolve, 2000))
  }

  // ── Phase 2: AccuWeather + Tomorrow.io (rate-limited) ──────────────────
  // Each source has its own daily/hourly rate limiters. The circuit breaker
  // here stops further cities for a source on first failure to conserve budget.
  let p2Success = 0
  let p2Error = 0
  const p2Names = ['AccuWeather', 'Tomorrow.io'] as const
  const p2Tripped = new Set<number>()

  for (const city of cities) {
    if (p2Tripped.size === p2Names.length) break // both tripped → done

    const fetchers = [
      () => fetchAccuWeather(city.lat, city.lng),
      () => fetchTomorrowWeather(city.lat, city.lng),
    ]

    const results = await Promise.allSettled(
      fetchers.map((fn, i) =>
        p2Tripped.has(i)
          ? Promise.resolve({ data: [], cached: false })
          : fn()
      )
    )

    let cityOk = true
    for (let i = 0; i < results.length; i++) {
      if (p2Tripped.has(i)) continue
      const r = results[i]
      const name = p2Names[i]
      if (r.status === 'rejected') {
        cityOk = false
        console.warn(`[warmup] ${city.code} ${name}: rejected — ${r.reason instanceof Error ? r.reason.message : r.reason}`)
        p2Tripped.add(i)
        console.warn(`[warmup] ${name}: circuit-breaker tripped, skipping remaining cities`)
      } else if (r.value && 'data' in r.value && Array.isArray(r.value.data) && r.value.data.length === 0) {
        cityOk = false
        console.warn(`[warmup] ${city.code} ${name}: empty data`)
        p2Tripped.add(i)
        console.warn(`[warmup] ${name}: circuit-breaker tripped, skipping remaining cities`)
      }
    }

    if (cityOk) p2Success++
    else p2Error++

    // 2s stagger to spread rate-limited calls
    await new Promise(resolve => setTimeout(resolve, 2000))
  }

  // ── Phase 2.5: Pre-build ensemble cache ──────────────────────────────
  // Source caches are now warm — these hit L1/L2, not upstream APIs.
  // Builds the aggregated ensemble response so the first browser visit is instant.
  let ensembleCached = 0
  for (const city of cities) {
    try {
      const cityInfo = getCityCoordinates(city.code)
      if (!cityInfo) continue

      const [omResult, gwResult, metarResult, nwsResult, accuResult, tmrwResult] = await Promise.allSettled([
        fetchWeatherForecast({ lat: city.lat, lng: city.lng }),
        fetchGoogleWeather(city.lat, city.lng),
        fetchMETARByCity(city.code),
        fetchNWSForecast(city.lat, city.lng),
        fetchAccuWeather(city.lat, city.lng),
        fetchTomorrowWeather(city.lat, city.lng),
      ])

      const omData = omResult.status === 'fulfilled' ? omResult.value.data : []
      const gwData = gwResult.status === 'fulfilled' ? gwResult.value.data : []
      const metarData = metarResult.status === 'fulfilled' ? metarResult.value.data : null
      const nwsData = nwsResult.status === 'fulfilled' ? nwsResult.value.data : []
      const accuData = accuResult.status === 'fulfilled' ? accuResult.value.data : []
      const tmrwData = tmrwResult.status === 'fulfilled' ? tmrwResult.value.data : []

      const totalForecasts = (Array.isArray(omData) ? omData.length : 0) +
        (Array.isArray(gwData) ? gwData.length : 0) +
        (metarData ? 1 : 0) +
        (Array.isArray(nwsData) ? nwsData.length : 0) +
        (Array.isArray(accuData) ? accuData.length : 0) +
        (Array.isArray(tmrwData) ? tmrwData.length : 0)

      if (totalForecasts === 0) continue

      let activeWeights
      try { activeWeights = await getSourceWeights(city.code) } catch { /* defaults */ }

      const ensemble = buildEnsemble(
        Array.isArray(omData) ? omData : [],
        Array.isArray(gwData) ? gwData : [],
        metarData,
        { lat: city.lat, lng: city.lng, city: cityInfo.name, timezone: cityInfo.timezone },
        Array.isArray(nwsData) ? nwsData : [],
        Array.isArray(accuData) ? accuData : [],
        Array.isArray(tmrwData) ? tmrwData : [],
        activeWeights
      )

      // Calculate freshness (simplified — same logic as forecasts.ts)
      const calcFreshness = (forecasts: Array<{ timestamp: string | number; dataAge?: number }>): number => {
        if (forecasts.length === 0) return 0
        const now = Date.now()
        const ages = forecasts
          .map(f => {
            if (typeof f.dataAge === 'number' && Number.isFinite(f.dataAge)) return f.dataAge
            const ts = typeof f.timestamp === 'number' ? f.timestamp : new Date(f.timestamp).getTime()
            return Number.isFinite(ts) ? now - ts : NaN
          })
          .filter(a => Number.isFinite(a) && a >= 0) as number[]
        if (ages.length === 0) return 1
        return Math.max(1, Math.min(...ages))
      }
      const statusFromFreshness = (f: number): 'ok' | 'stale' | 'failed' => {
        if (f === 0) return 'failed'
        if (f > 6 * 3600000) return 'stale'
        return 'ok'
      }

      const freshness = {
        'Open-Meteo': calcFreshness(Array.isArray(omData) ? omData : []),
        'Google-Weather': calcFreshness(Array.isArray(gwData) ? gwData : []),
        'METAR': metarData ? calcFreshness([metarData]) : 0,
        'NWS': calcFreshness(Array.isArray(nwsData) ? nwsData : []),
        'AccuWeather': calcFreshness(Array.isArray(accuData) ? accuData : []),
        'Tomorrow.io': calcFreshness(Array.isArray(tmrwData) ? tmrwData : []),
      }

      const sourceStatus = {
        'Open-Meteo': statusFromFreshness(freshness['Open-Meteo']),
        'Google-Weather': statusFromFreshness(freshness['Google-Weather']),
        'METAR': statusFromFreshness(freshness['METAR']),
        'NWS': statusFromFreshness(freshness['NWS']),
        'AccuWeather': statusFromFreshness(freshness['AccuWeather']),
        'Tomorrow.io': statusFromFreshness(freshness['Tomorrow.io']),
      }

      const response = {
        success: true,
        data: { ensemble, city: cityInfo, freshness, sourceStatus },
        timestamp: Date.now(),
      }

      // Write directly to Redis L2 (same key format as forecasts.ts getCached/setCache)
      await rset(`forecasts:forecasts:${city.code}`, response, 900)
      ensembleCached++
    } catch (err) {
      console.warn(`[warmup] ensemble build failed for ${city.code}:`, err instanceof Error ? err.message : err)
    }

    await new Promise(resolve => setTimeout(resolve, 200))
  }
  console.log(`[warmup] Phase 2.5: ensemble cached for ${ensembleCached}/${cities.length} cities`)

  // ── Phase 3: Server-side forecast snapshots ──────────────────────────
  // Capture per-source temps for source accuracy tracking.
  // Fetches all forecast sources per city (hits L1/L2 cache from Phase 1-2
  // for Open-Meteo/AccuWeather/Tomorrow.io; fresh fetches for NWS/Google Weather).
  let snapshotsWritten = 0
  for (const city of cities) {
    try {
      const [omResult, gwResult, nwsResult, accuResult, tomorrowResult] = await Promise.allSettled([
        fetchWeatherForecast({ lat: city.lat, lng: city.lng }),
        fetchGoogleWeather(city.lat, city.lng),
        fetchNWSForecast(city.lat, city.lng),
        fetchAccuWeather(city.lat, city.lng),
        fetchTomorrowWeather(city.lat, city.lng),
      ])

      const allForecasts: WeatherForecast[] = []
      if (omResult.status === 'fulfilled') allForecasts.push(...omResult.value.data)
      if (gwResult.status === 'fulfilled') allForecasts.push(...gwResult.value.data)
      if (nwsResult.status === 'fulfilled') allForecasts.push(...nwsResult.value.data)
      if (accuResult.status === 'fulfilled') allForecasts.push(...accuResult.value.data)
      if (tomorrowResult.status === 'fulfilled') allForecasts.push(...tomorrowResult.value.data)

      if (allForecasts.length === 0) continue

      const cityInfo = getCityCoordinates(city.code)
      const written = await captureServerSideForecasts({
        cityCode: city.code,
        timezone: cityInfo?.timezone || 'America/New_York',
        forecasts: allForecasts,
      })
      snapshotsWritten += written
    } catch {
      // Non-critical — snapshots will be captured by forecasts API on next request
    }

    // Stagger to spread Google Weather / NWS fresh fetches
    await new Promise(resolve => setTimeout(resolve, 2000))
  }
  console.log(`[warmup] captured ${snapshotsWritten} server-side forecast snapshots`)

  // ── Phase 4: Pre-compute dynamic weights per city ─────────────────────
  let weightCities = 0
  for (const city of cities) {
    try {
      await getSourceWeights(city.code)
      weightCities++
    } catch {
      // Non-critical — weights will be computed on first request
    }
  }
  console.log(`[warmup] pre-warmed weights for ${weightCities}/${cities.length} cities`)

  // ── Phase 4b: Publish hierarchical weight rollups to Redis ─────────────
  try {
    const { recomputeAndPublishWeightRollups } = await import('@/lib/models/sourceAccuracy')
    const rollup = await recomputeAndPublishWeightRollups()
    console.log(`[warmup] Phase 4b: weight rollups published (${rollup.keysWritten} keys, ${rollup.durationMs}ms)`)
  } catch (err) {
    console.warn('[warmup] Phase 4b: weight rollup failed:', err instanceof Error ? err.message : err)
  }

  // ── Phase 5: Pre-compute opportunities per city ──────────────────────
  // All inputs (forecasts, markets, bias, weights) are now cached from prior phases.
  // This populates the opportunities L1+L2 cache so the first browser visit is instant.
  let oppCities = 0
  for (const city of cities) {
    try {
      const { getOpportunitiesForCity } = await import('@/pages/api/weather/opportunities')
      const result = await getOpportunitiesForCity(city.code)
      if (result.success) oppCities++
    } catch (err) {
      console.warn(`[warmup] opportunities failed for ${city.code}:`, err instanceof Error ? err.message : err)
    }
  }
  console.log(`[warmup] Phase 5: opportunities cached for ${oppCities}/${cities.length} cities`)

    console.log(`[warmup] complete: ${p1Success + p2Success} cities warmed, ${p1Error + p2Error} errors`)

    // Mark completed for short dedup window.
    await rset(WARMUP_FLAG_KEY, true, WARMUP_FLAG_TTL_S)
  } finally {
    await rdel(WARMUP_LOCK_KEY)
  }
}
