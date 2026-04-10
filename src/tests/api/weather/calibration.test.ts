import { beforeEach, describe, expect, it, vi } from 'vitest'
import handler from '@/pages/api/weather/calibration'

vi.mock('@/lib/db/mongodb', () => ({
  getDb: vi.fn(() => ({
    collection: () => ({
      replaceOne: vi.fn(async () => ({ acknowledged: true })),
      findOne: vi.fn(async () => null),
    }),
  })),
}))

vi.mock('@/lib/models/weatherProbability', () => ({
  setCalibrationModel: vi.fn(),
}))

import * as mongodb from '@/lib/db/mongodb'
import * as weatherProbability from '@/lib/models/weatherProbability'

function mockReq(method: string, body: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return { method, body, headers, query: {} } as any
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
  process.env.CRON_SECRET = 'test-secret'
  process.env.NEXT_PUBLIC_INTERNAL_API_KEY = 'test-internal-key'
  vi.clearAllMocks()
})

describe('weather/calibration GET read auth', () => {
  it('rejects GET without any Authorization header', async () => {
    const res = mockRes()
    await handler(mockReq('GET'), res)
    expect(res.statusCode).toBe(401)
    expect(res.body.error).toBe('Unauthorized')
  })

  it('rejects GET with wrong bearer token', async () => {
    const res = mockRes()
    await handler(mockReq('GET', {}, { authorization: 'Bearer wrong-token' }), res)
    expect(res.statusCode).toBe(401)
    expect(res.body.error).toBe('Unauthorized')
  })

  it('accepts GET with CRON_SECRET bearer token', async () => {
    const db = vi.mocked(mongodb.getDb)
    db.mockReturnValue({
      collection: () => ({
        findOne: vi.fn(async () => ({
          _id: 'active',
          breakpoints: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
          trainedAt: Date.now(),
          sampleSize: 100,
          calibrationError: 0.1,
          brierBefore: 0.2,
          brierAfter: 0.18,
        })),
      }),
    } as any)

    const res = mockRes()
    await handler(mockReq('GET', {}, { authorization: 'Bearer test-secret' }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.success).toBe(true)
  })

  it('accepts GET with NEXT_PUBLIC_INTERNAL_API_KEY bearer token', async () => {
    const db = vi.mocked(mongodb.getDb)
    db.mockReturnValue({
      collection: () => ({
        findOne: vi.fn(async () => ({
          _id: 'active',
          breakpoints: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
          trainedAt: Date.now(),
          sampleSize: 100,
          calibrationError: 0.1,
          brierBefore: 0.2,
          brierAfter: 0.18,
        })),
      }),
    } as any)

    const res = mockRes()
    await handler(mockReq('GET', {}, { authorization: 'Bearer test-internal-key' }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.success).toBe(true)
  })
})

describe('weather/calibration mutating API security', () => {
  it('rejects unauthorized POST requests', async () => {
    const res = mockRes()

    await handler(mockReq('POST', { breakpoints: [{ x: 0, y: 0 }] }), res)

    expect(res.statusCode).toBe(401)
    expect(res.body.error).toBe('Unauthorized')
  })

  it('rejects invalid calibration payloads even when authorized', async () => {
    const res = mockRes()

    await handler(
      mockReq(
        'POST',
        { breakpoints: [] },
        { authorization: 'Bearer test-secret' }
      ),
      res
    )

    expect(res.statusCode).toBe(400)
    expect(String(res.body.error)).toContain('Invalid calibration model')
  })

  it('accepts valid authorized payload and persists sanitized model', async () => {
    const db = vi.mocked(mongodb.getDb)
    const replaceOne = vi.fn(async () => ({ acknowledged: true }))
    db.mockReturnValue({
      collection: () => ({ replaceOne, findOne: vi.fn(async () => null) }),
    } as any)

    const res = mockRes()
    await handler(
      mockReq(
        'POST',
        {
          breakpoints: [{ x: 1, y: 1 }, { x: 0, y: 0 }],
          trainedAt: Date.now(),
          sampleSize: 100,
          calibrationError: 0.1,
          brierBefore: 0.2,
          brierAfter: 0.18,
        },
        { authorization: 'Bearer test-secret' }
      ),
      res
    )

    expect(res.statusCode).toBe(200)
    expect(res.body.success).toBe(true)
    expect(replaceOne).toHaveBeenCalledTimes(1)
    expect(vi.mocked(weatherProbability.setCalibrationModel)).toHaveBeenCalledTimes(1)
  })

  it('trains segmented calibration bundle from resolved prediction history', async () => {
    const db = vi.mocked(mongodb.getDb)
    const replaceOne = vi.fn(async () => ({ acknowledged: true }))

    const now = Date.now()
    const trainingRows = Array.from({ length: 240 }, (_, i) => ({
      correctedProbability: 0.35 + (i % 10) * 0.05,
      resolvedOutcome: i % 2 === 0 ? 1 : 0,
      marketType: 'temperature-high' as const,
      hoursToResolution: 30,
      timestamp: now - i * 60_000,
    }))

    db.mockReturnValue({
      collection: (name: string) => {
        if (name === 'calibration') {
          return { replaceOne, findOne: vi.fn(async () => null) }
        }
        if (name === 'market_predictions') {
          return {
            find: vi.fn(() => ({
              sort: vi.fn(() => ({
                limit: vi.fn(() => ({ toArray: vi.fn(async () => trainingRows) })),
              })),
            })),
          }
        }
        return { replaceOne, findOne: vi.fn(async () => null) }
      },
    } as any)

    const res = mockRes()
    await handler(
      mockReq(
        'POST',
        { action: 'train', lookbackDays: 365 },
        { authorization: 'Bearer test-secret' }
      ),
      res
    )

    expect(res.statusCode).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.kind).toBe('segmented-v1')
    expect(res.body.data.global.sampleSize).toBe(240)
    expect(replaceOne).toHaveBeenCalledTimes(1)
  })
})
