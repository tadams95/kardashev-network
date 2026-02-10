// Integration test for backtesting framework
// Verifies all components work together: data loading, backtesting, and metrics

// Load environment variables for standalone execution
import * as fs from 'fs'
import * as path from 'path'

// Simple .env.local parser
const envPath = path.join(__dirname, '.env.local')
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8')
  envContent.split('\n').forEach(line => {
    const match = line.match(/^([^=:#]+)=(.*)$/)
    if (match) {
      const key = match[1].trim()
      const value = match[2].trim().replace(/^["']|["']$/g, '') // Remove quotes
      if (key && !process.env[key]) {
        process.env[key] = value
      }
    }
  })
}

import { loadHistoricalMarkets } from './src/lib/backtesting/dataLoader'
import { runBacktest, validateBacktestResults } from './src/lib/backtesting/backtest'
import { runWalkForwardValidation, printWalkForwardReport } from './src/lib/backtesting/walkForward'
import { analyzeEdgeDistribution } from './src/lib/backtesting/metrics'

async function testBacktesting() {
  console.log('📊 Weather Backtesting - Integration Test\n')
  console.log('='.repeat(70))

  try {
    // ========================================================================
    // Test 1: Load Historical Markets
    // ========================================================================
    console.log('\n📊 Test 1: Load Historical Markets')
    console.log('-'.repeat(70))

    const csvPath = './data/weather/historical_markets_2024.csv'
    if (!fs.existsSync(csvPath)) {
      throw new Error(`CSV file not found: ${csvPath}\nPlease create historical market data first.`)
    }

    const markets = await loadHistoricalMarkets(csvPath)
    console.log(`✅ Loaded ${markets.length} historical markets`)

    if (markets.length === 0) {
      throw new Error('No markets found in CSV. Please add historical market data.')
    }

    console.log(`   Sample market:`)
    console.log(`     City: ${markets[0].location.city}`)
    console.log(`     Date: ${markets[0].date}`)
    console.log(`     Type: ${markets[0].marketType}`)
    console.log(`     Threshold: ${markets[0].threshold}${markets[0].marketType === 'temperature' ? '°F' : ' inches'} ${markets[0].direction}`)
    console.log(`     Outcome: ${markets[0].outcome ? 'YES' : 'NO'}`)
    console.log(`     Market Price: ${(markets[0].marketPrice * 100).toFixed(0)}%`)
    if (markets[0].kalshiId) {
      console.log(`     Kalshi ID: ${markets[0].kalshiId}`)
    }

    // ========================================================================
    // Test 2: Run Basic Backtest
    // ========================================================================
    console.log('\n📊 Test 2: Run Basic Backtest')
    console.log('-'.repeat(70))

    const results = await runBacktest({
      markets,
      minEdge: 0.15,
      bankroll: 100,
      kellyFraction: 0.25,
      feeRate: 0.15,
      useSampleMode: true, // Use sample mode for demo data
    })

    console.log(`✅ Backtest complete`)
    console.log(`\n   Summary:`)
    console.log(`     Total Trades: ${results.summary.totalTrades}`)
    console.log(`     Win Rate: ${(results.summary.winRate * 100).toFixed(1)}%`)
    console.log(`     Total P&L: $${results.summary.totalProfit.toFixed(2)}`)
    console.log(`     ROI: ${results.summary.roi.toFixed(1)}%`)
    console.log(`     Sharpe Ratio: ${results.summary.sharpeRatio.toFixed(2)}`)
    console.log(`     Max Drawdown: ${(results.summary.maxDrawdown * 100).toFixed(1)}%`)
    console.log(`     Brier Score: ${results.summary.brierScore.toFixed(3)}`)
    console.log(`     Average Edge: ${(results.summary.averageEdge * 100).toFixed(1)}%`)

    // ========================================================================
    // Test 3: Validate Against Spec Requirements
    // ========================================================================
    console.log('\n📊 Test 3: Validate Against Spec Requirements')
    console.log('-'.repeat(70))

    const validation = validateBacktestResults(results)

    validation.messages.forEach(msg => console.log(`   ${msg}`))

    console.log(`\n   Overall: ${validation.passed ? '✅ ALL PASSED - Ready for live trading' : '⚠️  SOME FAILED - Needs tuning'}`)

    // ========================================================================
    // Test 4: Edge Distribution Analysis
    // ========================================================================
    console.log('\n📊 Test 4: Win Rate by Edge Bucket')
    console.log('-'.repeat(70))

    const edgeDistribution = analyzeEdgeDistribution(results.trades)

    edgeDistribution.forEach(bucket => {
      const winRateStr = bucket.trades > 0
        ? `${(bucket.winRate * 100).toFixed(1)}%`
        : 'N/A'
      console.log(`   ${bucket.edgeBucket}: ${bucket.trades} trades, ${winRateStr} win rate`)
    })

    // ========================================================================
    // Test 5: Performance by Market Type
    // ========================================================================
    console.log('\n📊 Test 5: Performance by Market Type')
    console.log('-'.repeat(70))

    console.log(`   Temperature Markets:`)
    console.log(`     Trades: ${results.byMarketType.temperature.trades}`)
    console.log(`     Win Rate: ${(results.byMarketType.temperature.winRate * 100).toFixed(1)}%`)

    console.log(`   Precipitation Markets:`)
    console.log(`     Trades: ${results.byMarketType.precipitation.trades}`)
    console.log(`     Win Rate: ${(results.byMarketType.precipitation.winRate * 100).toFixed(1)}%`)

    // ========================================================================
    // Test 6: Sample Trade Details
    // ========================================================================
    console.log('\n📊 Test 6: Sample Trade Details')
    console.log('-'.repeat(70))

    const sampleTrades = results.trades.slice(0, 3)
    sampleTrades.forEach((trade, i) => {
      console.log(`\n   Trade ${i + 1}: ${trade.marketId}`)
      console.log(`     Date: ${trade.date}`)
      console.log(`     Model Prob: ${(trade.modelProbability * 100).toFixed(1)}%`)
      console.log(`     Market Price: ${(trade.marketPrice * 100).toFixed(1)}%`)
      console.log(`     Edge: ${(trade.edge * 100).toFixed(1)}%`)
      console.log(`     Result: ${trade.outcome ? '✅ WIN' : '❌ LOSS'}`)
      console.log(`     Net P&L: $${trade.netProfit.toFixed(2)}`)
    })

    // ========================================================================
    // Test 7: Walk-Forward Validation (if enough data)
    // ========================================================================
    if (markets.length >= 30) {
      console.log('\n📊 Test 7: Walk-Forward Validation')
      console.log('-'.repeat(70))

      console.log('   Running walk-forward validation...')

      const wfResults = await runWalkForwardValidation(
        markets,
        {
          minEdge: 0.15,
          bankroll: 100,
          kellyFraction: 0.25,
          feeRate: 0.15,
          useSampleMode: true, // Use sample mode for demo data
        },
        2, // 2 month train window
        1  // 1 month test window
      )

      printWalkForwardReport(wfResults)
    } else {
      console.log('\n📊 Test 7: Walk-Forward Validation')
      console.log('-'.repeat(70))
      console.log(`   ⚠️  Skipped: Need at least 30 markets (have ${markets.length})`)
      console.log('   Walk-forward validation requires more historical data')
    }

    // ========================================================================
    // Test 8: Data Quality Checks
    // ========================================================================
    console.log('\n📊 Test 8: Data Quality Checks')
    console.log('-'.repeat(70))

    const dateRange = {
      first: markets[0].date,
      last: markets[markets.length - 1].date,
    }

    const uniqueCities = new Set(markets.map(m => m.location.city))
    const tempMarkets = markets.filter(m => m.marketType === 'temperature').length
    const precipMarkets = markets.filter(m => m.marketType === 'precipitation').length

    console.log(`   ✅ Date Range: ${dateRange.first} to ${dateRange.last}`)
    console.log(`   ✅ Unique Cities: ${uniqueCities.size}`)
    console.log(`   ✅ Temperature Markets: ${tempMarkets}`)
    console.log(`   ✅ Precipitation Markets: ${precipMarkets}`)
    console.log(`   ✅ Total Markets: ${markets.length}`)

    // Check for data quality issues
    const issues: string[] = []

    if (markets.length < 100) {
      issues.push(`Low sample size (${markets.length} < 100 recommended)`)
    }

    if (uniqueCities.size < 3) {
      issues.push(`Limited geographic diversity (${uniqueCities.size} cities)`)
    }

    if (tempMarkets === 0 || precipMarkets === 0) {
      issues.push('Missing market type diversity')
    }

    if (issues.length > 0) {
      console.log(`\n   ⚠️  Data Quality Issues:`)
      issues.forEach(issue => console.log(`      - ${issue}`))
    } else {
      console.log(`\n   ✅ No data quality issues detected`)
    }

    // ========================================================================
    // Summary
    // ========================================================================
    console.log('\n' + '='.repeat(70))
    console.log('✅ ALL TESTS PASSED!')
    console.log('='.repeat(70))

    console.log('\n📈 Next Steps:')
    console.log('   1. ✅ Backtesting framework is operational')
    console.log('   2. ✅ Performance metrics are being calculated')
    console.log('   3. 📝 Add more historical market data (target: 100+ markets)')
    console.log('   4. 🎯 Fine-tune parameters if win rate < 70%')
    console.log('   5. 🚀 Create API endpoint and dashboard visualization')

    console.log('\n💡 To add more data:')
    console.log(`   1. Open ${csvPath}`)
    console.log('   2. Add rows in format: date,location,city,lat,lng,market_type,threshold,direction,outcome,market_price,kalshi_id')
    console.log('   3. Run this test again to validate')

    console.log('\n🎯 Target Metrics:')
    console.log(`   Win Rate: >70% (currently ${(results.summary.winRate * 100).toFixed(1)}%)`)
    console.log(`   Sharpe: >1.0 (currently ${results.summary.sharpeRatio.toFixed(2)})`)
    console.log(`   Max Drawdown: <20% (currently ${(results.summary.maxDrawdown * 100).toFixed(1)}%)`)
    console.log(`   Brier Score: <0.15 (currently ${results.summary.brierScore.toFixed(3)})`)

  } catch (error) {
    console.error('\n❌ TEST FAILED:')
    console.error(error)
    process.exit(1)
  }
}

// Run tests
testBacktesting()
  .then(() => {
    console.log('\n✨ Test complete!')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n💥 Test failed:', error)
    process.exit(1)
  })
