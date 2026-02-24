// Cache warmup — pre-warms caches for tracked cities on server startup.
// Runs once per cluster (dedup via Redis flag).

import { CITY_COORDS } from '@/lib/utils/cityCoordinates'
import { fetchSolarData } from '@/lib/api/openMeteo'
import { fetchWeatherForecast } from '@/lib/api/openMeteo'
import { fetchAccuWeather } from '@/lib/api/accuweather'
import { fetchTomorrowWeather } from '@/lib/api/tomorrow'
import { rget, rset } from '@/lib/cache/redis'

const WARMUP_FLAG_KEY = 'warmup:done'
const WARMUP_FLAG_TTL_S = 300 // 5 min dedup window

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
 */
export async function warmupCaches(): Promise<void> {
  // Dedup: only one cluster worker runs warmup
  const alreadyDone = await rget<boolean>(WARMUP_FLAG_KEY)
  if (alreadyDone) {
    console.log('[warmup] skipping — already completed by another worker')
    return
  }

  // Claim the warmup slot (best-effort — race is OK, redundant warmup is harmless)
  await rset(WARMUP_FLAG_KEY, true, WARMUP_FLAG_TTL_S)

  const cities = getUniqueCities()
  console.log(`[warmup] starting cache warmup for ${cities.length} cities...`)

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

  console.log(`[warmup] complete: ${p1Success + p2Success} cities warmed, ${p1Error + p2Error} errors`)
}
