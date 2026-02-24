import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TemperatureObservation } from '../temperatureBias'

const observations: TemperatureObservation[] = []
const createIndex = vi.fn(async () => undefined)
const insertOne = vi.fn(async (doc: TemperatureObservation) => {
  observations.push(doc)
})

vi.mock('@/lib/db/mongodb', () => ({
  getDb: () => ({
    collection: () => ({
      createIndex,
      insertOne,
      find: (query: { cityCode: string }) => ({
        sort: () => ({
          limit: () => ({
            toArray: async () => observations
              .filter(o => o.cityCode === query.cityCode)
              .sort((a, b) => b.timestamp - a.timestamp),
          }),
        }),
      }),
    }),
  }),
}))

import { getCityBias, recordTemperatureObservation } from '../temperatureBias'

beforeEach(() => {
  observations.length = 0
  createIndex.mockClear()
  insertOne.mockClear()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-02-24T12:00:00Z'))
})

describe('temperatureBias decay behavior', () => {
  it('weights recent observations more than older observations', async () => {
    observations.push(
      {
        cityCode: 'NY',
        forecastTemp: 70,
        actualTemp: 74,
        error: -4,
        timestamp: Date.now() - 40 * 24 * 60 * 60 * 1000,
      },
      {
        cityCode: 'NY',
        forecastTemp: 76,
        actualTemp: 72,
        error: 4,
        timestamp: Date.now() - 1 * 24 * 60 * 60 * 1000,
      }
    )

    const bias = await getCityBias('NY')

    expect(bias).not.toBeNull()
    expect(bias!.meanError).toBeGreaterThan(0)
    expect(bias!.lastUpdated).toBe(observations[1].timestamp)
  })

  it('records observation metadata for lineage', async () => {
    await recordTemperatureObservation('CHI', 60, 58, ['NWS'], {
      signalId: 'sig_1',
      marketId: 'KXLOWCHI',
      leadHours: 18,
      policyVersion: 'v2',
    })

    expect(insertOne).toHaveBeenCalledTimes(1)
    const saved = observations[0]
    expect(saved.signalId).toBe('sig_1')
    expect(saved.marketId).toBe('KXLOWCHI')
    expect(saved.leadHours).toBe(18)
    expect(saved.actualProxy).toBe('kalshi_bracket_midpoint')
    expect(saved.policyVersion).toBe('v2')
  })
})
