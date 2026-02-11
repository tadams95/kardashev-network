import { describe, it, expect, beforeEach } from 'vitest'
import {
  logSignal,
  resolveSignal,
  getPerformanceSnapshot,
  clearSignalHistory,
} from '../performanceTracker'

beforeEach(() => {
  clearSignalHistory()
})

describe('logSignal', () => {
  it('returns an ID and stores the signal', () => {
    const id = logSignal({
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

    const snapshot = getPerformanceSnapshot()
    expect(snapshot.totalSignals).toBe(1)
  })
})

describe('resolveSignal', () => {
  it('marks outcome correctly', () => {
    const id = logSignal({
      marketId: 'TEST-002',
      timestamp: Date.now(),
      modelProbability: 0.80,
      marketPrice: 0.60,
      edge: 0.20,
      direction: 'YES',
      signal: 'STRONG_BUY',
    })

    const resolved = resolveSignal(id, true)
    expect(resolved).toBe(true)

    const snapshot = getPerformanceSnapshot()
    expect(snapshot.resolvedSignals).toBe(1)
    expect(snapshot.winRate).toBe(1.0)
  })

  it('returns false for unknown signal ID', () => {
    expect(resolveSignal('nonexistent', true)).toBe(false)
  })
})

describe('getPerformanceSnapshot', () => {
  it('returns baseline when empty', () => {
    const snapshot = getPerformanceSnapshot()

    expect(snapshot.totalSignals).toBe(0)
    expect(snapshot.resolvedSignals).toBe(0)
    expect(snapshot.winRate).toBe(0.5) // Default when no resolved signals
    expect(snapshot.modelDecay).toBe(false)
    expect(snapshot.recommendedMinEdge).toBe(0.15)
  })

  it('detects model decay at low win rate', () => {
    // Log 25 signals, all resolved as losses
    for (let i = 0; i < 25; i++) {
      const id = logSignal({
        marketId: `DECAY-${i}`,
        timestamp: Date.now(),
        modelProbability: 0.70,
        marketPrice: 0.50,
        edge: 0.20,
        direction: 'YES',
        signal: 'BUY',
      })
      resolveSignal(id, false)
    }

    const snapshot = getPerformanceSnapshot()
    expect(snapshot.winRate).toBe(0)
    expect(snapshot.modelDecay).toBe(true)
  })

  it('increases recommendedMinEdge when decaying', () => {
    // Create enough resolved losing signals to trigger decay
    for (let i = 0; i < 25; i++) {
      const id = logSignal({
        marketId: `EDGE-${i}`,
        timestamp: Date.now(),
        modelProbability: 0.70,
        marketPrice: 0.50,
        edge: 0.20,
        direction: 'YES',
        signal: 'BUY',
      })
      resolveSignal(id, false)
    }

    const snapshot = getPerformanceSnapshot()
    expect(snapshot.recommendedMinEdge).toBeGreaterThan(0.15)
    expect(snapshot.recommendedMinEdge).toBeLessThanOrEqual(0.25)
  })
})
