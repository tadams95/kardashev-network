import { beforeEach, describe, expect, it, vi } from 'vitest'

type AnyDoc = Record<string, any>

const sourceAccuracyDocs: AnyDoc[] = []
const snapshotDocs: AnyDoc[] = []
const redisStore = new Map<string, any>()

function matchesQuery(doc: AnyDoc, query: AnyDoc): boolean {
  return Object.entries(query).every(([k, v]) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('$gte' in (v as any) || '$lt' in (v as any)) {
        const current = doc[k]
        const min = (v as any).$gte
        const max = (v as any).$lt
        if (min != null && !(current >= min)) return false
        if (max != null && !(current < max)) return false
        return true
      }
    }
    return doc[k] === v
  })
}

function makeCollection(name: string) {
  if (name === 'source_accuracy') {
    return {
      createIndex: vi.fn(async () => undefined),
      updateOne: async (filter: AnyDoc, update: AnyDoc, opts?: { upsert?: boolean }) => {
        const existing = sourceAccuracyDocs.find(d => matchesQuery(d, filter))
        if (existing) return { upsertedCount: 0 }
        if (opts?.upsert) {
          sourceAccuracyDocs.push(update.$setOnInsert)
          return { upsertedCount: 1 }
        }
        return { upsertedCount: 0 }
      },
      find: (query: AnyDoc) => ({
        sort: () => ({
          limit: () => ({
            toArray: async () => sourceAccuracyDocs.filter(d => matchesQuery(d, query)),
          }),
        }),
      }),
      distinct: async (field: string) => {
        if (field !== 'cityCode') return []
        return Array.from(new Set(sourceAccuracyDocs.map(d => d.cityCode)))
      },
    }
  }

  if (name === 'source_prediction_snapshots') {
    return {
      createIndex: vi.fn(async () => undefined),
      updateOne: async (filter: AnyDoc, update: AnyDoc, opts?: { upsert?: boolean }) => {
        const existing = snapshotDocs.find(d => matchesQuery(d, filter))
        if (existing) return { upsertedCount: 0 }
        if (opts?.upsert) {
          snapshotDocs.push(update.$setOnInsert)
          return { upsertedCount: 1 }
        }
        return { upsertedCount: 0 }
      },
      findOne: async (query: AnyDoc) => snapshotDocs.find(d => matchesQuery(d, query)) ?? null,
    }
  }

  throw new Error(`Unknown collection: ${name}`)
}

vi.mock('@/lib/db/mongodb', () => ({
  getDb: () => ({
    collection: (name: string) => makeCollection(name),
  }),
}))

vi.mock('@/lib/cache/redis', () => ({
  rget: async (key: string) => redisStore.get(`kn:${key}`) ?? null,
  rset: async (key: string, value: unknown) => {
    redisStore.set(`kn:${key}`, value)
  },
}))

import {
  recomputeAndPublishWeightRollups,
  resolveDynamicWeights,
  recordSourceAccuracy,
} from '../sourceAccuracy'

beforeEach(async () => {
  sourceAccuracyDocs.length = 0
  snapshotDocs.length = 0
  redisStore.clear()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-03-02T12:00:00Z'))

  const sources = ['Open-Meteo', 'Google-Weather', 'NWS']
  for (const source of sources) {
    for (let i = 0; i < 18; i++) {
      await recordSourceAccuracy(source, 'NYC', 70 + i * 0.1, 69 + i * 0.1, {
        signalId: `sig-${source}-${i}`,
        marketId: `m-${i}`,
        leadHours: 30,
        temperatureType: 'high',
        groundTruthSource: 'kalshi_midpoint',
      })
    }
  }
})

describe('Phase 2: rollups + redis + fallback', () => {
  it('publishes canonical redis key with DynamicWeightResult shape', async () => {
    await recomputeAndPublishWeightRollups({ cityCodes: ['NYC'], marketTypes: ['temperature-high'], leadBuckets: ['24to48h'] })

    const value = redisStore.get('kn:weights:NYC:temperature-high:24to48h')
    expect(value).toBeTruthy()
    expect(typeof value.regime).toBe('string')
    expect(typeof value.effectiveSampleSize).toBe('number')
    expect(typeof value.computedAt).toBe('number')
    expect(typeof value.expiresAt).toBe('number')
    expect(value.weights).toBeTruthy()
  })

  it('returns bounded, normalized weights', async () => {
    await recomputeAndPublishWeightRollups({ cityCodes: ['NYC'], marketTypes: ['temperature-high'], leadBuckets: ['24to48h'] })
    const resolved = await resolveDynamicWeights({ cityCode: 'NYC', marketType: 'temperature-high', leadBucket: '24to48h' })

    const values = Object.values(resolved.weights)
    const sum = values.reduce((s, v) => s + Number(v || 0), 0)
    expect(sum).toBeGreaterThan(0.999)
    expect(sum).toBeLessThan(1.001)
    for (const v of values) {
      expect(Number(v)).toBeGreaterThanOrEqual(0.05)
      expect(Number(v)).toBeLessThanOrEqual(0.60)
    }
  })

  it('falls back in hierarchy when city+type+lead key is missing', async () => {
    await recomputeAndPublishWeightRollups({ cityCodes: ['NYC'], marketTypes: ['temperature-high'], leadBuckets: ['24to48h'] })

    redisStore.delete('kn:weights:NYC:temperature-high:24to48h')

    const resolved = await resolveDynamicWeights({ cityCode: 'NYC', marketType: 'temperature-high', leadBucket: '24to48h' })
    expect(['city_type', 'city', 'global', 'default']).toContain(resolved.regime)
    expect(Object.values(resolved.weights).reduce((s, v) => s + Number(v || 0), 0)).toBeGreaterThan(0.99)
  })

  it('renormalizes weights when some sources are unavailable', async () => {
    await recomputeAndPublishWeightRollups({ cityCodes: ['NYC'], marketTypes: ['temperature-high'], leadBuckets: ['24to48h'] })

    const resolved = await resolveDynamicWeights({
      cityCode: 'NYC',
      marketType: 'temperature-high',
      leadBucket: '24to48h',
      availableSources: ['NWS', 'Open-Meteo'],
    })

    const keys = Object.keys(resolved.weights)
    expect(keys.sort()).toEqual(['NWS', 'Open-Meteo'].sort())
    const sum = Object.values(resolved.weights).reduce((s, v) => s + Number(v || 0), 0)
    expect(sum).toBeGreaterThan(0.999)
    expect(sum).toBeLessThan(1.001)
  })

  it('returns deterministic default weights when no redis contexts are available', async () => {
    redisStore.clear()

    const resolved = await resolveDynamicWeights({
      cityCode: 'UNKNOWN',
      marketType: 'temperature-low',
      leadBucket: '12to24h',
      availableSources: ['NWS', 'Open-Meteo', 'Google-Weather'],
    })

    expect(resolved.regime).toBe('default')
    const keys = Object.keys(resolved.weights)
    expect(keys.sort()).toEqual(['Google-Weather', 'NWS', 'Open-Meteo'].sort())
    const sum = Object.values(resolved.weights).reduce((s, v) => s + Number(v || 0), 0)
    expect(sum).toBeGreaterThan(0.999)
    expect(sum).toBeLessThan(1.001)
  })
})
