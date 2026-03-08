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

// Future dates for test fixtures (48h from now)
const futureClose = new Date(Date.now() + 36 * 3600_000).toISOString()
const futureExpiration = new Date(Date.now() + 48 * 3600_000).toISOString()
// Past close but future expiration (closed-but-unresolved market)
const pastClose = new Date(Date.now() - 2 * 3600_000).toISOString()

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
    const url = new URL(String(input))
    const seriesTicker = url.searchParams.get('series_ticker') || ''
    const statusParam = url.searchParams.get('status') || ''

    if (seriesTicker.includes('KXLOWDAL')) {
      // Only return the closed market when status=closed is queried
      if (statusParam === 'closed') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            markets: [
              {
                ticker: 'KXLOWDAL-26FEB24-B45',
                title: 'Dallas low temperature below 45°',
                category: 'weather',
                status: 'closed',
                close_time: pastClose,
                expiration_time: futureExpiration,
                expected_expiration_time: futureExpiration,
                strike_type: 'less',
                floor_strike: 45,
                cap_strike: null,
                yes_sub_title: 'Below 45°',
                no_sub_title: '45° or above',
                yes_bid: 30,
                yes_ask: 35,
                volume: 800,
                liquidity: 3000,
                event_ticker: 'KXLOWDAL-26FEB24',
              },
            ],
          }),
        } as any
      }
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
              close_time: futureClose,
              expiration_time: futureExpiration,
              expected_expiration_time: futureExpiration,
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
              close_time: futureClose,
              expiration_time: futureExpiration,
              expected_expiration_time: futureExpiration,
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

describe('dual-status fetch and tradingStatus', () => {
  it('includes closed markets with tradingStatus=closed and resolutionTime from expiration_time', async () => {
    const res = mockRes()

    await handler(mockReq({ city: 'DAL', status: 'active', bypassCache: '1' }), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.success).toBe(true)

    const allMarkets = res.body.data.markets
    const closedMarket = allMarkets.find((m: any) => m.id === 'KXLOWDAL-26FEB24-B45')
    const openMarket = allMarkets.find((m: any) => m.id === 'KXLOWDAL-26FEB24-B50')

    // Closed market should be present (not filtered out)
    expect(closedMarket).toBeTruthy()
    expect(closedMarket.tradingStatus).toBe('closed')
    expect(closedMarket.status).toBe('active') // not 'canceled'
    // resolutionTime should come from expected_expiration_time, not close_time
    expect(closedMarket.resolutionTime).toBe(futureExpiration)

    // Open market should also be present with tradingStatus=open
    expect(openMarket).toBeTruthy()
    expect(openMarket.tradingStatus).toBe('open')
  })

  it('degrades gracefully when closed-market query fails — open markets still returned', async () => {
    // Override fetch to fail on status=closed queries
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      const url = new URL(String(input))
      const seriesTicker = url.searchParams.get('series_ticker') || ''
      const statusParam = url.searchParams.get('status') || ''

      // Simulate closed query failure (network error via rejected promise)
      if (statusParam === 'closed') {
        throw new Error('Network error')
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
                close_time: futureClose,
                expiration_time: futureExpiration,
                expected_expiration_time: futureExpiration,
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

    const res = mockRes()
    await handler(mockReq({ city: 'DAL', status: 'active', bypassCache: '1' }), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.success).toBe(true)

    // Open markets should still be returned despite closed-query failures
    const openMarket = res.body.data.markets.find((m: any) => m.id === 'KXHIGHDAL-26FEB24-B70')
    expect(openMarket).toBeTruthy()
    expect(openMarket.tradingStatus).toBe('open')
  })
})
