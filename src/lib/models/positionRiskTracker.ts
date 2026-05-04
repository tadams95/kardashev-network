// Position Risk Tracker
//
// Classifies open tail-sell positions as OK / WARN / CRITICAL using
// city-agnostic + quadrant-aware rules. Persists snapshots to a TTL'd
// MongoDB collection for risk-timeline replay + dedup.
//
// Triggered by:
// - PM2 cron `kardashev-position-monitor` (every 2h) — post-trade monitor
// - Pre-trade shadow logging in computeOpportunities.ts (logs only,
//   never suppresses signals)
//
// See plan: .claude/plans/okay-today-is-april-concurrent-stearns.md
//          (LOCKED 2026-05-04)

import { getDb } from '@/lib/db/mongodb'

// ============================================================================
// Constants
// ============================================================================

const COLLECTION = 'position_risk_snapshots'
const TTL_DAYS = 14

// Risk thresholds (initial, conservative — calibrated to PHX 2026-05-04 case)
const WARN_DRIFT_F = 2.0          // forecast moved adversely ≥ 2°F
const CRITICAL_DRIFT_F = 4.0      // forecast moved adversely ≥ 4°F
const WARN_BRACKET_DISTANCE_F = 1.0  // refreshed forecast within 1°F of bracket boundary
const WARN_SPREAD_RATIO = 1.5     // spread widened ≥1.5x signal-time

// Atmospheric thresholds — literature-derived; iterate post-Phase-F validation
// after 2026-06-02 atmospheric Phase 0 EDA passes.
const ATM_CLOUD_HIGH = 70   // % — cloudy peak suppresses Tmax / lifts Tmin (warmer overnight)
const ATM_CLOUD_LOW = 20    // % — clear peak amplifies Tmax / depresses Tmin (colder overnight)
const ATM_CLOUD_HOT_CONFIRM = 30  // % — confirmatory threshold for hot-side dry+clear regime
const ATM_PRECIP_WET = 0.25 // in — 24h pre-peak rain → evaporative cooling
const ATM_PRECIP_DRY = 0.05 // in — dry ground confirms hot bias

// ============================================================================
// Types
// ============================================================================

export type RiskLevel = 'OK' | 'WARN' | 'CRITICAL'

export interface PositionRiskSnapshot {
  id: string
  signalId: string
  ticker: string
  cityCode: string
  marketType: 'high' | 'low'
  direction: 'cold' | 'warm'
  mode: 'live' | 'paper' | null

  // Bracket info (constants from signal)
  bracketCapF: number | null
  bracketFloorF: number | null
  bracketDistanceAtSignal: number

  // Signal-time anchor
  signalTimestamp: number
  signalForecastF: number
  signalSpreadF: number
  signalLeadHours: number

  // Refreshed observations
  refreshedTimestamp: number
  refreshedForecastF: number
  refreshedSpreadF: number
  forecastDriftF: number          // signed °F (refreshed - signal)
  bracketDistanceCurrentF: number  // signed °F to nearest adverse boundary

  // Atmospheric context
  peakCloudCover: number | null
  peakHumidity: number | null
  peakWindGust: number | null
  prePeakPrecip24h: number | null

  // Live observation
  observedExtremeSoFarF: number | null
  observedAtTs: number | null
  observationCount: number
  peakWindowStartUtcMs: number | null
  peakWindowEndUtcMs: number | null
  hoursIntoPeakWindow: number | null

  // Classification
  riskLevel: RiskLevel
  riskTriggers: string[]

  expiresAt: Date
}

/** Inputs for the classification function. Pure — no I/O. */
/** Optional atmospheric inputs for the classifier. When passed, peak-hour
 *  atmospheric anomaly triggers are evaluated alongside drift/spread/boundary.
 *  Backward-compatible: callers that pass no `atmospheric` field (e.g., the
 *  post-trade monitor) get identical behavior to before. */
export interface AtmosphericRiskInputs {
  /** Peak-hour cloud cover, mean across populated sources (0-100%). */
  peakCloudCoverMean?: number
  /** Peak-hour relative humidity, mean across sources (0-100%). */
  peakHumidityMean?: number
  /** Peak-hour wind gust, max across sources (mph). */
  peakWindGustMax?: number
  /** 24h pre-peak cumulative precipitation, mean across sources (inches). */
  prePeakPrecip24hMean?: number
}

export interface ClassifyInputs {
  direction: 'cold' | 'warm'
  marketType: 'high' | 'low'
  bracketCapF: number | null
  bracketFloorF: number | null
  signalForecastF: number
  signalSpreadF: number
  refreshedForecastF: number
  refreshedSpreadF: number
  /** Optional atmospheric inputs. When provided, atmospheric anomaly triggers
   *  fire per the (direction, marketType) quadrant rules. When omitted,
   *  classifier behaves identically to pre-2026-05-04 version. */
  atmospheric?: AtmosphericRiskInputs
}

export interface ClassifyOutput {
  riskLevel: RiskLevel
  triggers: string[]
  forecastDriftF: number              // signed (refreshed - signal)
  bracketDistanceCurrentF: number      // signed °F to adverse boundary
}

// ============================================================================
// Pure classifier
// ============================================================================

/** Returns -1 if "falling forecast" is adverse for this position, +1 if "rising" is adverse.
 *  Cold direction (sold ≤bracket) → falling = adverse → -1
 *  Warm direction (sold ≥bracket) → rising = adverse → +1 */
export function adverseDriftSign(direction: 'cold' | 'warm'): -1 | 1 {
  return direction === 'cold' ? -1 : 1
}

/** Compute signed °F distance from refreshed forecast to the adverse bracket boundary.
 *  Negative = forecast has CROSSED the boundary into the losing region.
 *  Positive = forecast still on the safe side; magnitude is the buffer. */
export function bracketDistanceCurrent(args: {
  direction: 'cold' | 'warm'
  refreshedForecastF: number
  bracketCapF: number | null
  bracketFloorF: number | null
}): number {
  const { direction, refreshedForecastF, bracketCapF, bracketFloorF } = args

  // Cold side: bracket is ≤cap (or inner with both bounds). Adverse = forecast falling
  // into bracket. Boundary = bracketCapF. Buffer = forecast - cap (positive = safe).
  if (direction === 'cold') {
    if (bracketCapF == null) return Infinity  // no boundary defined — treat as safe
    return refreshedForecastF - bracketCapF
  }

  // Warm side: bracket is ≥floor (or inner with both bounds). Adverse = forecast rising
  // into bracket. Boundary = bracketFloorF. Buffer = floor - forecast (positive = safe).
  if (direction === 'warm') {
    if (bracketFloorF == null) return Infinity
    return bracketFloorF - refreshedForecastF
  }

  return Infinity
}

export function classifyPositionRisk(inp: ClassifyInputs): ClassifyOutput {
  const triggers: string[] = []

  // 1. Forecast drift (signed; convert to adverse-drift magnitude).
  // Bug fix 2026-05-04: previous formula was `-rawDriftF * sign` which
  // returned NEGATIVE for adverse cold-side drift (e.g. cold + rawDrift=-3 +
  // sign=-1 → -3, not +3), causing the drift WARN/CRITICAL triggers to never
  // fire on cold-side adverse drift. Correct formula is `rawDriftF * sign`:
  //   - cold + rawDrift=-3 + sign=-1 → +3 (adverse, correct)
  //   - warm + rawDrift=+3 + sign=+1 → +3 (adverse, correct)
  //   - cold + rawDrift=+3 + sign=-1 → -3 (favorable, correct)
  const rawDriftF = inp.refreshedForecastF - inp.signalForecastF
  const sign = adverseDriftSign(inp.direction)
  const adverseDriftMagF = rawDriftF * sign

  // 2. Bracket distance to nearest adverse boundary
  const bdCurrent = bracketDistanceCurrent({
    direction: inp.direction,
    refreshedForecastF: inp.refreshedForecastF,
    bracketCapF: inp.bracketCapF,
    bracketFloorF: inp.bracketFloorF,
  })

  // 3. Spread widening
  const spreadRatio = inp.signalSpreadF > 0 ? inp.refreshedSpreadF / inp.signalSpreadF : 1.0

  // CRITICAL triggers
  if (adverseDriftMagF >= CRITICAL_DRIFT_F) {
    triggers.push(`CRITICAL: drift ${adverseDriftMagF.toFixed(1)}°F adverse ≥ ${CRITICAL_DRIFT_F}°F`)
  }
  if (bdCurrent <= 0) {
    triggers.push(`CRITICAL: refreshed forecast ${inp.refreshedForecastF.toFixed(1)}°F crossed bracket boundary (buffer ${bdCurrent.toFixed(1)}°F)`)
  }

  // WARN triggers (also count as warns even when CRITICAL is already set, for the multi-warn rule)
  const warnFlags: string[] = []
  if (adverseDriftMagF >= WARN_DRIFT_F && adverseDriftMagF < CRITICAL_DRIFT_F) {
    warnFlags.push(`drift ${adverseDriftMagF.toFixed(1)}°F adverse ≥ ${WARN_DRIFT_F}°F`)
  }
  if (bdCurrent > 0 && bdCurrent <= WARN_BRACKET_DISTANCE_F) {
    warnFlags.push(`bracket-distance ${bdCurrent.toFixed(1)}°F (within ${WARN_BRACKET_DISTANCE_F}°F of boundary)`)
  }
  if (spreadRatio >= WARN_SPREAD_RATIO) {
    warnFlags.push(`spread widened ${spreadRatio.toFixed(2)}x signal-time`)
  }

  // 4. Atmospheric triggers (only when atmospheric inputs provided).
  // Per-quadrant rules — see plan doc for derivation. Multi-warn rule below
  // automatically promotes any two flags to CRITICAL.
  const atm = inp.atmospheric
  if (atm) {
    const cloud = atm.peakCloudCoverMean
    const precip = atm.prePeakPrecip24hMean

    // Cold-side HIGH (sold ≤cap): cloudy/wet peak → cooler day → bracket may hit.
    if (inp.direction === 'cold' && inp.marketType === 'high') {
      if (typeof cloud === 'number' && cloud > ATM_CLOUD_HIGH) {
        warnFlags.push(`peak cloud ${cloud.toFixed(0)}% > ${ATM_CLOUD_HIGH}% (cold-side HIGH suppressor)`)
      }
      if (typeof precip === 'number' && precip > ATM_PRECIP_WET) {
        warnFlags.push(`pre-peak precip ${precip.toFixed(2)}in > ${ATM_PRECIP_WET}in (evaporative cooling)`)
      }
    }
    // Hot-side HIGH (sold ≥floor): clear/dry peak → hotter day → bracket may hit.
    else if (inp.direction === 'warm' && inp.marketType === 'high') {
      if (typeof cloud === 'number' && cloud < ATM_CLOUD_LOW) {
        warnFlags.push(`peak cloud ${cloud.toFixed(0)}% < ${ATM_CLOUD_LOW}% (hot-side HIGH amplifier)`)
      }
      // Confirmatory: low cloud + dry ground = high heat-wave odds
      if (typeof cloud === 'number' && cloud < ATM_CLOUD_HOT_CONFIRM
          && typeof precip === 'number' && precip < ATM_PRECIP_DRY) {
        warnFlags.push(`peak cloud ${cloud.toFixed(0)}% + pre-peak precip ${precip.toFixed(2)}in (dry-clear regime)`)
      }
    }
    // Warm-tail LOW (sold ≥floor on low markets): cloudy overnight → warmer low → bracket may hit.
    else if (inp.direction === 'warm' && inp.marketType === 'low') {
      if (typeof cloud === 'number' && cloud > ATM_CLOUD_HIGH) {
        warnFlags.push(`peak cloud ${cloud.toFixed(0)}% > ${ATM_CLOUD_HIGH}% (warm-tail LOW lift)`)
      }
    }
    // Cold-tail LOW (sold ≤cap on low markets): clear overnight → colder low → bracket may hit.
    else if (inp.direction === 'cold' && inp.marketType === 'low') {
      if (typeof cloud === 'number' && cloud < ATM_CLOUD_LOW) {
        warnFlags.push(`peak cloud ${cloud.toFixed(0)}% < ${ATM_CLOUD_LOW}% (cold-tail LOW radiative cooling)`)
      }
    }
  }

  // Multi-WARN promotes to CRITICAL
  if (warnFlags.length >= 2 && triggers.length === 0) {
    triggers.push(`CRITICAL: multiple WARN conditions (${warnFlags.length}): ${warnFlags.join('; ')}`)
  } else {
    for (const w of warnFlags) triggers.push(`WARN: ${w}`)
  }

  let riskLevel: RiskLevel = 'OK'
  if (triggers.some(t => t.startsWith('CRITICAL'))) riskLevel = 'CRITICAL'
  else if (triggers.some(t => t.startsWith('WARN'))) riskLevel = 'WARN'

  return {
    riskLevel,
    triggers,
    forecastDriftF: rawDriftF,
    bracketDistanceCurrentF: bdCurrent === Infinity ? 0 : bdCurrent,
  }
}

// ============================================================================
// MongoDB helpers
// ============================================================================

function col() {
  return getDb().collection<PositionRiskSnapshot>(COLLECTION)
}

let _indexesEnsured = false
async function ensureIndexes(): Promise<void> {
  if (_indexesEnsured) return
  _indexesEnsured = true
  try {
    const c = col()
    await c.createIndex({ signalId: 1, refreshedTimestamp: -1 })
    await c.createIndex({ riskLevel: 1, refreshedTimestamp: -1 })
    await c.createIndex({ id: 1 }, { unique: true })
    await c.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
  } catch (err) {
    console.error('[positionRisk] index creation failed:', err)
    _indexesEnsured = false
  }
}

export async function recordPositionRiskSnapshot(snap: Omit<PositionRiskSnapshot, 'id' | 'expiresAt'>): Promise<void> {
  await ensureIndexes()
  const id = `prs_${snap.signalId}_${snap.refreshedTimestamp}`
  const expiresAt = new Date(snap.refreshedTimestamp + TTL_DAYS * 24 * 60 * 60 * 1000)
  const doc: PositionRiskSnapshot = { ...snap, id, expiresAt }
  try {
    await col().updateOne(
      { id },
      { $setOnInsert: doc as any },
      { upsert: true },
    )
  } catch (err) {
    console.error('[positionRisk] write failed:', err)
  }
}

/** Return the most recent snapshot per signalId. Used for transition detection
 *  (compare new classification vs previous to decide whether to alert). */
export async function getLatestSnapshotsBySignal(signalIds: string[]): Promise<Map<string, PositionRiskSnapshot>> {
  if (signalIds.length === 0) return new Map()
  await ensureIndexes()
  const docs = await col().aggregate<PositionRiskSnapshot>([
    { $match: { signalId: { $in: signalIds } } },
    { $sort: { signalId: 1, refreshedTimestamp: -1 } },
    { $group: { _id: '$signalId', latest: { $first: '$$ROOT' } } },
    { $replaceRoot: { newRoot: '$latest' } },
  ]).toArray()
  const out = new Map<string, PositionRiskSnapshot>()
  for (const d of docs) out.set(d.signalId, d)
  return out
}

/** Read-side helper used by /api/weather/trading-readiness to surface latest
 *  snapshot for every still-pending position. */
export async function getOpenPositionRisks(pendingSignalIds: string[]): Promise<PositionRiskSnapshot[]> {
  if (pendingSignalIds.length === 0) return []
  const map = await getLatestSnapshotsBySignal(pendingSignalIds)
  return [...map.values()]
}
