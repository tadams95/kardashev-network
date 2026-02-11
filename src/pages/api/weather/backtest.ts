// API endpoint for backtesting results
// Returns cached backtest results with performance metrics

import type { NextApiRequest, NextApiResponse } from 'next'
import * as fs from 'fs'
import * as path from 'path'
import { runBacktest } from '@/lib/backtesting/backtest'
import { loadHistoricalMarkets } from '@/lib/backtesting/dataLoader'
import type { BacktestResults } from '@/lib/backtesting/backtest'

// ============================================================================
// Response Type
// ============================================================================

interface BacktestApiResponse {
  success: boolean
  data?: BacktestResults
  error?: string
  cached?: boolean
  timestamp?: number
  filteredCount?: number
}

// ============================================================================
// Cache Configuration
// ============================================================================

// Cache results in memory (expensive computation)
let cachedResults: BacktestResults | null = null
let cacheTimestamp = 0
const CACHE_TTL = 10 * 60 * 1000 // 10 minutes

// ============================================================================
// API Handler
// ============================================================================

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<BacktestApiResponse>
) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed. Use GET.',
    })
  }

  try {
    // Check if we have fresh cached results
    const now = Date.now()
    const cacheAge = now - cacheTimestamp

    if (cachedResults && cacheAge < CACHE_TTL) {
      console.log(`[backtest] Cache hit (age: ${Math.round(cacheAge / 1000)}s)`)
      return res.status(200).json({
        success: true,
        data: cachedResults,
        cached: true,
        timestamp: cacheTimestamp,
      })
    }

    console.log('[backtest] Cache miss, running backtest...')

    // Load historical markets from CSV
    const csvPath = './data/weather/kalshi_real_2024.csv'
    const markets = await loadHistoricalMarkets(csvPath)

    if (markets.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No historical market data found. Please add data to data/weather/historical_markets_2024.csv',
      })
    }

    // Filter out post-settlement markets with extreme prices (0.01 or 0.99)
    const tradeableMarkets = markets.filter(m =>
      m.marketPrice >= 0.05 && m.marketPrice <= 0.95
    )
    const filteredCount = markets.length - tradeableMarkets.length

    console.log(`[backtest] Loaded ${markets.length} markets, filtered ${filteredCount} post-settlement, running backtest on ${tradeableMarkets.length}...`)

    // Run backtest in validation-only mode (no P&L, just accuracy)
    // Using real weather data from CSV (grounded in actual 2024 weather)
    const results = await runBacktest({
      markets: tradeableMarkets,
      minEdge: 0.0, // NO EDGE FILTERING - validate ALL markets
      bankroll: 100, // Unused in validation mode
      kellyFraction: 0.25, // Unused in validation mode
      feeRate: 0.0, // No fees in validation mode
      useSampleMode: false, // Use real weather validation (CSV has actual weather)
      addNoise: true, // Simulate realistic forecast uncertainty
      validationOnly: true, // KEY: Skip P&L, just accuracy
    })

    console.log(`[backtest] Complete: ${results.summary.totalTrades} trades, ${(results.summary.winRate * 100).toFixed(1)}% win rate`)

    // Persist calibration model for use by the live system
    if (results.calibration?.model) {
      try {
        const calibrationPath = path.join(process.cwd(), 'data/weather/calibration_model.json')
        fs.writeFileSync(calibrationPath, JSON.stringify(results.calibration.model, null, 2))
        console.log('[backtest] Calibration model persisted to data/weather/calibration_model.json')
      } catch (err) {
        console.warn('[backtest] Failed to persist calibration model:', err)
      }
    }

    // Update cache
    cachedResults = results
    cacheTimestamp = now

    return res.status(200).json({
      success: true,
      data: results,
      cached: false,
      timestamp: now,
      filteredCount,
    })
  } catch (error) {
    console.error('[backtest] Error:', error)

    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Backtesting failed',
    })
  }
}
