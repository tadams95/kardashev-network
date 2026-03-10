import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config()

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import {
  logSignal,
  resolveSignal,
  getPerformanceSnapshot,
  clearSignalHistory,
} from '../performanceTracker'
import { closeClient } from '@/lib/db/mongodb'

// Use isolated test database to prevent production data contamination
beforeAll(() => {
  process.env.MONGODB_DB_NAME = 'kardashev_test'
})

beforeEach(async () => {
  await clearSignalHistory()
})

afterAll(async () => {
  await clearSignalHistory()
  await closeClient()
  delete process.env.MONGODB_DB_NAME
})

describe('logSignal', () => {
  it('returns an ID and stores the signal', async () => {
    const id = await logSignal({
      marketId: 'TEST-001',
      timestamp: Date.now(),
      modelProbability: 0.75,
      marketPrice: 0.55,
      edge: 0.20,
      direction: 'YES',
      signal: 'BUY',
    })

    expect(id).toBeTruthy()
    expect(id).toMatch(/^sig_/)

    const snapshot = await getPerformanceSnapshot()
    expect(snapshot.totalSignals).toBe(1)
  })
})

describe('resolveSignal', () => {
  it('marks outcome correctly', async () => {
    const id = await logSignal({
      marketId: 'TEST-002',
      timestamp: Date.now(),
      modelProbability: 0.80,
      marketPrice: 0.60,
      edge: 0.20,
      direction: 'YES',
      signal: 'STRONG_BUY',
    })

    const resolved = await resolveSignal(id, true)
    expect(resolved).toBe(true)

    const snapshot = await getPerformanceSnapshot()
    expect(snapshot.resolvedSignals).toBe(1)
    expect(snapshot.winRate).toBe(1.0)
  })

  it('returns false for unknown signal ID', async () => {
    expect(await resolveSignal('nonexistent', true)).toBe(false)
  })
})

describe('getPerformanceSnapshot', () => {
  it('returns baseline when empty', async () => {
    const snapshot = await getPerformanceSnapshot()

    expect(snapshot.totalSignals).toBe(0)
    expect(snapshot.resolvedSignals).toBe(0)
    expect(snapshot.winRate).toBe(0.5) // Default when no resolved signals
    expect(snapshot.modelDecay).toBe(false)
    expect(snapshot.recommendedMinEdge).toBe(0.15)
  })

  it('detects model decay at low win rate', async () => {
    // Log 25 signals, all resolved as losses
    for (let i = 0; i < 25; i++) {
      const id = await logSignal({
        marketId: `DECAY-${i}`,
        timestamp: Date.now(),
        modelProbability: 0.70,
        marketPrice: 0.50,
        edge: 0.20,
        direction: 'YES',
        signal: 'BUY',
      })
      await resolveSignal(id, false)
    }

    const snapshot = await getPerformanceSnapshot()
    expect(snapshot.winRate).toBe(0)
    expect(snapshot.modelDecay).toBe(true)
  }, 20000)

  it('counts a NO trade with market outcome false as a win', async () => {
    await clearSignalHistory()

    const id = await logSignal({
      marketId: 'NO-WIN-1',
      timestamp: Date.now(),
      modelProbability: 0.25,
      marketPrice: 0.55,
      edge: 0.30,
      direction: 'NO',
      signal: 'NO',
    })

    await resolveSignal(id, false)

    const snapshot = await getPerformanceSnapshot()
    expect(snapshot.resolvedSignals).toBe(1)
    expect(snapshot.winRate).toBe(1)
    expect(snapshot.avgReturn).toBeGreaterThan(0)
  }, 20000)

  it('increases recommendedMinEdge when decaying', async () => {
    // Create enough resolved losing signals to trigger decay
    for (let i = 0; i < 25; i++) {
      const id = await logSignal({
        marketId: `EDGE-${i}`,
        timestamp: Date.now(),
        modelProbability: 0.70,
        marketPrice: 0.50,
        edge: 0.20,
        direction: 'YES',
        signal: 'BUY',
      })
      await resolveSignal(id, false)
    }

    const snapshot = await getPerformanceSnapshot()
    expect(snapshot.recommendedMinEdge).toBeGreaterThan(0.15)
    expect(snapshot.recommendedMinEdge).toBeLessThanOrEqual(0.25)
  }, 20000)
})
