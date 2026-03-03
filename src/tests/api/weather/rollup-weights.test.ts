import { beforeEach, describe, expect, it, vi } from 'vitest'
import handler from '@/pages/api/weather/rollup-weights'

vi.mock('@/lib/models/weightRollupJob', () => ({
  runWeightRollupJob: vi.fn(),
}))

vi.mock('@/lib/utils/apiAuth', () => ({
  requireAuth: vi.fn(),
}))

import * as weightRollupJob from '@/lib/models/weightRollupJob'
import * as apiAuth from '@/lib/utils/apiAuth'
const runWeightRollupJob = vi.mocked(weightRollupJob.runWeightRollupJob)
const requireAuth = vi.mocked(apiAuth.requireAuth)

function mockReq(body: Record<string, unknown> = {}, method = 'POST', headers: Record<string, string> = {}) {
  return { method, body, headers } as any
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
  runWeightRollupJob.mockReset()
  requireAuth.mockReset()
})

describe('weather/rollup-weights API', () => {
  it('rejects non-POST methods', async () => {
    const res = mockRes()
    await handler(mockReq({}, 'GET'), res)
    expect(res.statusCode).toBe(405)
  })

  it('rejects unauthenticated requests with 401', async () => {
    requireAuth.mockReturnValueOnce(false)
    const res = mockRes()
    await handler(mockReq({}), res)
    expect(res.statusCode).toBe(401)
  })

  it('accepts authenticated POST and returns result', async () => {
    requireAuth.mockReturnValueOnce(true)
    runWeightRollupJob.mockResolvedValueOnce({ keysWritten: 42, durationMs: 150 })
    const res = mockRes()
    await handler(mockReq({ cityCodes: ['NY'] }), res)
    expect(res.statusCode).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.data.keysWritten).toBe(42)
  })

  it('returns 500 on internal error', async () => {
    requireAuth.mockReturnValueOnce(true)
    runWeightRollupJob.mockRejectedValueOnce(new Error('DB down'))
    const res = mockRes()
    await handler(mockReq({}), res)
    expect(res.statusCode).toBe(500)
    expect(res.body.success).toBe(false)
  })
})
