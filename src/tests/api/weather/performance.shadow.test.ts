import { beforeEach, describe, expect, it, vi } from 'vitest'
import handler from '@/pages/api/weather/performance'

const logSignalMock = vi.fn(async () => 'sig_test')

vi.mock('@/lib/models/performanceTracker', () => ({
  logSignal: (...args: any[]) => logSignalMock(...args),
  resolveSignal: vi.fn(async () => true),
  resolveByMarketId: vi.fn(async () => 1),
  getPerformanceSnapshot: vi.fn(async () => ({ recommendedMinEdge: 0.15 })),
  getSignalHistory: vi.fn(async () => []),
}))

function mockReq(body: Record<string, unknown>) {
  return {
    method: 'POST',
    body,
    headers: {},
    query: {},
  } as any
}

function mockRes() {
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(payload: unknown) {
      this.body = payload
      return this
    },
  }
  return res
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('weather/performance shadow logging', () => {
  it('accepts and forwards shadow probability delta metadata', async () => {
    const res = mockRes()

    await handler(mockReq({
      action: 'log',
      marketId: 'KXHIGHNY-1',
      modelProbability: 0.57,
      marketPrice: 0.49,
      edge: 0.08,
      direction: 'YES',
      signal: 'YES',
      cityCode: 'NYC',
      rawModelProbability: 0.57,
      correctedModelProbability: 0.60,
      probabilityDelta: 0.03,
      shadowMeta: {
        regime: 'city_type_lead',
        contextKey: 'temperature-high:24to48h',
        effectiveSampleSize: 52.4,
      },
    }), res)

    expect(res.statusCode).toBe(200)
    expect(logSignalMock).toHaveBeenCalledTimes(1)
    const payload = logSignalMock.mock.calls[0][0]
    expect(payload.correctedModelProbability).toBe(0.60)
    expect(payload.probabilityDelta).toBe(0.03)
    expect(payload.shadowMeta.contextKey).toBe('temperature-high:24to48h')
  })
})
