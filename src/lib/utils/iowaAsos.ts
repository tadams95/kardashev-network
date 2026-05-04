// Iowa Environmental Mesonet ASOS observation fetch
//
// Fetches hourly surface temperature observations from NWS-operated ASOS
// stations via the Iowa State University Iowa Mesonet free portal. ASOS data
// is the same official observation data NWS uses internally; Iowa Mesonet
// just provides a free CSV-formatted endpoint for it.
//
// Used for backfill and live-position monitoring. NOT a forecast source.
//
// Originally lived duplicated in scripts/probe-late-day-arb.ts and
// scripts/analyze-late-day-arb.ts. Consolidated here 2026-05-04 when the
// position risk monitor needed the same fetch.

const IOWA_USER_AGENT = 'KardashevNetwork iowa-asos/1.0 (https://github.com/tadams95/kardashev-network)'

export interface UnifiedObservation {
  timestampMs: number
  temperatureF: number
}

/** Fetch hourly °F observations from a given ICAO station between
 *  [startUtcMs, endUtcMs). Returns empty array if no data. Throws on
 *  HTTP failure or unexpected response shape. */
export async function fetchIowaAsosObservations(
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
  const header = lines[0].trim().toLowerCase()
  if (!header.startsWith('station,valid,tmpf')) {
    throw new Error(`IowaMesonet unexpected header for ${station}`)
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
    const m = valid.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/)
    if (!m) continue
    const timestampMs = Date.UTC(
      parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10),
      parseInt(m[4], 10), parseInt(m[5], 10),
    )
    if (timestampMs < startUtcMs || timestampMs >= endUtcMs) continue
    observations.push({ timestampMs, temperatureF })
  }
  return observations
}
