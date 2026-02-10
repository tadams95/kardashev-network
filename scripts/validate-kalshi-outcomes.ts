// Validate our weather model against real Kalshi outcomes
// NO P&L, NO KELLY SIZING - just prediction accuracy
// Usage: npx tsx scripts/validate-kalshi-outcomes.ts

import { runBacktest } from '../src/lib/backtesting/backtest'
import { loadHistoricalMarkets } from '../src/lib/backtesting/dataLoader'

async function validateKalshiOutcomes() {
  console.log('🎯 Kalshi Outcome Validation')
  console.log('   Purpose: Validate model predictions against 976 real Kalshi markets')
  console.log('   Approach: NO P&L, just accuracy metrics')
  console.log('='.repeat(70))

  // Load real Kalshi data
  console.log('\n📊 Loading Kalshi historical markets...')
  const markets = await loadHistoricalMarkets('./data/weather/kalshi_real_2024.csv')
  console.log(`   ✅ Loaded ${markets.length} real Kalshi markets`)

  // Sample info
  console.log('\n📈 Sample markets:')
  markets.slice(0, 3).forEach((m, i) => {
    console.log(`   ${i + 1}. ${m.location.city} on ${m.date}`)
    console.log(`      Market: ${m.marketType} ${m.direction} ${m.threshold}`)
    console.log(`      Outcome: ${m.outcome ? 'YES' : 'NO'}, Price: ${(m.marketPrice * 100).toFixed(0)}%`)
  })

  // Run validation (NO P&L)
  console.log('\n🔄 Running validation (fetching historical weather for each market)...')
  console.log('   This will take ~2-3 minutes (976 API calls with rate limiting)\n')

  const results = await runBacktest({
    markets,
    minEdge: 0.0,  // NO EDGE FILTERING - validate ALL markets
    bankroll: 100,  // Unused (validation only)
    kellyFraction: 0.25,  // Unused (validation only)
    feeRate: 0.0,  // No fees in validation mode
    addNoise: true,  // Simulate realistic forecast uncertainty
    useSampleMode: false,  // Use real weather API
    validationOnly: true,  // KEY: Skip P&L, just accuracy
  })

  console.log('✅ Validation complete!\n')

  // ============================================================================
  // Validation Metrics (NO P&L)
  // ============================================================================

  console.log('📊 Validation Results')
  console.log('='.repeat(70))

  console.log('\n🎯 Prediction Accuracy:')
  console.log(`   Total Markets: ${results.summary.totalTrades}`)
  console.log(`   Accuracy: ${(results.summary.winRate * 100).toFixed(1)}% (correct predictions)`)
  console.log(`   Target: >70% accuracy`)
  console.log(`   Status: ${results.summary.winRate > 0.70 ? '✅ PASS' : '❌ FAIL'}`)

  console.log('\n📈 Calibration Quality:')
  console.log(`   Brier Score: ${results.summary.brierScore.toFixed(3)} (lower is better)`)
  console.log(`   Target: <0.15 (well-calibrated)`)
  console.log(`   Status: ${results.summary.brierScore < 0.15 ? '✅ PASS' : '❌ FAIL'}`)

  console.log('\n🌡️  By Market Type:')
  console.log(`   Temperature: ${results.byMarketType.temperature.trades} markets`)
  console.log(`                ${(results.byMarketType.temperature.winRate * 100).toFixed(1)}% accuracy`)
  console.log(`   Precipitation: ${results.byMarketType.precipitation.trades} markets`)
  console.log(`                  ${(results.byMarketType.precipitation.winRate * 100).toFixed(1)}% accuracy`)

  console.log('\n📊 Confidence Analysis:')
  console.log(`   Average Edge: ${(results.summary.averageEdge * 100).toFixed(1)}%`)
  console.log(`   (How different our model is from market prices)`)

  // Calibration buckets
  const buckets = [
    { min: 0.0, max: 0.2, label: '0-20%' },
    { min: 0.2, max: 0.4, label: '20-40%' },
    { min: 0.4, max: 0.6, label: '40-60%' },
    { min: 0.6, max: 0.8, label: '60-80%' },
    { min: 0.8, max: 1.0, label: '80-100%' },
  ]

  console.log('\n📉 Calibration by Predicted Probability:')
  buckets.forEach(bucket => {
    const trades = results.trades.filter(
      t => t.modelProbability >= bucket.min && t.modelProbability < bucket.max
    )
    if (trades.length === 0) return

    const accuracy = trades.filter(t => t.outcome).length / trades.length
    console.log(`   ${bucket.label} prob: ${trades.length} markets, ${(accuracy * 100).toFixed(1)}% correct`)
  })

  console.log('\n' + '='.repeat(70))
  console.log('✨ Validation Complete!')
  console.log('\n💡 Interpretation:')
  console.log('   - Accuracy: How often we predict the correct outcome')
  console.log('   - Brier Score: How well-calibrated our probabilities are')
  console.log('   - Calibration: If we say 70%, it should happen ~70% of the time')
  console.log('\n📈 Next Step: If validation passes (>70% accuracy, <0.15 Brier),')
  console.log('              our weather consensus model is ready for live trading!')
}

validateKalshiOutcomes()
  .then(() => {
    console.log('\n✅ Script complete!')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n❌ Validation failed:', error)
    console.error('\nError details:', error)
    process.exit(1)
  })
