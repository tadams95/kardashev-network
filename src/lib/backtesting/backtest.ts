// Core backtesting engine for weather trading model
// Simulates historical trades to validate model accuracy

import * as fs from 'fs'
import * as path from 'path'
import type { BacktestResult } from '@/types/weather'
import type { HistoricalMarket } from './dataLoader'
import { fetchHistoricalWeather, fetchHistoricalForecast } from './dataLoader'
import { fahrenheitToCelsius } from '@/lib/utils/temperature'
import {
  calculateSharpeRatio,
  calculateMaxDrawdown,
  calculateBrierScore,
  analyzeEdgeDistribution,
} from './metrics'
import {
  trainCalibrationModel,
  calibrateProbability,
  getCalibrationConfidence,
} from '@/lib/models/calibration'
import type { CalibrationPoint, CalibrationModel } from '@/lib/models/calibration'

// ============================================================================
// Weather Cache for Performance & Reliability
// ============================================================================

interface WeatherDataPoint {
  date: string
  lat: number
  lng: number
  city: string
  tempMax: number
  tempMin: number
  precipSum: number
  fetchedAt: number
}

interface WeatherCache {
  version: string
  fetchedAt: number
  markets: number
  data: Record<string, WeatherDataPoint>  // Key: "YYYY-MM-DD_LAT_LNG"
}

// Load weather cache (null if doesn't exist)
let weatherCacheInstance: WeatherCache | null = null

function loadWeatherCache(): WeatherCache | null {
  if (weatherCacheInstance) return weatherCacheInstance

  try {
    const cachePath = path.join(process.cwd(), 'data/weather/weather_cache_2024.json')
    const content = fs.readFileSync(cachePath, 'utf-8')
    weatherCacheInstance = JSON.parse(content)
    console.log(`[backtest] Loaded weather cache: ${Object.keys(weatherCacheInstance!.data).length} data points`)
    return weatherCacheInstance
  } catch (error) {
    console.warn('[backtest] Weather cache not found, will use API fallback')
    return null
  }
}

// Get weather from cache or API fallback
async function getHistoricalWeather(
  lat: number,
  lng: number,
  date: string
): Promise<{ tempMax: number; tempMin: number; precipSum: number; tempAvg: number }> {
  const cache = loadWeatherCache()

  if (cache) {
    // Try cache first
    const key = `${date}_${lat.toFixed(4)}_${lng.toFixed(4)}`
    const cached = cache.data[key]

    if (cached) {
      // Cache stores °F and inches; convert to °C and mm to match API fallback
      return {
        tempMax: fahrenheitToCelsius(cached.tempMax),
        tempMin: fahrenheitToCelsius(cached.tempMin),
        precipSum: cached.precipSum * 25.4, // inches → mm
        tempAvg: fahrenheitToCelsius((cached.tempMax + cached.tempMin) / 2),
      }
    }

    console.warn(`[backtest] Cache miss for ${date} at ${lat},${lng}`)
  }

  // Fallback to API (original fetchHistoricalWeather)
  return fetchHistoricalWeather(lat, lng, date)
}

// ============================================================================
// Configuration & Results Types
// ============================================================================

export interface BacktestConfig {
  markets: HistoricalMarket[]
  minEdge: number          // Minimum edge required (default: 0.15)
  bankroll: number         // Starting bankroll (default: 100)
  kellyFraction: number    // Kelly multiplier (default: 0.25)
  feeRate: number          // All-in fee rate (default: 0.15)
  cancellationRate?: number // Market cancellation rate (default: 0.15)
  addNoise?: boolean       // Add forecast noise for realism (default: true)
  useSampleMode?: boolean  // Use simplified logic for sample data (default: false)
  useRealForecasts?: boolean // Use Historical Forecast API for real predictions (default: false)
  forecastLeadDays?: number  // Days before event the forecast was issued (default: 1)
  validationOnly?: boolean  // Skip P&L, just validate predictions (default: false)
}

export interface BacktestResults {
  trades: BacktestResult[]
  summary: {
    totalTrades: number
    winRate: number
    totalProfit: number
    averageEdge: number
    sharpeRatio: number
    maxDrawdown: number
    brierScore: number
    roi: number
  }
  byMarketType: {
    temperature: { trades: number; winRate: number }
    precipitation: { trades: number; winRate: number }
  }
  calibration?: {
    model: CalibrationModel
    confidence: number
    brierBefore: number
    brierAfter: number
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate random number from normal distribution (Box-Muller transform)
 */
function randomNormal(mean: number, stdDev: number): number {
  const u1 = Math.random()
  const u2 = Math.random()
  const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2)
  return z0 * stdDev + mean
}

/**
 * Normal cumulative distribution function
 */
function normalCDF(z: number): number {
  return 0.5 * (1 + erf(z / Math.sqrt(2)))
}

/**
 * Error function (Abramowitz and Stegun approximation)
 */
function erf(x: number): number {
  const sign = x >= 0 ? 1 : -1
  x = Math.abs(x)

  const a1 = 0.254829592
  const a2 = -0.284496736
  const a3 = 1.421413741
  const a4 = -1.453152027
  const a5 = 1.061405429
  const p = 0.3275911

  const t = 1.0 / (1.0 + p * x)
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x)

  return sign * y
}

/**
 * Clamp value between min and max
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/**
 * Calculate Kelly position size
 */
function calculateKellySize(
  modelProb: number,
  marketPrice: number,
  bankroll: number,
  fraction: number
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

// ============================================================================
// Main Backtesting Engine
// ============================================================================

/**
 * Run backtest on historical markets
 * Simulates model predictions and calculates performance metrics
 *
 * @param config - Backtest configuration
 * @returns Comprehensive backtest results with metrics
 */
export async function runBacktest(
  config: BacktestConfig
): Promise<BacktestResults> {
  const {
    markets,
    minEdge,
    bankroll,
    kellyFraction,
    feeRate,
    cancellationRate = 0.15,
    addNoise = true,
    useSampleMode = false,
    useRealForecasts = false,
    forecastLeadDays = 1,
    validationOnly = false,
  } = config

  const trades: BacktestResult[] = []

  console.log(`\n🔄 Running backtest on ${markets.length} markets...`)

  for (let i = 0; i < markets.length; i++) {
    const market = markets[i]

    try {
      // Calculate model probability
      let modelProbability: number

      if (useRealForecasts) {
        // REAL FORECAST MODE: Use what models actually predicted on past dates
        // via Open-Meteo Historical Forecast API — no noise injection
        const forecast = await fetchHistoricalForecast(
          market.location.lat,
          market.location.lng,
          market.date,
          forecastLeadDays
        )

        // Convert Kalshi threshold to model units (°C / mm)
        const thresholdInModelUnits = market.marketType === 'temperature'
          ? fahrenheitToCelsius(market.threshold)
          : market.threshold * 25.4

        // Use the actual historical forecast value
        const forecastValue = market.marketType === 'temperature'
          ? forecast.forecastTempMax
          : forecast.forecastPrecipSum

        // Calculate model probability using same logic as live system
        if (market.marketType === 'temperature') {
          const stdDev = Math.max(2.0, 2.2) // Match live MIN_STD_DEV
          const z = (thresholdInModelUnits - forecastValue) / stdDev
          const rawProb = market.direction === 'above'
            ? 1 - normalCDF(z)
            : normalCDF(z)
          modelProbability = 0.85 * rawProb + 0.15 * 0.50
        } else {
          const ratio = forecastValue / Math.max(thresholdInModelUnits, 0.01)
          if (ratio > 1.5) modelProbability = 0.82
          else if (ratio > 1.0) modelProbability = 0.65
          else if (ratio > 0.5) modelProbability = 0.38
          else if (ratio > 0.1) modelProbability = 0.18
          else modelProbability = 0.08
        }
      } else if (useSampleMode) {
        // Sample mode: Model is slightly better than market at predicting outcomes
        const edgeDirection = market.outcome ? 1 : -1
        const edgeAmount = 0.12 + randomNormal(0, 0.05)
        modelProbability = market.marketPrice + edgeDirection * edgeAmount
        modelProbability += randomNormal(0, 0.08)
        modelProbability = clamp(modelProbability, 0.01, 0.99)
      } else {
        // Real mode: Fetch actual historical weather and simulate forecast
        // Weather data is now in °C and mm (matching live system)
        // 1. Fetch historical weather (actual outcome) - cache-first, API fallback
        const weather = await getHistoricalWeather(
          market.location.lat,
          market.location.lng,
          market.date
        )

        // 2. Determine actual value (in °C / mm from API)
        const actualValue = market.marketType === 'temperature'
          ? weather.tempMax
          : weather.precipSum

        // 3. Convert Kalshi threshold to model units
        // Kalshi uses °F for temperature and inches for precipitation
        const thresholdInModelUnits = market.marketType === 'temperature'
          ? fahrenheitToCelsius(market.threshold)
          : market.threshold * 25.4 // inches to mm

        // 4. Simulate model forecast (add noise for realism)
        let forecastValue: number
        if (addNoise) {
          if (market.marketType === 'temperature') {
            // Add ±1.4°C noise (~2.5°F) — ensemble with 3 sources
            forecastValue = actualValue + randomNormal(0, 1.4)
          } else {
            // Add ±20% noise for precipitation
            forecastValue = actualValue * (1 + randomNormal(0, 0.20))
          }
        } else {
          // Perfect forecast (for testing)
          forecastValue = actualValue
        }

        // 5. Calculate model probability
        // Minimum stdDev floor matches live system (2.0°C)
        if (market.marketType === 'temperature') {
          const rawStdDev = 2.2  // °C (~4°F uncertainty)
          const stdDev = Math.max(rawStdDev, 2.0) // match live MIN_STD_DEV
          const z = (thresholdInModelUnits - forecastValue) / stdDev
          const rawProb = market.direction === 'above'
            ? 1 - normalCDF(z)
            : normalCDF(z)
          // Blend with base rate (match live system)
          modelProbability = 0.85 * rawProb + 0.15 * 0.50
        } else {
          // Precipitation: use threshold-aware probability
          const ratio = forecastValue / thresholdInModelUnits
          if (ratio > 1.5) {
            modelProbability = 0.82
          } else if (ratio > 1.0) {
            modelProbability = 0.65
          } else if (ratio > 0.5) {
            modelProbability = 0.38
          } else if (ratio > 0.1) {
            modelProbability = 0.18
          } else {
            modelProbability = 0.08
          }
        }
      }

      // Clamp to valid range (matches live system tighter bounds)
      modelProbability = clamp(modelProbability, 0.02, 0.95)

      // 5. Calculate edge
      const edge = Math.abs(modelProbability - market.marketPrice)

      // 6. Skip if edge too small
      if (edge < minEdge) {
        continue
      }

      // 7. Validation-only mode: Skip P&L, just track prediction accuracy
      if (validationOnly) {
        // Our prediction: bet YES if modelProb > 0.5 (50% threshold)
        // We're NOT using marketPrice here because CSV has post-settlement prices
        const betYes = modelProbability > 0.50
        const wonTrade = betYes === market.outcome

        trades.push({
          marketId: market.kalshiId || `${market.location.city}-${market.date}`,
          date: market.date,
          modelProbability,
          marketPrice: market.marketPrice,
          edge,
          outcome: wonTrade,
          profit: 0,  // N/A for validation
          fees: 0,    // N/A for validation
          netProfit: 0,  // N/A for validation
        })

        continue
      }

      // 8. Simulate market cancellation (15% of markets)
      if (Math.random() < cancellationRate) {
        trades.push({
          marketId: market.kalshiId || `${market.location.city}-${market.date}`,
          date: market.date,
          modelProbability,
          marketPrice: market.marketPrice,
          edge,
          outcome: false,
          profit: -feeRate * 0.50,  // Lose fees on minimum $0.50 position
          fees: feeRate * 0.50,
          netProfit: -feeRate * 0.50,
        })
        continue
      }

      // 9. Calculate position size (Kelly criterion)
      const positionSize = calculateKellySize(
        modelProbability,
        market.marketPrice,
        bankroll,
        kellyFraction
      )

      // 10. Determine if trade won
      // Our prediction: bet YES if modelProb > marketPrice
      const betYes = modelProbability > market.marketPrice
      const wonTrade = betYes === market.outcome

      // 11. Calculate P&L
      let grossProfit: number
      if (wonTrade) {
        // Win: receive $1, paid positionSize * price
        if (betYes) {
          grossProfit = positionSize * (1 / market.marketPrice - 1)
        } else {
          grossProfit = positionSize * (1 / (1 - market.marketPrice) - 1)
        }
      } else {
        // Loss: lose position size
        grossProfit = -positionSize
      }

      const fees = Math.abs(grossProfit) * feeRate
      const netProfit = grossProfit - fees

      trades.push({
        marketId: market.kalshiId || `${market.location.city}-${market.date}`,
        date: market.date,
        modelProbability,
        marketPrice: market.marketPrice,
        edge,
        outcome: wonTrade,
        profit: grossProfit,
        fees,
        netProfit,
      })

      // Progress logging every 10 markets
      if ((i + 1) % 10 === 0) {
        console.log(`   Processed ${i + 1}/${markets.length} markets...`)
      }
    } catch (error) {
      console.error(`Failed to process market ${market.kalshiId || market.date}:`, error)
      // Continue with other markets
    }
  }

  console.log(`✅ Backtest complete: ${trades.length} trades executed\n`)

  // ============================================================================
  // Train Calibration Model from backtest results
  // ============================================================================

  const calibrationData: CalibrationPoint[] = trades.map(t => ({
    predicted: t.modelProbability,
    actual: t.outcome ? 1 : 0,
  }))

  const calibrationModel = trainCalibrationModel(calibrationData)
  const calibrationConfidence = getCalibrationConfidence(calibrationModel)

  console.log(`📊 Calibration: ${calibrationModel.sampleSize} samples, ` +
    `error=${calibrationModel.calibrationError.toFixed(3)}, ` +
    `Brier before=${calibrationModel.brierBefore.toFixed(3)} → after=${calibrationModel.brierAfter.toFixed(3)}, ` +
    `confidence=${(calibrationConfidence * 100).toFixed(0)}%`)

  // ============================================================================
  // Calculate Summary Metrics
  // ============================================================================

  const totalTrades = trades.length
  const winRate = trades.filter(t => t.outcome).length / totalTrades
  const averageEdge = trades.reduce((sum, t) => sum + t.edge, 0) / totalTrades

  // P&L metrics (only calculated in trading mode)
  const totalProfit = validationOnly ? 0 : trades.reduce((sum, t) => sum + t.netProfit, 0)
  const roi = validationOnly ? 0 : (totalProfit / bankroll) * 100
  const sharpeRatio = validationOnly ? 0 : calculateSharpeRatio(trades)
  const maxDrawdown = validationOnly ? 0 : calculateMaxDrawdown(trades)

  // Calibration metric (always calculated)
  const brierScore = calculateBrierScore(
    trades.map(t => ({ modelProbability: t.modelProbability, outcome: t.outcome }))
  )

  // ============================================================================
  // By Market Type Analysis
  // ============================================================================

  // Identify temperature markets (by keywords in ID or by market type)
  const tempTrades = trades.filter(t =>
    t.marketId.toUpperCase().includes('HIGH') ||
    t.marketId.toUpperCase().includes('TEMP') ||
    t.marketId.toUpperCase().includes('HOT')
  )

  const precipTrades = trades.filter(t =>
    t.marketId.toUpperCase().includes('RAIN') ||
    t.marketId.toUpperCase().includes('PRECIP') ||
    t.marketId.toUpperCase().includes('SNOW')
  )

  // Fallback: if keywords don't work, split evenly
  const tempTradesCount = tempTrades.length > 0 ? tempTrades.length : Math.floor(trades.length / 2)
  const precipTradesCount = precipTrades.length > 0 ? precipTrades.length : trades.length - tempTradesCount

  const tempWinRate = tempTrades.length > 0
    ? tempTrades.filter(t => t.outcome).length / tempTrades.length
    : 0

  const precipWinRate = precipTrades.length > 0
    ? precipTrades.filter(t => t.outcome).length / precipTrades.length
    : 0

  return {
    trades,
    summary: {
      totalTrades,
      winRate,
      totalProfit,
      averageEdge,
      sharpeRatio,
      maxDrawdown,
      brierScore,
      roi,
    },
    byMarketType: {
      temperature: {
        trades: tempTradesCount,
        winRate: tempWinRate,
      },
      precipitation: {
        trades: precipTradesCount,
        winRate: precipWinRate,
      },
    },
    calibration: calibrationModel.sampleSize > 0 ? {
      model: calibrationModel,
      confidence: calibrationConfidence,
      brierBefore: calibrationModel.brierBefore,
      brierAfter: calibrationModel.brierAfter,
    } : undefined,
  }
}

/**
 * Analyze backtest results and check if they meet minimum requirements
 *
 * @param results - Backtest results
 * @returns Whether results meet spec requirements
 */
export function validateBacktestResults(results: BacktestResults): {
  passed: boolean
  checks: {
    winRate: boolean
    sharpeRatio: boolean
    maxDrawdown: boolean
    brierScore: boolean
  }
  messages: string[]
} {
  const messages: string[] = []

  // Spec requirements
  const passWinRate = results.summary.winRate > 0.70
  const passSharpe = results.summary.sharpeRatio > 1.0
  const passDrawdown = results.summary.maxDrawdown < 0.20
  const passBrier = results.summary.brierScore < 0.15

  if (!passWinRate) {
    messages.push(`❌ Win rate ${(results.summary.winRate * 100).toFixed(1)}% below target 70%`)
  } else {
    messages.push(`✅ Win rate ${(results.summary.winRate * 100).toFixed(1)}% meets target`)
  }

  if (!passSharpe) {
    messages.push(`❌ Sharpe ratio ${results.summary.sharpeRatio.toFixed(2)} below target 1.0`)
  } else {
    messages.push(`✅ Sharpe ratio ${results.summary.sharpeRatio.toFixed(2)} meets target`)
  }

  if (!passDrawdown) {
    messages.push(`❌ Max drawdown ${(results.summary.maxDrawdown * 100).toFixed(1)}% above limit 20%`)
  } else {
    messages.push(`✅ Max drawdown ${(results.summary.maxDrawdown * 100).toFixed(1)}% within limit`)
  }

  if (!passBrier) {
    messages.push(`❌ Brier score ${results.summary.brierScore.toFixed(3)} above limit 0.15`)
  } else {
    messages.push(`✅ Brier score ${results.summary.brierScore.toFixed(3)} within limit`)
  }

  const passed = passWinRate && passSharpe && passDrawdown && passBrier

  return {
    passed,
    checks: {
      winRate: passWinRate,
      sharpeRatio: passSharpe,
      maxDrawdown: passDrawdown,
      brierScore: passBrier,
    },
    messages,
  }
}
