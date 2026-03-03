import { beforeEach, describe, expect, it, vi } from 'vitest'

type AnyDoc = Record<string, any>

const sourceAccuracyDocs: AnyDoc[] = []
const snapshotDocs: AnyDoc[] = []

const sourceAccuracyIndexSpy = vi.fn(async () => undefined)
const snapshotIndexSpy = vi.fn(async () => undefined)

function matchesQuery(doc: AnyDoc, query: AnyDoc): boolean {
  return Object.entries(query).every(([k, v]) => doc[k] === v)
}

function makeCollection(name: string) {
  if (name === 'source_accuracy') {
    return {
      createIndex: sourceAccuracyIndexSpy,
      updateOne: async (filter: AnyDoc, update: AnyDoc, opts?: { upsert?: boolean }) => {
        const existing = sourceAccuracyDocs.find(d => matchesQuery(d, filter))
        if (existing) {
          return { matchedCount: 1, modifiedCount: 0, upsertedCount: 0 }
        }
        if (opts?.upsert) {
          sourceAccuracyDocs.push(update.$setOnInsert)
          return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 }
        }
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 }
      },
      find: (query: AnyDoc) => ({
        sort: () => ({
          limit: () => ({
            toArray: async () => sourceAccuracyDocs.filter(d => matchesQuery(d, query)),
          }),
        }),
      }),
    }
  }

  if (name === 'source_prediction_snapshots') {
    return {
      createIndex: snapshotIndexSpy,
      updateOne: async (filter: AnyDoc, update: AnyDoc, opts?: { upsert?: boolean }) => {
        const existing = snapshotDocs.find(d => matchesQuery(d, filter))
        if (existing) {
          return { matchedCount: 1, modifiedCount: 0, upsertedCount: 0 }
        }
        if (opts?.upsert) {
          snapshotDocs.push(update.$setOnInsert)
          return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 }
        }
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 }
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
  rget: async () => null,
  rset: async () => undefined,
}))

import {
  logSourcePredictionSnapshot,
  writeSourceAccuracyFromResolution,
} from '../sourceAccuracy'

beforeEach(() => {
  sourceAccuracyDocs.length = 0
  snapshotDocs.length = 0
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-03-02T12:00:00Z'))
})

describe('Phase 1: source snapshot + linkage', () => {
  it('stores one snapshot with all source forecasts', async () => {
    await logSourcePredictionSnapshot({
      signalId: 'sig_1',
      marketId: 'KXHIGHNY-1',
      cityCode: 'NY',
      marketType: 'high',
      leadHours: 18,
      perSourceForecasts: {
        'Open-Meteo': 73.2,
        'NWS': 74.1,
        'Google-Weather': 72.9,
      },
      isTrade: true,
    })

    expect(snapshotDocs).toHaveLength(1)
    expect(snapshotDocs[0].signalId).toBe('sig_1')
    expect(Object.keys(snapshotDocs[0].perSourceForecasts)).toHaveLength(3)
    expect(snapshotDocs[0].expiresAt).toBeInstanceOf(Date)
  })

  it('writes exactly one source_accuracy row per source snapshot and remains idempotent', async () => {
    await logSourcePredictionSnapshot({
      signalId: 'sig_2',
      marketId: 'KXHIGHNY-2',
      cityCode: 'NY',
      marketType: 'high',
      leadHours: 24,
      perSourceForecasts: {
        'Open-Meteo': 70,
        'NWS': 71,
      },
      isTrade: true,
    })

    const firstWrite = await writeSourceAccuracyFromResolution({
      marketId: 'KXHIGHNY-2',
      signalId: 'sig_2',
      actualTemp: 69,
      groundTruthSource: 'kalshi_midpoint',
    })

    expect(firstWrite).toBe(2)
    expect(sourceAccuracyDocs).toHaveLength(2)

    const secondWrite = await writeSourceAccuracyFromResolution({
      marketId: 'KXHIGHNY-2',
      signalId: 'sig_2',
      actualTemp: 69,
      groundTruthSource: 'kalshi_midpoint',
    })

    expect(secondWrite).toBe(0)
    expect(sourceAccuracyDocs).toHaveLength(2)
  })

  it('creates TTL indexes for snapshots and source accuracy collections', async () => {
    await logSourcePredictionSnapshot({
      signalId: 'sig_ttl',
      marketId: 'KXHIGHCHI-1',
      cityCode: 'CHI',
      marketType: 'high',
      perSourceForecasts: { NWS: 65 },
      isTrade: false,
    })

    const sourceAccuracyTTL = sourceAccuracyIndexSpy.mock.calls.some((call) =>
      JSON.stringify(call[0]) === JSON.stringify({ expiresAt: 1 }) &&
      JSON.stringify(call[1]) === JSON.stringify({ expireAfterSeconds: 0 })
    )

    const snapshotsTTL = snapshotIndexSpy.mock.calls.some((call) =>
      JSON.stringify(call[0]) === JSON.stringify({ expiresAt: 1 }) &&
      JSON.stringify(call[1]) === JSON.stringify({ expireAfterSeconds: 0 })
    )

    expect(sourceAccuracyTTL).toBe(true)
    expect(snapshotsTTL).toBe(true)
  })
})
