// Walk-forward validation for out-of-sample backtesting
// Splits data into train/test periods to prevent overfitting

import type { HistoricalMarket } from './dataLoader'
import type { BacktestConfig, BacktestResults } from './backtest'
import { runBacktest } from './backtest'

// ============================================================================
// Walk-Forward Period Definition
// ============================================================================

export interface WalkForwardPeriod {
  trainStart: string
  trainEnd: string
  testStart: string
  testEnd: string
}

export interface WalkForwardResults {
  periods: Array<{
    period: WalkForwardPeriod
    results: BacktestResults
  }>
  overall: BacktestResults
  summary: {
    avgWinRate: number
    avgSharpe: number
    avgDrawdown: number
    avgBrier: number
    bestPeriod: string
    worstPeriod: string
    consistency: number  // 0-100, how consistent performance is across periods
  }
}

// ============================================================================
// Period Creation
// ============================================================================

/**
 * Create walk-forward periods by splitting data into train/test windows
 *
 * @param markets - Historical markets to split
 * @param trainMonths - Training window size in months (default: 2)
 * @param testMonths - Testing window size in months (default: 1)
 * @returns Array of train/test periods
 */
export function createWalkForwardPeriods(
  markets: HistoricalMarket[],
  trainMonths: number = 2,
  testMonths: number = 1
): WalkForwardPeriod[] {
  // Sort markets by date
  const sorted = [...markets].sort((a, b) => a.date.localeCompare(b.date))
  if (sorted.length === 0) return []

  const periods: WalkForwardPeriod[] = []
  const firstDate = new Date(sorted[0].date)
  const lastDate = new Date(sorted[sorted.length - 1].date)

  let currentDate = new Date(firstDate)

  while (currentDate < lastDate) {
    // Calculate train period
    const trainStart = currentDate.toISOString().split('T')[0]
    const trainEndDate = new Date(currentDate)
    trainEndDate.setMonth(trainEndDate.getMonth() + trainMonths)
    const trainEnd = trainEndDate.toISOString().split('T')[0]

    // Calculate test period
    const testStart = trainEnd
    const testEndDate = new Date(trainEndDate)
    testEndDate.setMonth(testEndDate.getMonth() + testMonths)
    const testEnd = testEndDate.toISOString().split('T')[0]

    // Stop if test period goes beyond available data
    if (new Date(testEnd) > lastDate) {
      break
    }

    periods.push({
      trainStart,
      trainEnd,
      testStart,
      testEnd,
    })

    // Move forward by test period (rolling window)
    currentDate = new Date(testEndDate)
  }

  return periods
}

/**
 * Filter markets by date range
 *
 * @param markets - All markets
 * @param startDate - Start date (inclusive)
 * @param endDate - End date (exclusive)
 * @returns Markets within date range
 */
function filterMarketsByDateRange(
  markets: HistoricalMarket[],
  startDate: string,
  endDate: string
): HistoricalMarket[] {
  return markets.filter(
    m => m.date >= startDate && m.date < endDate
  )
}

// ============================================================================
// Walk-Forward Execution
// ============================================================================

/**
 * Run walk-forward validation
 * Tests model on out-of-sample data using rolling windows
 *
 * @param markets - Historical markets
 * @param config - Backtest configuration (partial, will use defaults)
 * @param trainMonths - Training window size (default: 2)
 * @param testMonths - Testing window size (default: 1)
 * @returns Walk-forward validation results
 */
export async function runWalkForwardValidation(
  markets: HistoricalMarket[],
  config: Partial<BacktestConfig>,
  trainMonths: number = 2,
  testMonths: number = 1
): Promise<WalkForwardResults> {
  const periods = createWalkForwardPeriods(markets, trainMonths, testMonths)

  console.log(`\n📊 Walk-Forward Validation: ${periods.length} periods`)
  console.log(`   Train window: ${trainMonths} months, Test window: ${testMonths} month(s)\n`)

  const results: Array<{
    period: WalkForwardPeriod
    results: BacktestResults
  }> = []

  // Run backtest for each period
  for (let i = 0; i < periods.length; i++) {
    const period = periods[i]

    console.log(`Period ${i + 1}/${periods.length}: Test ${period.testStart} to ${period.testEnd}`)

    // Get test markets (out-of-sample)
    const testMarkets = filterMarketsByDateRange(
      markets,
      period.testStart,
      period.testEnd
    )

    if (testMarkets.length === 0) {
      console.log(`   ⚠️  No markets in test period, skipping\n`)
      continue
    }

    // Run backtest on test period only (simulating real-time trading)
    const periodResults = await runBacktest({
      markets: testMarkets,
      minEdge: config.minEdge || 0.15,
      bankroll: config.bankroll || 100,
      kellyFraction: config.kellyFraction || 0.25,
      feeRate: config.feeRate || 0.15,
      cancellationRate: config.cancellationRate,
      addNoise: config.addNoise,
    })

    results.push({ period, results: periodResults })

    console.log(`   Trades: ${periodResults.summary.totalTrades}`)
    console.log(`   Win Rate: ${(periodResults.summary.winRate * 100).toFixed(1)}%`)
    console.log(`   Sharpe: ${periodResults.summary.sharpeRatio.toFixed(2)}`)
    console.log(`   P&L: $${periodResults.summary.totalProfit.toFixed(2)}\n`)
  }

  // ============================================================================
  // Aggregate Overall Results
  // ============================================================================

  // Combine all trades from all periods
  const allTrades = results.flatMap(r => r.results.trades)

  // Run aggregated analysis
  const overallResults = await runBacktest({
    markets,
    minEdge: config.minEdge || 0.15,
    bankroll: config.bankroll || 100,
    kellyFraction: config.kellyFraction || 0.25,
    feeRate: config.feeRate || 0.15,
    cancellationRate: config.cancellationRate,
    addNoise: config.addNoise,
  })

  // ============================================================================
  // Calculate Summary Statistics
  // ============================================================================

  const periodWinRates = results.map(r => r.results.summary.winRate)
  const periodSharpes = results.map(r => r.results.summary.sharpeRatio)
  const periodDrawdowns = results.map(r => r.results.summary.maxDrawdown)
  const periodBriers = results.map(r => r.results.summary.brierScore)

  const avgWinRate = periodWinRates.reduce((sum, wr) => sum + wr, 0) / periodWinRates.length
  const avgSharpe = periodSharpes.reduce((sum, s) => sum + s, 0) / periodSharpes.length
  const avgDrawdown = periodDrawdowns.reduce((sum, d) => sum + d, 0) / periodDrawdowns.length
  const avgBrier = periodBriers.reduce((sum, b) => sum + b, 0) / periodBriers.length

  // Find best and worst periods
  const bestPeriodIndex = periodWinRates.indexOf(Math.max(...periodWinRates))
  const worstPeriodIndex = periodWinRates.indexOf(Math.min(...periodWinRates))

  const bestPeriod = results[bestPeriodIndex]
    ? `${results[bestPeriodIndex].period.testStart} (${(results[bestPeriodIndex].results.summary.winRate * 100).toFixed(1)}%)`
    : 'N/A'

  const worstPeriod = results[worstPeriodIndex]
    ? `${results[worstPeriodIndex].period.testStart} (${(results[worstPeriodIndex].results.summary.winRate * 100).toFixed(1)}%)`
    : 'N/A'

  // Calculate consistency (inverse of standard deviation)
  const stdDevWinRate = Math.sqrt(
    periodWinRates.map(wr => Math.pow(wr - avgWinRate, 2)).reduce((sum, x) => sum + x, 0) / periodWinRates.length
  )
  const consistency = Math.max(0, 100 - stdDevWinRate * 100)

  return {
    periods: results,
    overall: overallResults,
    summary: {
      avgWinRate,
      avgSharpe,
      avgDrawdown,
      avgBrier,
      bestPeriod,
      worstPeriod,
      consistency,
    },
  }
}

/**
 * Print walk-forward validation report
 *
 * @param results - Walk-forward validation results
 */
export function printWalkForwardReport(results: WalkForwardResults): void {
  console.log('\n' + '='.repeat(70))
  console.log('WALK-FORWARD VALIDATION REPORT')
  console.log('='.repeat(70))

  console.log('\n📊 Overall Performance:')
  console.log(`   Total Trades: ${results.overall.summary.totalTrades}`)
  console.log(`   Win Rate: ${(results.overall.summary.winRate * 100).toFixed(1)}%`)
  console.log(`   Sharpe Ratio: ${results.overall.summary.sharpeRatio.toFixed(2)}`)
  console.log(`   Max Drawdown: ${(results.overall.summary.maxDrawdown * 100).toFixed(1)}%`)
  console.log(`   Brier Score: ${results.overall.summary.brierScore.toFixed(3)}`)
  console.log(`   Total P&L: $${results.overall.summary.totalProfit.toFixed(2)}`)
  console.log(`   ROI: ${results.overall.summary.roi.toFixed(1)}%`)

  console.log('\n📈 Period Averages:')
  console.log(`   Avg Win Rate: ${(results.summary.avgWinRate * 100).toFixed(1)}%`)
  console.log(`   Avg Sharpe: ${results.summary.avgSharpe.toFixed(2)}`)
  console.log(`   Avg Drawdown: ${(results.summary.avgDrawdown * 100).toFixed(1)}%`)
  console.log(`   Avg Brier: ${results.summary.avgBrier.toFixed(3)}`)
  console.log(`   Consistency: ${results.summary.consistency.toFixed(0)}%`)

  console.log('\n🎯 Best/Worst Periods:')
  console.log(`   Best: ${results.summary.bestPeriod}`)
  console.log(`   Worst: ${results.summary.worstPeriod}`)

  console.log('\n📅 Period-by-Period Results:')
  results.periods.forEach((p, i) => {
    console.log(`\n   Period ${i + 1}: ${p.period.testStart} to ${p.period.testEnd}`)
    console.log(`      Trades: ${p.results.summary.totalTrades}`)
    console.log(`      Win Rate: ${(p.results.summary.winRate * 100).toFixed(1)}%`)
    console.log(`      Sharpe: ${p.results.summary.sharpeRatio.toFixed(2)}`)
    console.log(`      P&L: $${p.results.summary.totalProfit.toFixed(2)}`)
  })

  console.log('\n' + '='.repeat(70))

  // Validation against spec requirements
  const passWinRate = results.overall.summary.winRate > 0.70
  const passSharpe = results.overall.summary.sharpeRatio > 1.0
  const passDrawdown = results.overall.summary.maxDrawdown < 0.20
  const passBrier = results.overall.summary.brierScore < 0.15

  console.log('\n✅ Spec Requirements:')
  console.log(`   Win Rate >70%: ${passWinRate ? '✅ PASS' : '❌ FAIL'}`)
  console.log(`   Sharpe >1.0: ${passSharpe ? '✅ PASS' : '❌ FAIL'}`)
  console.log(`   Max Drawdown <20%: ${passDrawdown ? '✅ PASS' : '❌ FAIL'}`)
  console.log(`   Brier Score <0.15: ${passBrier ? '✅ PASS' : '❌ FAIL'}`)

  const allPassed = passWinRate && passSharpe && passDrawdown && passBrier
  console.log(`\n${allPassed ? '🎉 ALL REQUIREMENTS MET!' : '⚠️  SOME REQUIREMENTS NOT MET'}`)
  console.log('='.repeat(70) + '\n')
}

/**
 * Export walk-forward results to CSV
 *
 * @param results - Walk-forward validation results
 * @returns CSV string
 */
export function exportWalkForwardToCSV(results: WalkForwardResults): string {
  const headers = [
    'period',
    'test_start',
    'test_end',
    'trades',
    'win_rate',
    'sharpe_ratio',
    'max_drawdown',
    'brier_score',
    'total_pnl',
    'roi',
  ].join(',')

  const rows = results.periods.map((p, i) => {
    return [
      i + 1,
      p.period.testStart,
      p.period.testEnd,
      p.results.summary.totalTrades,
      p.results.summary.winRate.toFixed(4),
      p.results.summary.sharpeRatio.toFixed(4),
      p.results.summary.maxDrawdown.toFixed(4),
      p.results.summary.brierScore.toFixed(4),
      p.results.summary.totalProfit.toFixed(2),
      p.results.summary.roi.toFixed(2),
    ].join(',')
  })

  return [headers, ...rows].join('\n')
}
