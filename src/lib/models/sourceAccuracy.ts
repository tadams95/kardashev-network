// Per-source forecast accuracy tracking and dynamic weight computation
// Records per-source temperature errors at resolution time and computes
// inverse-MAE weights cached in L1 Map + L2 Redis.

import { getDb } from '@/lib/db/mongodb'
import { rget, rset } from '@/lib/cache/redis'
import { DEFAULT_WEIGHTS, FORECAST_SOURCES } from './weatherProbability'
import type { EnsembleWeights } from '@/types/weather'

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

const DEFAULT_POLICY_VERSION = process.env.BIAS_POLICY_VERSION || 'v1'

// ============================================================================
// Types
// ============================================================================

export interface SourceAccuracyObservation {
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
  groundTruthSource: 'kalshi_midpoint' | 'metar'
  policyVersion: string
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

// ============================================================================
// MongoDB helpers
// ============================================================================

function sourceAccuracyCol() {
  return getDb().collection<SourceAccuracyObservation>('source_accuracy')
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
  const ageDays = ageMs / (1000 * 60 * 60 * 24)
  return Math.pow(2, -ageDays / DECAY_HALFLIFE_DAYS)
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
    groundTruthSource: 'kalshi_midpoint' | 'metar'
    policyVersion?: string
  }
): Promise<void> {
  await ensureIndexes()

  const error = forecastTemp - actualTemp
  const obs: SourceAccuracyObservation = {
    source,
    cityCode,
    forecastTemp,
    actualTemp,
    error,
    absError: Math.abs(error),
    timestamp: Date.now(),
    signalId: metadata.signalId,
    marketId: metadata.marketId,
    leadHours: metadata.leadHours,
    temperatureType: metadata.temperatureType,
    groundTruthSource: metadata.groundTruthSource,
    policyVersion: metadata.policyVersion ?? DEFAULT_POLICY_VERSION,
  }

  try {
    await sourceAccuracyCol().insertOne(obs as any)
  } catch (err) {
    console.error('[SourceAccuracy] write failed:', err)
  }
}

// ============================================================================
// Compute Weights
// ============================================================================

async function computeWeights(cityCode?: string): Promise<SourceWeightsResult> {
  await ensureIndexes()

  const now = Date.now()
  const sources = Array.from(FORECAST_SOURCES)
  const perSource: Record<string, SourceWeightDetail> = {}
  let dynamicCount = 0

  for (const source of sources) {
    const query: Record<string, unknown> = { source }
    if (cityCode) query.cityCode = cityCode

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
      const dw = decayWeight(obs.timestamp, now)
      const gtWeight = obs.groundTruthSource === 'metar' ? 3.0 : 1.0
      const w = dw * gtWeight
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

  // Clamp and renormalize
  let total = 0
  for (const source of sources) {
    const w = dynamicWeights[source] ?? 0.10
    dynamicWeights[source] = Math.max(WEIGHT_CLAMP_MIN, Math.min(WEIGHT_CLAMP_MAX, w))
    total += dynamicWeights[source]!
  }
  for (const source of sources) {
    const w = dynamicWeights[source]! / total
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

// ============================================================================
// Public API: Get Source Weights (with L1+L2 caching)
// ============================================================================

export async function getSourceWeights(cityCode?: string): Promise<EnsembleWeights> {
  const result = await getSourceWeightsDetailed(cityCode)
  return result.weights
}

export async function getSourceWeightsDetailed(cityCode?: string): Promise<SourceWeightsResult> {
  // Kill switch
  if (process.env.DYNAMIC_WEIGHTS_ENABLED === 'false') {
    return {
      weights: { ...DEFAULT_WEIGHTS },
      isDynamic: false,
      perSource: {},
      defaultWeights: { ...DEFAULT_WEIGHTS },
    }
  }

  const cacheKey = cityCode || '_global'

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
  const result = await computeWeights(cityCode)

  // Backfill both caches
  l1Cache.set(cacheKey, { data: result, ts: Date.now() })
  await rset(REDIS_PREFIX + cacheKey, result, REDIS_TTL_S)

  return result
}
