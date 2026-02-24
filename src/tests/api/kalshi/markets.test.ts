import { beforeEach, describe, expect, it, vi } from 'vitest'
import handler from '@/pages/api/kalshi/markets'

vi.mock('@/lib/cache/redis', () => ({
  rget: vi.fn(async () => null),
  rset: vi.fn(async () => undefined),
}))

function mockReq(query: Record<string, unknown>) {
  return {
    method: 'GET',
    query,
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
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
    const url = new URL(String(input))
    const seriesTicker = url.searchParams.get('series_ticker') || ''

    if (seriesTicker.includes('KXLOWDAL')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          markets: [
            {
              ticker: 'KXLOWDAL-26FEB24-B50',
              title: 'Dallas low temperature below 50°',
              category: 'weather',
              status: 'open',
              close_time: '2026-03-01T15:00:00Z',
              expiration_time: '2026-03-01T15:00:00Z',
              strike_type: 'less',
              floor_strike: 50,
              cap_strike: null,
              yes_sub_title: 'Below 50°',
              no_sub_title: '50° or above',
              yes_bid: 40,
              yes_ask: 44,
              volume: 1000,
              liquidity: 5000,
              event_ticker: 'KXLOWDAL-26FEB24',
            },
          ],
        }),
      } as any
    }

    if (seriesTicker.includes('KXHIGHDAL')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          markets: [
            {
              ticker: 'KXHIGHDAL-26FEB24-B70',
              title: 'Dallas high temperature above 70°',
              category: 'weather',
              status: 'open',
              close_time: '2026-03-01T15:00:00Z',
              expiration_time: '2026-03-01T15:00:00Z',
              strike_type: 'greater',
              floor_strike: 70,
              cap_strike: null,
              yes_sub_title: 'Above 70°',
              no_sub_title: '70° or below',
              yes_bid: 55,
              yes_ask: 60,
              volume: 1000,
              liquidity: 5000,
              event_ticker: 'KXHIGHDAL-26FEB24',
            },
          ],
        }),
      } as any
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({ markets: [] }),
    } as any
  }))
})

describe('kalshi markets parser edge cases', () => {
  it('parses LOW series as low-temperature / below direction', async () => {
    const res = mockRes()

    await handler(mockReq({ city: 'DAL', status: 'active', bypassCache: '1' }), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.success).toBe(true)

    const lowMarket = res.body.data.markets.find((m: any) => m.id.includes('KXLOWDAL'))
    expect(lowMarket).toBeTruthy()
    expect(lowMarket.temperatureType).toBe('low')
    expect(lowMarket.direction).toBe('below')
    expect(lowMarket.threshold).toBe(50)
  })

  it('avoids city-code substring collision (DAL should not map to LA)', async () => {
    const res = mockRes()

    await handler(mockReq({ city: 'DAL', status: 'active', bypassCache: '1' }), res)

    const highDal = res.body.data.markets.find((m: any) => m.id.includes('KXHIGHDAL'))
    expect(highDal).toBeTruthy()
    expect(highDal.location.city).toBe('Dallas')
  })
})