import { beforeEach, describe, expect, it, vi } from 'vitest'
import handler from '@/pages/api/weather/weights'

vi.mock('@/lib/models/sourceAccuracy', () => ({
  getSourceWeightsDetailed: vi.fn(),
  getCityWeightContexts: vi.fn(),
  resolveDynamicWeights: vi.fn(),
  toLeadBucket: vi.fn(),
}))

vi.mock('@/lib/utils/cityCoordinates', () => ({
  CITY_COORDS: {
    NY: { code: 'NY', name: 'New York', lat: 40.78, lng: -73.97 },
    CHI: { code: 'CHI', name: 'Chicago', lat: 41.78, lng: -87.76 },
  },
}))

import * as sourceAccuracy from '@/lib/models/sourceAccuracy'
const getSourceWeightsDetailed = vi.mocked(sourceAccuracy.getSourceWeightsDetailed)
const getCityWeightContexts = vi.mocked(sourceAccuracy.getCityWeightContexts)
const resolveDynamicWeights = vi.mocked(sourceAccuracy.resolveDynamicWeights)
const toLeadBucket = vi.mocked(sourceAccuracy.toLeadBucket)

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

const mockWeightsResult = {
  weights: { 'Open-Meteo': 0.17, 'Google-Weather': 0.17, 'NWS': 0.25, 'AccuWeather': 0.25, 'Tomorrow.io': 0.16 },
  isDynamic: false,
  perSource: { 'Open-Meteo': { mae: 2.1, sampleCount: 20, effectiveN: 15, weight: 0.17 } },
  defaultWeights: { 'Open-Meteo': 0.17, 'Google-Weather': 0.17, 'NWS': 0.25, 'AccuWeather': 0.25, 'Tomorrow.io': 0.16 },
}

beforeEach(() => {
  getSourceWeightsDetailed.mockReset()
  getCityWeightContexts.mockReset()
  resolveDynamicWeights.mockReset()
  toLeadBucket.mockReset()
})

describe('weather/weights API', () => {
  it('rejects non-GET methods', async () => {
    const res = mockRes()
    await handler(mockReq({}, 'POST'), res)
    expect(res.statusCode).toBe(405)
  })

  it('rejects unknown cityCode with 400', async () => {
    const res = mockRes()
    await handler(mockReq({ cityCode: 'FAKE' }), res)
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toBe('Unknown cityCode')
  })

  it('returns weights for valid cityCode without perSource', async () => {
    getSourceWeightsDetailed.mockResolvedValueOnce(mockWeightsResult)
    const res = mockRes()
    await handler(mockReq({ cityCode: 'NY' }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.weights).toEqual(mockWeightsResult.weights)
    expect(res.body.isDynamic).toBe(false)
    expect(res.body.defaultWeights).toEqual(mockWeightsResult.defaultWeights)
    expect(res.body.perSource).toBeUndefined()
  })

  it('returns weights without cityCode (global)', async () => {
    getSourceWeightsDetailed.mockResolvedValueOnce(mockWeightsResult)
    const res = mockRes()
    await handler(mockReq({}), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.cityCode).toBeNull()
  })

  it('handles allContexts=1 mode', async () => {
    const mockContexts = { 'temperature-high:24to48h': { weights: {}, regime: 'city_type_lead' } }
    getCityWeightContexts.mockResolvedValueOnce(mockContexts as any)
    const res = mockRes()
    await handler(mockReq({ cityCode: 'NY', allContexts: '1' }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.contexts).toEqual(mockContexts)
    expect(res.body.cityCode).toBe('NY')
  })

  it('handles marketType + hoursToResolution mode', async () => {
    toLeadBucket.mockReturnValueOnce('24to48h' as any)
    resolveDynamicWeights.mockResolvedValueOnce({
      weights: { 'NWS': 0.40 },
      regime: 'city_type_lead',
      effectiveSampleSize: 25,
      computedAt: Date.now(),
      expiresAt: Date.now() + 3600000,
    } as any)
    const res = mockRes()
    await handler(mockReq({ cityCode: 'NY', marketType: 'temperature-high', hoursToResolution: '36' }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.leadBucket).toBe('24to48h')
    expect(res.body.regime).toBe('city_type_lead')
  })

  it('returns 500 on internal error', async () => {
    getSourceWeightsDetailed.mockRejectedValueOnce(new Error('DB down'))
    const res = mockRes()
    await handler(mockReq({ cityCode: 'NY' }), res)
    expect(res.statusCode).toBe(500)
  })
})
