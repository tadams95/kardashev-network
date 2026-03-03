import { beforeEach, describe, expect, it, vi } from 'vitest'
import handler from '@/pages/api/weather/bias'

vi.mock('@/lib/models/temperatureBias', () => ({
  getCityBias: vi.fn(),
}))

import * as temperatureBias from '@/lib/models/temperatureBias'
const getCityBias = vi.mocked(temperatureBias.getCityBias)

function mockReq(query: Record<string, unknown> = {}, method = 'GET') {
  return { method, query } as any
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
  getCityBias.mockReset()
})

describe('weather/bias API', () => {
  it('caps correction at +5°F / -5°F when bias is large', async () => {
    getCityBias.mockResolvedValueOnce({ cityCode: 'NY', meanError: -20, sampleCount: 50, lastUpdated: Date.now(), effectiveSampleSize: 30 })
    const res1 = mockRes()
    await handler(mockReq({ cityCode: 'NY' }), res1)
    expect(res1.statusCode).toBe(200)
    expect(res1.body.correction).toBe(5)

    getCityBias.mockResolvedValueOnce({ cityCode: 'NY', meanError: 20, sampleCount: 50, lastUpdated: Date.now(), effectiveSampleSize: 30 })
    const res2 = mockRes()
    await handler(mockReq({ cityCode: 'NY' }), res2)
    expect(res2.statusCode).toBe(200)
    expect(res2.body.correction).toBe(-5)
  })

  it('does not activate correction below minimum effective sample size', async () => {
    getCityBias.mockResolvedValue({ cityCode: 'NY', meanError: 10, sampleCount: 25, lastUpdated: Date.now(), effectiveSampleSize: 8 })
    const res = mockRes()

    await handler(mockReq({ cityCode: 'NY' }), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.isActive).toBe(false)
    expect(res.body.correction).toBe(0)
    expect(res.body.minSamples).toBe(12)
  })
})