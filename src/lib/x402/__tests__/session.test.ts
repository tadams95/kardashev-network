import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/cache/redis', () => {
  const store = new Map<string, any>()
  return {
    rget: vi.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
    rset: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value)
    }),
    rdel: vi.fn(async (key: string) => {
      store.delete(key)
    }),
    rsetnx: vi.fn(async (key: string, value: unknown) => {
      if (store.has(key)) return false
      store.set(key, value)
      return true
    }),
    __resetRedisMock: () => store.clear(),
  }
})

import {
  acquirePaymentReplayLock,
  createX402Session,
  getSessionFromToken,
  getSessionFromWallet,
  markPaymentConsumed,
  releasePaymentReplayLock,
} from '../session'
import * as redis from '@/lib/cache/redis'

beforeEach(() => {
  ;(redis as any).__resetRedisMock()
})

describe('x402 session integrity', () => {
  it('rejects tampered session tokens', async () => {
    const { token } = await createX402Session({
      payer: '0xabc1230000000000000000000000000000000001',
      network: 'base-sepolia',
      txHash: '0xhash1',
    })

    const valid = await getSessionFromToken(token)
    expect(valid).not.toBeNull()

    const [payload] = token.split('.')
    const tampered = `${payload}.tampered-signature`
    const invalid = await getSessionFromToken(tampered)
    expect(invalid).toBeNull()
  })

  it('does not allow wallet-session lookup hijack by different address', async () => {
    await createX402Session({
      payer: '0xabc1230000000000000000000000000000000001',
      network: 'base-sepolia',
      txHash: '0xhash2',
    })

    const owner = await getSessionFromWallet('0xAbC1230000000000000000000000000000000001')
    const attacker = await getSessionFromWallet('0xdef0000000000000000000000000000000000002')

    expect(owner).not.toBeNull()
    expect(attacker).toBeNull()
  })
})

describe('x402 replay protection', () => {
  it('enforces in-flight replay lock uniqueness', async () => {
    const key = 'payment-hash-1'

    const first = await acquirePaymentReplayLock(key)
    const second = await acquirePaymentReplayLock(key)
    expect(first).toBe(true)
    expect(second).toBe(false)

    await releasePaymentReplayLock(key)
    const third = await acquirePaymentReplayLock(key)
    expect(third).toBe(true)
  })

  it('marks transaction as consumed only once', async () => {
    const first = await markPaymentConsumed('base-sepolia', '0xtx1')
    const second = await markPaymentConsumed('base-sepolia', '0xtx1')

    expect(first).toBe(true)
    expect(second).toBe(false)
  })
})
