import { beforeEach, describe, expect, it, vi } from 'vitest'
import handler from '@/pages/api/weather/resolve-markets'

const mocks = vi.hoisted(() => ({
  resolveWithTemperature: vi.fn(async () => ({ resolved: 1, biasRecorded: 0 })),
  getSignalHistory: vi.fn(async () => []),
  getUnresolvedSignals: vi.fn(async () => []),
  writeSourceAccuracyFromServerSnapshot: vi.fn(async () => 0),
}))

vi.mock('@/lib/utils/cityCoordinates', () => ({
  CITY_COORDS: {
    NY: { lat: 40.7128, lng: -74.006, name: 'New York', timezone: 'America/New_York' },
  },
}))

vi.mock('@/lib/models/performanceTracker', () => ({
  resolveWithTemperature: mocks.resolveWithTemperature,
  getSignalHistory: mocks.getSignalHistory,
  getUnresolvedSignals: mocks.getUnresolvedSignals,
}))

vi.mock('@/lib/models/sourceAccuracy', () => ({
  writeSourceAccuracyFromServerSnapshot: mocks.writeSourceAccuracyFromServerSnapshot,
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
  mocks.resolveWithTemperature.mockClear()
  mocks.getSignalHistory.mockClear()
  mocks.getUnresolvedSignals.mockClear()
  mocks.writeSourceAccuracyFromServerSnapshot.mockClear()
  mocks.getSignalHistory.mockResolvedValue([])
  mocks.getUnresolvedSignals.mockResolvedValue([])
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

  it('resolves each market using Kalshi market.result, not a single winning ticker', async () => {
    mocks.getUnresolvedSignals.mockResolvedValue([
      { marketId: 'KXHIGHNY-26MAR07-T55' },
      { marketId: 'KXHIGHNY-26MAR07-T60' },
      { marketId: 'KXHIGHNY-26MAR07-B60.5' },
    ])

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        markets: [
          {
            ticker: 'KXHIGHNY-26MAR07-T55',
            title: 'New York high temperature above 55°',
            status: 'settled',
            result: 'yes',
            close_time: '2026-03-08T00:00:00Z',
            strike_type: 'greater',
            floor_strike: 55,
            cap_strike: null,
            yes_sub_title: 'Above 55°',
            no_sub_title: '55° or below',
            event_ticker: 'KXHIGHNY-26MAR07',
          },
          {
            ticker: 'KXHIGHNY-26MAR07-T60',
            title: 'New York high temperature above 60°',
            status: 'settled',
            result: 'no',
            close_time: '2026-03-08T00:00:00Z',
            strike_type: 'greater',
            floor_strike: 60,
            cap_strike: null,
            yes_sub_title: 'Above 60°',
            no_sub_title: '60° or below',
            event_ticker: 'KXHIGHNY-26MAR07',
          },
          {
            ticker: 'KXHIGHNY-26MAR07-B60.5',
            title: 'New York high temperature between 60° and 61°',
            status: 'settled',
            result: 'yes',
            close_time: '2026-03-08T00:00:00Z',
            strike_type: 'between',
            floor_strike: 60,
            cap_strike: 61,
            yes_sub_title: '60° to 61°',
            no_sub_title: 'Outside 60° to 61°',
            event_ticker: 'KXHIGHNY-26MAR07',
          },
        ],
      }),
    }) as any))

    const res = mockRes()
    await handler(mockReq('POST', { authorization: 'Bearer test-secret' }), res)

    expect(res.statusCode).toBe(200)
    expect(mocks.resolveWithTemperature).toHaveBeenCalledWith('KXHIGHNY-26MAR07-T55', true, 60.5)
    expect(mocks.resolveWithTemperature).toHaveBeenCalledWith('KXHIGHNY-26MAR07-T60', false, 60.5)
    expect(mocks.resolveWithTemperature).toHaveBeenCalledWith('KXHIGHNY-26MAR07-B60.5', true, 60.5)
  })
})
