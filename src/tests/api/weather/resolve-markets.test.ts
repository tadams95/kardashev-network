import { beforeEach, describe, expect, it, vi } from 'vitest'
import handler from '@/pages/api/weather/resolve-markets'

vi.mock('@/lib/utils/cityCoordinates', () => ({
  CITY_COORDS: {
    NY: { lat: 40.7128, lng: -74.006, name: 'New York', timezone: 'America/New_York' },
  },
}))

vi.mock('@/lib/models/performanceTracker', () => ({
  resolveWithTemperature: vi.fn(async () => ({ resolved: 0, biasRecorded: 0 })),
  getSignalHistory: vi.fn(async () => []),
}))

function mockReq(method: string, headers: Record<string, string> = {}) {
  return { method, headers, query: {}, body: {} } as any
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
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ markets: [] }),
  }) as any))
})

describe('weather/resolve-markets API auth + method enforcement', () => {
  it('rejects non-POST methods', async () => {
    const res = mockRes()

    await handler(mockReq('GET'), res)

    expect(res.statusCode).toBe(405)
    expect(String(res.body.error)).toContain('Method not allowed')
  })

  it('rejects unauthorized POST requests', async () => {
    const res = mockRes()

    await handler(mockReq('POST'), res)

    expect(res.statusCode).toBe(401)
    expect(res.body.error).toBe('Unauthorized')
  })

  it('accepts authorized POST and returns success shape', async () => {
    const res = mockRes()

    await handler(mockReq('POST', { authorization: 'Bearer test-secret' }), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.success).toBe(true)
    expect(typeof res.body.resolved).toBe('number')
    expect(typeof res.body.biasObservations).toBe('number')
  })
})
