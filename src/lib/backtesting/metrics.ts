// Performance metrics for backtesting
// Sharpe ratio, max drawdown, Brier score, edge distribution analysis

import type { BacktestResult } from '@/types/weather'

/**
 * Calculate Sharpe ratio (risk-adjusted returns)
 * Formula: (average return) / (standard deviation of returns)
 * >1.0 is good, >2.0 is excellent
 *
 * @param trades - Array of backtest trade results
 * @returns Sharpe ratio
 */
export function calculateSharpeRatio(trades: BacktestResult[]): number {
  if (trades.length === 0) return 0

  const returns = trades.map(t => t.netProfit)
  const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length

  const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length
  const stdDev = Math.sqrt(variance)

  if (stdDev === 0) return 0

  return avgReturn / stdDev
}

/**
 * Calculate maximum drawdown (largest peak-to-trough decline)
 * Formula: (peak - trough) / peak
 * <0.20 (20%) is acceptable per spec
 *
 * @param trades - Array of backtest trade results
 * @returns Max drawdown as decimal (0.15 = 15%)
 */
export function calculateMaxDrawdown(trades: BacktestResult[]): number {
  if (trades.length === 0) return 0

  let peak = 0
  let maxDrawdown = 0
  let cumulative = 0

  for (const trade of trades) {
    cumulative += trade.netProfit

    if (cumulative > peak) {
      peak = cumulative
    }

    const drawdown = peak > 0 ? (peak - cumulative) / peak : 0

    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown
    }
  }

  return maxDrawdown
}

/**
 * Calculate Brier score (mean squared error of probabilistic predictions)
 * Formula: (1/N) * Σ(predicted - actual)²
 * <0.15 is good calibration per spec
 *
 * @param trades - Array with model probabilities and outcomes
 * @returns Brier score (lower is better, 0 is perfect)
 */
export function calculateBrierScore(
  trades: Array<{ modelProbability: number; outcome: boolean }>
): number {
  if (trades.length === 0) return 0

  const squaredErrors = trades.map(t => {
    const predicted = t.modelProbability
    const actual = t.outcome ? 1 : 0
    return Math.pow(predicted - actual, 2)
  })

  return squaredErrors.reduce((sum, e) => sum + e, 0) / squaredErrors.length
}

/**
 * Analyze win rate by edge bucket
 * Groups trades by edge magnitude to identify sweet spots
 *
 * @param trades - Array of backtest trade results
 * @returns Array of edge buckets with trade counts and win rates
 */
export function analyzeEdgeDistribution(
  trades: BacktestResult[]
): Array<{ edgeBucket: string; trades: number; winRate: number }> {
  const buckets = [
    { min: 0.15, max: 0.20, label: '15-20%' },
    { min: 0.20, max: 0.25, label: '20-25%' },
    { min: 0.25, max: 0.30, label: '25-30%' },
    { min: 0.30, max: 1.00, label: '30%+' },
  ]

  return buckets.map(bucket => {
    const bucketTrades = trades.filter(t => t.edge >= bucket.min && t.edge < bucket.max)

    return {
      edgeBucket: bucket.label,
      trades: bucketTrades.length,
      winRate: bucketTrades.length > 0
        ? bucketTrades.filter(t => t.outcome).length / bucketTrades.length
        : 0,
    }
  })
}

/**
 * Calculate rolling win rate over time
 * Useful for detecting model decay
 *
 * @param trades - Array of backtest trade results
 * @param windowSize - Number of trades in rolling window
 * @returns Array of rolling win rates
 */
export function calculateRollingWinRate(
  trades: BacktestResult[],
  windowSize: number = 20
): Array<{ index: number; winRate: number }> {
  if (trades.length < windowSize) {
    return []
  }

  const results: Array<{ index: number; winRate: number }> = []

  for (let i = windowSize - 1; i < trades.length; i++) {
    const window = trades.slice(i - windowSize + 1, i + 1)
    const wins = window.filter(t => t.outcome).length
    const winRate = wins / windowSize

    results.push({ index: i + 1, winRate })
  }

  return results
}

/**
 * Calculate cumulative P&L over time
 * For ROI curve visualization
 *
 * @param trades - Array of backtest trade results
 * @returns Array of cumulative profits
 */
export function calculateCumulativePnL(
  trades: BacktestResult[]
): Array<{ index: number; cumulativePnL: number }> {
  let cumulative = 0

  return trades.map((trade, i) => {
    cumulative += trade.netProfit
    return { index: i + 1, cumulativePnL: cumulative }
  })
}

/**
 * Calculate Kelly criterion position size
 * For optimal bet sizing validation
 *
 * @param modelProb - Model's probability (0-1)
 * @param marketPrice - Market price (0-1)
 * @param bankroll - Total bankroll
 * @param fraction - Kelly fraction (default: 0.25)
 * @returns Recommended position size
 */
export function calculateKellySize(
  modelProb: number,
  marketPrice: number,
  bankroll: number,
  fraction: number = 0.25
): number {
  const bettingYes = modelProb > marketPrice

  let kellyFraction: number

  if (bettingYes) {
    const edge = modelProb - marketPrice
    const odds = (1 - marketPrice) / marketPrice
    kellyFraction = edge / odds
  } else {
    const edge = marketPrice - modelProb
    const odds = marketPrice / (1 - marketPrice)
    kellyFraction = edge / odds
  }

  // Apply fractional Kelly
  const fractionalKelly = kellyFraction * fraction

  // Cap at 10% of bankroll per trade
  const positionSize = Math.min(
    fractionalKelly * bankroll,
    bankroll * 0.10
  )

  // Minimum position per spec: $0.50
  return Math.max(positionSize, 0.50)
}
