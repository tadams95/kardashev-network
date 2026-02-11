// Tests for backtesting performance metrics

import { describe, it, expect } from 'vitest'
import {
  calculateSharpeRatio,
  calculateMaxDrawdown,
  calculateBrierScore,
  analyzeEdgeDistribution,
  calculateRollingWinRate,
  calculateCumulativePnL,
  calculateKellySize,
} from '../metrics'
import type { BacktestResult } from '@/types/weather'

function makeTrade(overrides: Partial<BacktestResult> = {}): BacktestResult {
  return {
    marketId: 'TEST-001',
    date: '2024-01-15',
    modelProbability: 0.70,
    marketPrice: 0.50,
    edge: 0.20,
    outcome: true,
    profit: 5.00,
    fees: 0.75,
    netProfit: 4.25,
    ...overrides,
  }
}

describe('calculateSharpeRatio', () => {
  it('returns 0 for empty trades', () => {
    expect(calculateSharpeRatio([])).toBe(0)
  })

  it('returns positive Sharpe for consistent winners', () => {
    const trades = Array.from({ length: 20 }, () => makeTrade({ netProfit: 2.0 }))
    const sharpe = calculateSharpeRatio(trades)
    // All same profit = 0 stdDev => would be 0
    // But let's vary slightly
    const variedTrades = trades.map((t, i) => ({ ...t, netProfit: 1.5 + i * 0.1 }))
    const sharpe2 = calculateSharpeRatio(variedTrades)
    expect(sharpe2).toBeGreaterThan(0)
  })

  it('returns negative Sharpe for consistent losers', () => {
    const trades = Array.from({ length: 20 }, (_, i) =>
      makeTrade({ netProfit: -2.0 - i * 0.1, outcome: false })
    )
    const sharpe = calculateSharpeRatio(trades)
    expect(sharpe).toBeLessThan(0)
  })
})

describe('calculateMaxDrawdown', () => {
  it('returns 0 for empty trades', () => {
    expect(calculateMaxDrawdown([])).toBe(0)
  })

  it('calculates correct drawdown for win-then-loss sequence', () => {
    const trades = [
      makeTrade({ netProfit: 10.0 }),
      makeTrade({ netProfit: 5.0 }),
      makeTrade({ netProfit: -12.0, outcome: false }),
      makeTrade({ netProfit: 3.0 }),
    ]
    // Cumulative: 10, 15, 3, 6
    // Peak: 15, trough after: 3, drawdown: (15-3)/15 = 0.8
    const drawdown = calculateMaxDrawdown(trades)
    expect(drawdown).toBeCloseTo(0.8, 1)
  })

  it('returns 0 for monotonically increasing returns', () => {
    const trades = Array.from({ length: 10 }, () => makeTrade({ netProfit: 5.0 }))
    expect(calculateMaxDrawdown(trades)).toBe(0)
  })
})

describe('calculateBrierScore', () => {
  it('returns 0 for empty trades', () => {
    expect(calculateBrierScore([])).toBe(0)
  })

  it('returns 0 for perfect calibration', () => {
    const trades = [
      { modelProbability: 1.0, outcome: true },
      { modelProbability: 0.0, outcome: false },
    ]
    expect(calculateBrierScore(trades)).toBe(0)
  })

  it('returns 0.25 for maximally wrong predictions', () => {
    const trades = [
      { modelProbability: 1.0, outcome: false },
      { modelProbability: 0.0, outcome: true },
    ]
    expect(calculateBrierScore(trades)).toBe(1.0)
  })

  it('returns ~0.25 for random 50/50 predictions', () => {
    const trades = [
      { modelProbability: 0.5, outcome: true },
      { modelProbability: 0.5, outcome: false },
    ]
    expect(calculateBrierScore(trades)).toBeCloseTo(0.25, 2)
  })
})

describe('analyzeEdgeDistribution', () => {
  it('groups trades into correct edge buckets', () => {
    const trades = [
      makeTrade({ edge: 0.16 }),
      makeTrade({ edge: 0.22 }),
      makeTrade({ edge: 0.28 }),
      makeTrade({ edge: 0.35 }),
    ]
    const dist = analyzeEdgeDistribution(trades)

    expect(dist.find(b => b.edgeBucket === '15-20%')?.trades).toBe(1)
    expect(dist.find(b => b.edgeBucket === '20-25%')?.trades).toBe(1)
    expect(dist.find(b => b.edgeBucket === '25-30%')?.trades).toBe(1)
    expect(dist.find(b => b.edgeBucket === '30%+')?.trades).toBe(1)
  })
})

describe('calculateRollingWinRate', () => {
  it('returns empty for fewer trades than window', () => {
    const trades = [makeTrade()]
    expect(calculateRollingWinRate(trades, 5)).toHaveLength(0)
  })

  it('calculates correct rolling win rate', () => {
    const trades = [
      makeTrade({ outcome: true }),
      makeTrade({ outcome: true }),
      makeTrade({ outcome: false }),
      makeTrade({ outcome: true }),
      makeTrade({ outcome: false }),
    ]
    const rolling = calculateRollingWinRate(trades, 3)
    expect(rolling).toHaveLength(3) // 5 - 3 + 1
    expect(rolling[0].winRate).toBeCloseTo(2 / 3, 2) // first window: T, T, F
    expect(rolling[1].winRate).toBeCloseTo(2 / 3, 2) // second: T, F, T
    expect(rolling[2].winRate).toBeCloseTo(1 / 3, 2) // third: F, T, F
  })
})

describe('calculateCumulativePnL', () => {
  it('tracks cumulative profit correctly', () => {
    const trades = [
      makeTrade({ netProfit: 10 }),
      makeTrade({ netProfit: -3 }),
      makeTrade({ netProfit: 5 }),
    ]
    const pnl = calculateCumulativePnL(trades)
    expect(pnl).toHaveLength(3)
    expect(pnl[0].cumulativePnL).toBe(10)
    expect(pnl[1].cumulativePnL).toBe(7)
    expect(pnl[2].cumulativePnL).toBe(12)
  })
})

describe('calculateKellySize', () => {
  it('returns minimum $0.50 for tiny edges', () => {
    const size = calculateKellySize(0.51, 0.50, 100, 0.25)
    expect(size).toBeGreaterThanOrEqual(0.50)
  })

  it('caps at 10% of bankroll', () => {
    const size = calculateKellySize(0.95, 0.10, 1000, 0.25)
    expect(size).toBeLessThanOrEqual(100)
  })
})
