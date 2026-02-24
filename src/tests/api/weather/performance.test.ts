import { beforeEach, describe, expect, it, vi } from 'vitest'
import handler from '@/pages/api/weather/performance'

vi.mock('@/lib/models/performanceTracker', () => ({
  logSignal: vi.fn(),
  resolveSignal: vi.fn(),
  resolveByMarketId: vi.fn(),
  getPerformanceSnapshot: vi.fn(),
  getSignalHistory: vi.fn(),
}))

import * as performanceTracker from '@/lib/models/performanceTracker'
const logSignal = vi.mocked(performanceTracker.logSignal)
const resolveSignal = vi.mocked(performanceTracker.resolveSignal)
const resolveByMarketId = vi.mocked(performanceTracker.resolveByMarketId)
const getPerformanceSnapshot = vi.mocked(performanceTracker.getPerformanceSnapshot)
const getSignalHistory = vi.mocked(performanceTracker.getSignalHistory)

function mockReq(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return {
    method: 'POST',
    body,
    headers,
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
  logSignal.mockReset()
  resolveSignal.mockReset()
  resolveByMarketId.mockReset()
  getPerformanceSnapshot.mockReset()
  getSignalHistory.mockReset()
  process.env.CRON_SECRET = 'test-secret'
})

describe('weather/performance mutating API validation', () => {
  it('rejects invalid log payloads', async () => {
    const res = mockRes()

    await handler(mockReq({ action: 'log', marketId: 'm1', modelProbability: 2, marketPrice: 0.5 }), res)

    expect(res.statusCode).toBe(400)
    expect(String(res.body.error)).toContain('modelProbability')
    expect(logSignal).not.toHaveBeenCalled()
  })

  it('requires auth for resolve action', async () => {
    const res = mockRes()

    await handler(mockReq({ action: 'resolve', marketId: 'm1', outcome: true }), res)

    expect(res.statusCode).toBe(401)
    expect(res.body.error).toBe('Unauthorized')
  })

  it('accepts valid authenticated resolve request', async () => {
    resolveByMarketId.mockResolvedValue(1)
    const res = mockRes()

    await handler(
      mockReq(
        { action: 'resolve', marketId: 'm1', outcome: true },
        { authorization: 'Bearer test-secret' }
      ),
      res
    )

    expect(res.statusCode).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.resolved).toBe(1)
    expect(resolveByMarketId).toHaveBeenCalledWith('m1', true)
  })
})