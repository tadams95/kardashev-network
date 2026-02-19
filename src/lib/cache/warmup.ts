// Cache warmup — pre-warms caches for tracked cities on server startup.
// Runs once per cluster (dedup via Redis flag).

import { CITY_COORDS } from '@/lib/utils/cityCoordinates'
import { fetchSolarData } from '@/lib/api/openMeteo'
import { fetchWeatherForecast } from '@/lib/api/openMeteo'
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

  let successCount = 0
  let errorCount = 0

  for (const city of cities) {
    try {
      // Fetch solar + weather in parallel per city
      await Promise.allSettled([
        fetchSolarData({ lat: city.lat, lng: city.lng }),
        fetchWeatherForecast({ lat: city.lat, lng: city.lng }),
      ])
      successCount++
    } catch (err) {
      errorCount++
      console.warn(`[warmup] failed for ${city.code}:`, err instanceof Error ? err.message : err)
    }

    // 500ms stagger between cities to avoid rate-limit bursts
    await new Promise(resolve => setTimeout(resolve, 500))
  }

  console.log(`[warmup] complete: ${successCount} cities warmed, ${errorCount} errors`)
}
