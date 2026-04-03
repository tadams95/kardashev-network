// Per-source forecast accuracy tracking and dynamic weight computation
// Records per-source temperature errors at resolution time and computes
// inverse-MAE weights cached in L1 Map + L2 Redis.

import { getDb } from '@/lib/db/mongodb'
import { rget, rset } from '@/lib/cache/redis'
import { DEFAULT_WEIGHTS, FORECAST_SOURCES } from './weatherProbability'
import type { EnsembleWeights, WeatherForecast } from '@/types/weather'
import { groupForecastsByDay, extractPerSourceTemps } from '@/lib/utils/dailyForecasts'
import { extractCityCode } from '@/lib/utils/tickerParsing'
import { CITY_COORDS } from '@/lib/utils/cityCoordinates'

// ============================================================================
// Configuration
// ============================================================================

const DECAY_HALFLIFE_DAYS = 14
const MIN_OBSERVATIONS_PER_SOURCE = 15
const MIN_SOURCES_FOR_DYNAMIC = 3
const WEIGHT_CLAMP_MIN = 0.05
const WEIGHT_CLAMP_MAX = 0.50
const MAE_EPSILON = 0.5  // Smoothing constant for inverse-MAE

const REDIS_PREFIX = 'weights:'
const REDIS_TTL_S = 900  // 15 minutes
const ROLLUP_REDIS_TTL_S = 14400  // 4 hours — matches cron_restart interval in ecosystem.config.js
const ROLLUP_META_TTL_S = 16200   // 4.5 hours — survives between rollup cycles with buffer
const SHRINKAGE_K = 25
const BRIER_TEMP_SCALE_F = 10

const DEFAULT_POLICY_VERSION = process.env.BIAS_POLICY_VERSION || 'v1'

// ============================================================================
// Types
// ============================================================================

export interface SourceAccuracyObservation {
  id: string
  source: string
  cityCode: string
  forecastTemp: number         // Per-source forecast °F
  actualTemp: number           // Ground truth °F
  error: number                // forecastTemp - actualTemp
  absError: number             // |error|
  timestamp: number
  marketId?: string
  signalId?: string
  leadHours?: number
  temperatureType: 'high' | 'low'
  groundTruthSource: 'kalshi_midpoint'
  policyVersion: string
  expiresAt: Date
}

export interface SourcePredictionSnapshot {
  id: string
  signalId: string
  marketId: string
  cityCode: string
  marketType: 'high' | 'low'
  leadHours?: number
  timestamp: number
  policyVersion: string
  perSourceForecasts: Record<string, number>
  expiresAt: Date
}

export interface SourceWeightDetail {
  mae: number
  sampleCount: number
  effectiveN: number
  weight: number
}

export interface SourceWeightsResult {
  weights: EnsembleWeights
  isDynamic: boolean
  perSource: Record<string, SourceWeightDetail>
  defaultWeights: EnsembleWeights
}

export type LeadBucket = 'lt12h' | '12to24h' | '24to48h' | '48to72h' | 'gt72h' | 'all'
export type MarketTypeKey = 'temperature-high' | 'temperature-low' | 'all'
export type WeightRegime = 'city_type_lead' | 'city_type' | 'city' | 'global' | 'default'

export interface DynamicWeightResult {
  weights: Partial<Record<string, number>>
  regime: WeightRegime
  effectiveSampleSize: number
  computedAt: number
  expiresAt: number
}

// ============================================================================
// MongoDB helpers
// ============================================================================

function sourceAccuracyCol() {
  return getDb().collection<SourceAccuracyObservation>('source_accuracy')
}

function sourcePredictionSnapshotsCol() {
  return getDb().collection<SourcePredictionSnapshot>('source_prediction_snapshots')
}

let _indexesCreated = false
async function ensureIndexes(): Promise<void> {
  if (_indexesCreated) return
  _indexesCreated = true
  try {
    const col = sourceAccuracyCol()
    await col.createIndex({ source: 1, cityCode: 1, timestamp: -1 })
    await col.createIndex({ cityCode: 1, timestamp: -1 })
    await col.createIndex({ marketId: 1, signalId: 1 })
    await col.createIndex({ policyVersion: 1, timestamp: -1 })
    await col.createIndex({ id: 1 }, { unique: true })
    await col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })

    const snapshots = sourcePredictionSnapshotsCol()
    await snapshots.createIndex({ signalId: 1 }, { unique: true })
    await snapshots.createIndex({ marketId: 1, timestamp: -1 })
    await snapshots.createIndex({ cityCode: 1, marketType: 1, timestamp: -1 })
    await snapshots.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
  } catch (err) {
    console.error('[SourceAccuracy] index creation failed:', err)
    _indexesCreated = false
  }
}

// ============================================================================
// L1 Cache (in-memory Map)
// ============================================================================

const l1Cache = new Map<string, { data: SourceWeightsResult; ts: number }>()
const L1_TTL_MS = REDIS_TTL_S * 1000

// ============================================================================
// Decay weight (same formula as temperatureBias.ts)
// ============================================================================

function decayWeight(observationTimestamp: number, now: number): number {
  const ageMs = now - observationTimestamp
  const ageDays = Math.max(0, ageMs / (1000 * 60 * 60 * 24))
  return Math.pow(2, -ageDays / DECAY_HALFLIFE_DAYS)
}

export function toLeadBucket(hoursToResolution: number): LeadBucket {
  if (!isFinite(hoursToResolution)) return 'all'
  if (hoursToResolution < 12) return 'lt12h'
  if (hoursToResolution < 24) return '12to24h'
  if (hoursToResolution < 48) return '24to48h'
  if (hoursToResolution < 72) return '48to72h'
  return 'gt72h'
}

function leadBucketRange(bucket: LeadBucket): { min?: number; max?: number } {
  if (bucket === 'lt12h') return { max: 12 }
  if (bucket === '12to24h') return { min: 12, max: 24 }
  if (bucket === '24to48h') return { min: 24, max: 48 }
  if (bucket === '48to72h') return { min: 48, max: 72 }
  if (bucket === 'gt72h') return { min: 72 }
  return {}
}

function defaultForecastWeights(): Record<string, number> {
  const weights: Record<string, number> = {}
  const forecastSources = Array.from(FORECAST_SOURCES)
  let total = 0
  for (const source of forecastSources) {
    const weight = DEFAULT_WEIGHTS[source] ?? 0.10
    weights[source] = weight
    total += weight
  }
  if (total <= 0) {
    const even = 1 / forecastSources.length
    for (const source of forecastSources) weights[source] = even
    return weights
  }
  for (const source of forecastSources) {
    weights[source] = weights[source] / total
  }
  return weights
}

function buildRedisWeightKey(cityCode: string, marketType: MarketTypeKey, leadBucket: LeadBucket): string {
  return `weights:${cityCode}:${marketType}:${leadBucket}`
}

function normalizeAndClampWeights(
  rawWeights: Record<string, number>,
  minWeight: number = 0.05,
  maxWeight: number = 0.60
): Record<string, number> {
  const forecastSources = Array.from(FORECAST_SOURCES)
  const working: Record<string, number> = {}
  for (const source of forecastSources) {
    const value = rawWeights[source] ?? 0
    working[source] = Math.max(minWeight, Math.min(maxWeight, value))
  }

  const sum = Object.values(working).reduce((s, v) => s + v, 0)
  if (sum <= 0) {
    const defaults = defaultForecastWeights()
    return defaults
  }

  for (const source of forecastSources) {
    working[source] = working[source] / sum
  }

  // Defensive: validate normalization result
  const checkSum = Object.values(working).reduce((s, v) => s + v, 0)
  if (!isFinite(checkSum) || Math.abs(checkSum - 1.0) > 0.01) {
    console.warn(`[weights] normalization invalid: sum=${checkSum}, falling back to defaults`)
    return defaultForecastWeights()
  }

  return working
}

function applyAvailabilityFilter(
  weights: Record<string, number>,
  availableSources: string[]
): Record<string, number> {
  const availableSet = new Set(availableSources)
  const filtered: Record<string, number> = {}
  for (const source of Object.keys(weights)) {
    if (availableSet.has(source)) filtered[source] = weights[source]
  }

  if (Object.keys(filtered).length === 0) {
    const defaults = defaultForecastWeights()
    const fallback: Record<string, number> = {}
    for (const source of availableSources) {
      if (defaults[source] != null) fallback[source] = defaults[source]
    }
    const fallbackSum = Object.values(fallback).reduce((s, v) => s + v, 0)
    if (fallbackSum <= 0) return defaults
    for (const source of Object.keys(fallback)) fallback[source] /= fallbackSum
    return fallback
  }

  const sum = Object.values(filtered).reduce((s, v) => s + v, 0)
  if (sum <= 0) return filtered
  for (const source of Object.keys(filtered)) filtered[source] /= sum
  return filtered
}

function toEnsembleWeightsFromRecord(weights: Record<string, number>): EnsembleWeights {
  return {
    ...DEFAULT_WEIGHTS,
    'Open-Meteo': weights['Open-Meteo'] ?? 0,
    'Google-Weather': weights['Google-Weather'] ?? 0,
    'NWS': weights['NWS'] ?? 0,
    'AccuWeather': weights['AccuWeather'] ?? 0,
    'Tomorrow.io': weights['Tomorrow.io'] ?? 0,
  }
}

// ============================================================================
// Record Observation
// ============================================================================

export async function recordSourceAccuracy(
  source: string,
  cityCode: string,
  forecastTemp: number,
  actualTemp: number,
  metadata: {
    signalId?: string
    marketId?: string
    leadHours?: number
    temperatureType: 'high' | 'low'
    groundTruthSource: 'kalshi_midpoint'
    policyVersion?: string
  }
): Promise<boolean> {
  const MAX_PLAUSIBLE_ERROR_F = 25
  const error = forecastTemp - actualTemp
  if (Math.abs(error) > MAX_PLAUSIBLE_ERROR_F) {
    console.warn(`[SourceAccuracy] REJECTED: |error|=${Math.abs(error).toFixed(1)}°F exceeds ${MAX_PLAUSIBLE_ERROR_F}°F threshold (source=${source}, city=${cityCode}, forecast=${forecastTemp.toFixed(1)}, actual=${actualTemp.toFixed(1)}, market=${metadata.marketId})`)
    return false
  }

  await ensureIndexes()
  const timestamp = Date.now()
  const retentionDays = metadata.signalId ? 400 : 45
  const obs: SourceAccuracyObservation = {
    id: `${metadata.marketId || 'unknown'}:${metadata.signalId || 'nosignal'}:${source}:${metadata.groundTruthSource}`,
    source,
    cityCode,
    forecastTemp,
    actualTemp,
    error,
    absError: Math.abs(error),
    timestamp,
    signalId: metadata.signalId,
    marketId: metadata.marketId,
    leadHours: metadata.leadHours,
    temperatureType: metadata.temperatureType,
    groundTruthSource: metadata.groundTruthSource,
    policyVersion: metadata.policyVersion ?? DEFAULT_POLICY_VERSION,
    expiresAt: new Date(timestamp + retentionDays * 24 * 60 * 60 * 1000),
  }

  try {
    const result = await sourceAccuracyCol().updateOne(
      { id: obs.id },
      { $setOnInsert: obs as any },
      { upsert: true }
    )
    return Boolean((result as any).upsertedCount)
  } catch (err) {
    console.error('[SourceAccuracy] write failed:', err)
    return false
  }
}

export async function logSourcePredictionSnapshot(input: {
  signalId: string
  marketId: string
  cityCode: string
  marketType: 'high' | 'low'
  perSourceForecasts: Record<string, number>
  leadHours?: number
  policyVersion?: string
  isTrade?: boolean
  timestamp?: number
}): Promise<void> {
  await ensureIndexes()

  const timestamp = input.timestamp ?? Date.now()
  const retentionDays = input.isTrade === false ? 45 : 400
  const doc: SourcePredictionSnapshot = {
    id: `sps_${input.signalId}`,
    signalId: input.signalId,
    marketId: input.marketId,
    cityCode: input.cityCode,
    marketType: input.marketType,
    leadHours: input.leadHours,
    timestamp,
    policyVersion: input.policyVersion ?? DEFAULT_POLICY_VERSION,
    perSourceForecasts: input.perSourceForecasts,
    expiresAt: new Date(timestamp + retentionDays * 24 * 60 * 60 * 1000),
  }

  try {
    const result = await sourcePredictionSnapshotsCol().updateOne(
      { signalId: input.signalId },
      { $setOnInsert: doc as any },
      { upsert: true }
    )
    const sources = Object.keys(input.perSourceForecasts)
    if ((result as any).upsertedCount) {
      console.log(`[SourceAccuracy] snapshot created: ${input.signalId} (${sources.length} sources: ${sources.join(', ')})`)
    }
  } catch (err) {
    console.error('[SourceAccuracy] snapshot write failed:', err)
  }
}

export async function writeSourceAccuracyFromResolution(args: {
  marketId: string
  signalId: string
  actualTemp: number
  groundTruthSource?: 'kalshi_midpoint'
}): Promise<number> {
  await ensureIndexes()

  const snapshot = await sourcePredictionSnapshotsCol().findOne({
    signalId: args.signalId,
    marketId: args.marketId,
  } as any)

  if (!snapshot?.perSourceForecasts || !snapshot.cityCode) return 0

  const derivedCity = extractCityCode(args.marketId)
  const effectiveCity = derivedCity ?? snapshot.cityCode
  if (derivedCity && snapshot.cityCode && derivedCity !== snapshot.cityCode) {
    console.warn(`[SourceAccuracy] Cross-city mismatch in snapshot: snapshot.cityCode=${snapshot.cityCode} but marketId=${args.marketId} → ${derivedCity}`)
  }

  let written = 0
  for (const [source, srcForecastTemp] of Object.entries(snapshot.perSourceForecasts)) {
    if (typeof srcForecastTemp !== 'number' || !isFinite(srcForecastTemp)) continue

    const inserted = await recordSourceAccuracy(source, effectiveCity, srcForecastTemp, args.actualTemp, {
      signalId: snapshot.signalId,
      marketId: snapshot.marketId,
      leadHours: snapshot.leadHours,
      temperatureType: snapshot.marketType,
      groundTruthSource: args.groundTruthSource ?? 'kalshi_midpoint',
      policyVersion: snapshot.policyVersion,
    })
    if (inserted) written++
  }

  return written
}

// ============================================================================
// Server-Side Forecast Capture
// ============================================================================

/**
 * Capture per-source forecast temperatures server-side for today and tomorrow.
 * Creates source_prediction_snapshots with synthetic IDs for use by resolve-markets.
 * Idempotent — safe to call multiple times for the same city+date.
 */
export async function captureServerSideForecasts(args: {
  cityCode: string
  timezone: string
  forecasts: WeatherForecast[]
}): Promise<number> {
  const { cityCode, timezone, forecasts } = args
  if (!forecasts || forecasts.length === 0) return 0

  const dailyForecasts = groupForecastsByDay(forecasts, timezone)
  // Capture up to 5 days so lead-bucket weight dimension has data for day 3+
  const targetDays = dailyForecasts.slice(0, 5)
  let written = 0

  for (const day of targetDays) {
    // Convert display dateKey (e.g. "03/03/2026") to compact YYYYMMDD
    const parts = day.date.split('/')  // MM/DD/YYYY from Intl.DateTimeFormat en-US
    if (parts.length !== 3) continue
    const compactDate = `${parts[2]}${parts[0]}${parts[1]}`

    for (const type of ['high', 'low'] as const) {
      const perSourceTemps = extractPerSourceTemps(forecasts, timezone, day.date, type)
      if (Object.keys(perSourceTemps).length < 2) {
        console.warn(`[SourceAccuracy] captureServerSide: ${cityCode} ${compactDate} ${type} — only ${Object.keys(perSourceTemps).length} source(s), skipping (need >= 2)`)
        continue  // need >= 2 sources
      }

      const syntheticSignalId = `srv_${cityCode}_${compactDate}_${type}`

      await logSourcePredictionSnapshot({
        signalId: syntheticSignalId,
        marketId: `srv_${cityCode}_${compactDate}`,
        cityCode,
        marketType: type,
        perSourceForecasts: perSourceTemps,
        policyVersion: DEFAULT_POLICY_VERSION,
        isTrade: false,  // 45-day retention
        timestamp: Date.now(),
      })
      written++
    }
  }

  return written
}

/**
 * Write source_accuracy entries from a server-side snapshot.
 * Called by resolve-markets when it has the actual temperature for a settled event.
 */
export async function writeSourceAccuracyFromServerSnapshot(args: {
  cityCode: string
  date: string          // YYYYMMDD compact format
  marketType: 'high' | 'low'
  actualTemp: number    // °F
  groundTruthSource?: 'kalshi_midpoint'
  marketId?: string     // Kalshi market ticker for traceability
}): Promise<number> {
  await ensureIndexes()

  const snapshotKey = `srv_${args.cityCode}_${args.date}_${args.marketType}`
  let snapshot = await sourcePredictionSnapshotsCol().findOne({ signalId: snapshotKey } as any)

  // Fallback: try canonical city code if alias didn't match
  // Warmup stores snapshots under the first CITY_COORDS key (NY, LA, SF, PHI)
  // but Kalshi tickers may use a different alias (NYC, LAX, SFO, PHIL)
  let resolvedKey = snapshotKey
  if (!snapshot?.perSourceForecasts) {
    const info = CITY_COORDS[args.cityCode]
    if (info) {
      for (const [key, val] of Object.entries(CITY_COORDS)) {
        if (val.name === info.name && key !== args.cityCode) {
          const altKey = `srv_${key}_${args.date}_${args.marketType}`
          const altSnapshot = await sourcePredictionSnapshotsCol().findOne({ signalId: altKey } as any)
          if (altSnapshot?.perSourceForecasts) {
            snapshot = altSnapshot
            resolvedKey = altKey
            break
          }
        }
      }
    }
  }

  if (!snapshot?.perSourceForecasts || Object.keys(snapshot.perSourceForecasts).length === 0) {
    console.warn(`[SourceAccuracy] writeFromSnapshot: no snapshot found for key="${snapshotKey}" (city=${args.cityCode}, date=${args.date}, type=${args.marketType})`)
    return 0
  }

  // Compute lead hours: time from forecast capture to resolution
  const leadHours = snapshot.timestamp
    ? Math.round((Date.now() - snapshot.timestamp) / 3_600_000)
    : undefined

  const sources = Object.keys(snapshot.perSourceForecasts)
  let written = 0
  for (const [source, srcForecastTemp] of Object.entries(snapshot.perSourceForecasts)) {
    if (typeof srcForecastTemp !== 'number' || !isFinite(srcForecastTemp)) continue

    const inserted = await recordSourceAccuracy(source, args.cityCode, srcForecastTemp, args.actualTemp, {
      signalId: resolvedKey,
      marketId: args.marketId,
      leadHours,
      temperatureType: args.marketType,
      groundTruthSource: args.groundTruthSource ?? 'kalshi_midpoint',
      policyVersion: snapshot.policyVersion,
    })
    if (inserted) written++
  }

  console.log(`[SourceAccuracy] writeFromSnapshot: key="${resolvedKey}" gt=${args.groundTruthSource ?? 'kalshi_midpoint'} → ${written}/${sources.length} sources written (actual=${args.actualTemp}°F)`)
  return written
}

// ============================================================================
// Compute Weights
// ============================================================================

async function computeWeights(cityCode?: string, marketType?: string): Promise<SourceWeightsResult> {
  await ensureIndexes()

  const now = Date.now()
  const sources = Array.from(FORECAST_SOURCES)
  const perSource: Record<string, SourceWeightDetail> = {}
  let dynamicCount = 0

  for (const source of sources) {
    const query: Record<string, unknown> = { source }
    if (cityCode) query.cityCode = cityCode
    if (marketType && marketType !== 'all') {
      query.temperatureType = marketType === 'temperature-low' ? 'low' : 'high'
    }

    const observations = await sourceAccuracyCol()
      .find(query)
      .sort({ timestamp: -1 })
      .limit(200)
      .toArray()

    if (observations.length < MIN_OBSERVATIONS_PER_SOURCE) {
      perSource[source] = {
        mae: 0,
        sampleCount: observations.length,
        effectiveN: 0,
        weight: DEFAULT_WEIGHTS[source] ?? 0.10,
      }
      continue
    }

    // Compute decay-weighted MAE with ground truth weighting
    let weightedAbsErrorSum = 0
    let totalWeight = 0
    let weightSqSum = 0

    for (const obs of observations) {
      const w = decayWeight(obs.timestamp, now)
      weightedAbsErrorSum += obs.absError * w
      totalWeight += w
      weightSqSum += w * w
    }

    const mae = totalWeight > 0 ? weightedAbsErrorSum / totalWeight : 0
    const effectiveN = weightSqSum > 0 ? (totalWeight * totalWeight) / weightSqSum : 0

    perSource[source] = {
      mae,
      sampleCount: observations.length,
      effectiveN,
      weight: 0, // will be computed below
    }
    dynamicCount++
  }

  // Check if we have enough sources for dynamic weighting
  const isDynamic = dynamicCount >= MIN_SOURCES_FOR_DYNAMIC &&
    process.env.DYNAMIC_WEIGHTS_ENABLED !== 'false'

  if (!isDynamic) {
    console.warn(`[weights] ${cityCode || 'global'}: falling back to static defaults (${dynamicCount}/${sources.length} sources met ${MIN_OBSERVATIONS_PER_SOURCE}-obs threshold, need ${MIN_SOURCES_FOR_DYNAMIC})`)
    // Use default weights
    for (const source of sources) {
      perSource[source].weight = DEFAULT_WEIGHTS[source] ?? 0.10
    }
    return {
      weights: { ...DEFAULT_WEIGHTS },
      isDynamic: false,
      perSource,
      defaultWeights: { ...DEFAULT_WEIGHTS },
    }
  }

  // Log dynamic weight computation
  const sourceDetails = sources.map(s => `${s}:MAE=${perSource[s].mae.toFixed(2)},n=${perSource[s].sampleCount}`).join(' ')
  console.log(`[weights] ${cityCode || 'global'}: dynamic (${dynamicCount}/${sources.length} sources) ${sourceDetails}`)

  // Compute inverse-MAE weights for sources with data
  // For sources without data, use default weight
  const inverseMae: Record<string, number> = {}
  for (const source of sources) {
    const detail = perSource[source]
    if (detail.sampleCount >= MIN_OBSERVATIONS_PER_SOURCE) {
      inverseMae[source] = 1 / (detail.mae + MAE_EPSILON)
    }
  }

  // Normalize inverse-MAE weights
  const inverseTotal = Object.values(inverseMae).reduce((s, v) => s + v, 0)
  const dynamicWeights: EnsembleWeights = {} as EnsembleWeights

  for (const source of sources) {
    if (source in inverseMae) {
      dynamicWeights[source] = inverseMae[source] / inverseTotal
    } else {
      dynamicWeights[source] = DEFAULT_WEIGHTS[source] ?? 0.10
    }
  }

  // Clamp and renormalize forecast sources to sum to 1.0
  let total = 0
  for (const source of sources) {
    const w = dynamicWeights[source] ?? 0.10
    dynamicWeights[source] = Math.max(WEIGHT_CLAMP_MIN, Math.min(WEIGHT_CLAMP_MAX, w))
    total += dynamicWeights[source]!
  }
  for (const source of sources) {
    const w = (dynamicWeights[source]! / total)
    dynamicWeights[source] = w
    perSource[source].weight = w
  }

  return {
    weights: dynamicWeights,
    isDynamic: true,
    perSource,
    defaultWeights: { ...DEFAULT_WEIGHTS },
  }
}

async function computeContextDynamicWeights(args: {
  cityCode?: string
  marketType: MarketTypeKey
  leadBucket: LeadBucket
  regime: WeightRegime
  priorWeights?: Record<string, number>
}): Promise<DynamicWeightResult> {
  await ensureIndexes()

  const now = Date.now()
  const sources = Array.from(FORECAST_SOURCES)
  const defaults = defaultForecastWeights()
  const prior = args.priorWeights ?? defaults

  const rawInverse: Record<string, number> = {}
  let effectiveNSum = 0
  let effectiveNCount = 0

  for (const source of sources) {
    const query: Record<string, unknown> = { source }
    if (args.cityCode && args.cityCode !== 'global') query.cityCode = args.cityCode
    if (args.marketType === 'temperature-high') query.temperatureType = 'high'
    if (args.marketType === 'temperature-low') query.temperatureType = 'low'

    const bucketRange = leadBucketRange(args.leadBucket)
    if (bucketRange.min != null || bucketRange.max != null) {
      const range: Record<string, number> = {}
      if (bucketRange.min != null) range.$gte = bucketRange.min
      if (bucketRange.max != null) range.$lt = bucketRange.max
      query.leadHours = range
    }

    const observations = await sourceAccuracyCol()
      .find(query)
      .sort({ timestamp: -1 })
      .limit(250)
      .toArray()

    if (observations.length < MIN_OBSERVATIONS_PER_SOURCE) continue

    let weightSum = 0
    let weightSqSum = 0
    let weightedBrier = 0

    for (const obs of observations) {
      const w = decayWeight(obs.timestamp, now)
      const brierLike = Math.min(1, Math.pow((obs.absError || Math.abs(obs.error || 0)) / BRIER_TEMP_SCALE_F, 2))
      weightedBrier += brierLike * w
      weightSum += w
      weightSqSum += w * w
    }

    if (weightSum <= 0) continue
    const decayedBrier = weightedBrier / weightSum
    const effectiveN = weightSqSum > 0 ? (weightSum * weightSum) / weightSqSum : 0
    effectiveNSum += effectiveN
    effectiveNCount++

    rawInverse[source] = 1 / (decayedBrier + MAE_EPSILON)
  }

  if (Object.keys(rawInverse).length < MIN_SOURCES_FOR_DYNAMIC || process.env.DYNAMIC_WEIGHTS_ENABLED === 'false') {
    return {
      weights: prior,
      regime: args.regime === 'default' ? 'default' : (args.cityCode ? args.regime : 'global'),
      effectiveSampleSize: 0,
      computedAt: now,
      expiresAt: now + ROLLUP_REDIS_TTL_S * 1000,
    }
  }

  const inverseTotal = Object.values(rawInverse).reduce((s, v) => s + v, 0)
  const rawWeights: Record<string, number> = { ...prior }
  for (const source of sources) {
    if (rawInverse[source] != null) {
      rawWeights[source] = rawInverse[source] / inverseTotal
    }
  }

  const effectiveN = effectiveNCount > 0 ? (effectiveNSum / effectiveNCount) : 0
  const lambda = effectiveN / (effectiveN + SHRINKAGE_K)

  const blended: Record<string, number> = {}
  for (const source of sources) {
    const r = rawWeights[source] ?? prior[source] ?? defaults[source] ?? 0
    const p = prior[source] ?? defaults[source] ?? 0
    blended[source] = lambda * r + (1 - lambda) * p
  }

  const normalized = normalizeAndClampWeights(blended, WEIGHT_CLAMP_MIN, 0.60)

  return {
    weights: normalized,
    regime: args.regime,
    effectiveSampleSize: Number(effectiveN.toFixed(2)),
    computedAt: now,
    expiresAt: now + ROLLUP_REDIS_TTL_S * 1000,
  }
}

export async function recomputeAndPublishWeightRollups(args?: {
  cityCodes?: string[]
  marketTypes?: MarketTypeKey[]
  leadBuckets?: LeadBucket[]
}): Promise<{ keysWritten: number; durationMs: number }> {
  await ensureIndexes()

  const start = Date.now()
  const cityCodes = args?.cityCodes && args.cityCodes.length > 0
    ? args.cityCodes
    : await sourceAccuracyCol().distinct('cityCode') as string[]
  const allCities = Array.from(new Set(['global', ...cityCodes.filter(Boolean)]))
  const marketTypes: MarketTypeKey[] = args?.marketTypes && args.marketTypes.length > 0
    ? args.marketTypes
    : ['temperature-high', 'temperature-low']
  const leadBuckets: LeadBucket[] = args?.leadBuckets && args.leadBuckets.length > 0
    ? args.leadBuckets
    : ['lt12h', '12to24h', '24to48h', '48to72h', 'gt72h']

  let keysWritten = 0
  const defaults = defaultForecastWeights()

  const globalAll = await computeContextDynamicWeights({
    cityCode: 'global',
    marketType: 'all',
    leadBucket: 'all',
    regime: 'global',
    priorWeights: defaults,
  })
  await rset(buildRedisWeightKey('global', 'all', 'all'), globalAll, ROLLUP_REDIS_TTL_S)
  keysWritten++

  const globalTypeAll: Record<string, DynamicWeightResult> = {}
  for (const marketType of marketTypes) {
    const typeAll = await computeContextDynamicWeights({
      cityCode: 'global',
      marketType,
      leadBucket: 'all',
      regime: 'global',
      priorWeights: globalAll.weights as Record<string, number>,
    })
    globalTypeAll[marketType] = typeAll
    await rset(buildRedisWeightKey('global', marketType, 'all'), typeAll, ROLLUP_REDIS_TTL_S)
    keysWritten++

    for (const leadBucket of leadBuckets) {
      const leadResult = await computeContextDynamicWeights({
        cityCode: 'global',
        marketType,
        leadBucket,
        regime: 'global',
        priorWeights: typeAll.weights as Record<string, number>,
      })
      await rset(buildRedisWeightKey('global', marketType, leadBucket), leadResult, ROLLUP_REDIS_TTL_S)
      keysWritten++
    }
  }

  for (const cityCode of allCities) {
    if (cityCode === 'global') continue

    const cityAll = await computeContextDynamicWeights({
      cityCode,
      marketType: 'all',
      leadBucket: 'all',
      regime: 'city',
      priorWeights: globalAll.weights as Record<string, number>,
    })
    await rset(buildRedisWeightKey(cityCode, 'all', 'all'), cityAll, ROLLUP_REDIS_TTL_S)
    keysWritten++

    for (const marketType of marketTypes) {
      const cityTypeAll = await computeContextDynamicWeights({
        cityCode,
        marketType,
        leadBucket: 'all',
        regime: 'city_type',
        priorWeights: cityAll.weights as Record<string, number>,
      })
      await rset(buildRedisWeightKey(cityCode, marketType, 'all'), cityTypeAll, ROLLUP_REDIS_TTL_S)
      keysWritten++

      for (const leadBucket of leadBuckets) {
        const cityTypeLead = await computeContextDynamicWeights({
          cityCode,
          marketType,
          leadBucket,
          regime: 'city_type_lead',
          priorWeights: cityTypeAll.weights as Record<string, number>,
        })
        await rset(buildRedisWeightKey(cityCode, marketType, leadBucket), cityTypeLead, ROLLUP_REDIS_TTL_S)
        keysWritten++
      }
    }
  }

  await rset('weights:meta:lastRollupAt', { timestamp: Date.now(), version: 'weights-v1' }, ROLLUP_META_TTL_S)

  return { keysWritten, durationMs: Date.now() - start }
}

export async function resolveDynamicWeights(input: {
  cityCode: string
  marketType: Exclude<MarketTypeKey, 'all'>
  leadBucket: Exclude<LeadBucket, 'all'>
  availableSources?: string[]
}): Promise<DynamicWeightResult> {
  // Kill switch — return defaults immediately
  if (process.env.DYNAMIC_WEIGHTS_ENABLED === 'false') {
    const defaults = defaultForecastWeights()
    const available = input.availableSources && input.availableSources.length > 0
      ? input.availableSources
      : Array.from(FORECAST_SOURCES)
    return {
      weights: applyAvailabilityFilter(defaults, available),
      regime: 'default' as WeightRegime,
      effectiveSampleSize: 0,
      computedAt: Date.now(),
      expiresAt: Date.now() + ROLLUP_REDIS_TTL_S * 1000,
    }
  }

  const hierarchy = [
    { city: input.cityCode, marketType: input.marketType as MarketTypeKey, lead: input.leadBucket as LeadBucket, regime: 'city_type_lead' as WeightRegime },
    { city: input.cityCode, marketType: input.marketType as MarketTypeKey, lead: 'all' as LeadBucket, regime: 'city_type' as WeightRegime },
    { city: input.cityCode, marketType: 'all' as MarketTypeKey, lead: 'all' as LeadBucket, regime: 'city' as WeightRegime },
    { city: 'global', marketType: input.marketType as MarketTypeKey, lead: input.leadBucket as LeadBucket, regime: 'global' as WeightRegime },
    { city: 'global', marketType: input.marketType as MarketTypeKey, lead: 'all' as LeadBucket, regime: 'global' as WeightRegime },
    { city: 'global', marketType: 'all' as MarketTypeKey, lead: 'all' as LeadBucket, regime: 'global' as WeightRegime },
  ]

  for (const ctx of hierarchy) {
    const key = buildRedisWeightKey(ctx.city, ctx.marketType, ctx.lead)
    const value = await rget<DynamicWeightResult>(key)
    if (value?.weights) {
      const availableSources = input.availableSources && input.availableSources.length > 0
        ? input.availableSources
        : Array.from(FORECAST_SOURCES)
      const filtered = applyAvailabilityFilter(value.weights as Record<string, number>, availableSources)
      return {
        ...value,
        regime: value.regime || ctx.regime,
        weights: filtered,
      }
    }
  }

  const defaults = defaultForecastWeights()
  const availableSources = input.availableSources && input.availableSources.length > 0
    ? input.availableSources
    : Array.from(FORECAST_SOURCES)

  return {
    weights: applyAvailabilityFilter(defaults, availableSources),
    regime: 'default',
    effectiveSampleSize: 0,
    computedAt: Date.now(),
    expiresAt: Date.now() + ROLLUP_REDIS_TTL_S * 1000,
  }
}

export async function getCityWeightContexts(cityCode: string): Promise<Record<string, DynamicWeightResult>> {
  const result: Record<string, DynamicWeightResult> = {}
  const marketTypes: Exclude<MarketTypeKey, 'all'>[] = ['temperature-high', 'temperature-low']
  const leadBuckets: Exclude<LeadBucket, 'all'>[] = ['lt12h', '12to24h', '24to48h', '48to72h', 'gt72h']

  for (const marketType of marketTypes) {
    for (const leadBucket of leadBuckets) {
      const resolved = await resolveDynamicWeights({ cityCode, marketType, leadBucket })
      result[`${marketType}:${leadBucket}`] = resolved
    }
  }

  return result
}

// ============================================================================
// Public API: Get Source Weights (with L1+L2 caching)
// ============================================================================

export async function getSourceWeights(cityCode?: string, marketType?: string): Promise<EnsembleWeights> {
  const result = await getSourceWeightsDetailed(cityCode, marketType)
  return result.weights
}

export async function getSourceWeightsDetailed(cityCode?: string, marketType?: string): Promise<SourceWeightsResult> {
  // Kill switch
  if (process.env.DYNAMIC_WEIGHTS_ENABLED === 'false') {
    return {
      weights: { ...DEFAULT_WEIGHTS },
      isDynamic: false,
      perSource: {},
      defaultWeights: { ...DEFAULT_WEIGHTS },
    }
  }

  const cacheKey = `${cityCode || '_global'}:${marketType || 'all'}`

  // L1: in-memory
  const l1 = l1Cache.get(cacheKey)
  if (l1 && Date.now() - l1.ts < L1_TTL_MS) {
    return l1.data
  }

  // L2: Redis
  const redisData = await rget<SourceWeightsResult>(REDIS_PREFIX + cacheKey)
  if (redisData) {
    l1Cache.set(cacheKey, { data: redisData, ts: Date.now() })
    return redisData
  }

  // Compute from MongoDB
  const result = await computeWeights(cityCode, marketType)

  // Backfill both caches
  l1Cache.set(cacheKey, { data: result, ts: Date.now() })
  await rset(REDIS_PREFIX + cacheKey, result, REDIS_TTL_S)

  return result
}
