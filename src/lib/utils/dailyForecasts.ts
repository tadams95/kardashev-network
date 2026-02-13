// Shared daily forecast aggregation utility
// Provides a single canonical function for computing daily high/low
// used by WeatherHeroCard, ForecastCards, and MarketOpportunitiesTable

import type { WeatherForecast, EnsembleWeights } from '@/types/weather'
import { DEFAULT_WEIGHTS, FORECAST_SOURCES } from '@/lib/models/weatherProbability'

// ============================================================================
// Types
// ============================================================================

export interface DailyForecast {
  date: string                    // timezone-aware date key
  timestamp: string | number      // representative timestamp (first forecast of day)
  high: number                    // consensus daily high (°C)
  low: number                     // consensus daily low (°C)
  currentTemp: number             // current/first temp of day (°C)
  precipProbability: number       // max across sources
  precipAmount: number            // max across sources
  bestWeatherCode: number | null  // from highest-weighted source
  sourceCount: number             // how many sources contributed
}

// ============================================================================
// Helpers
// ============================================================================

function weightedAvg(values: Array<{ value: number; weight: number }>): number {
  const totalWeight = values.reduce((sum, v) => sum + v.weight, 0)
  if (totalWeight === 0) return 0
  return values.reduce((sum, v) => sum + v.value * v.weight, 0) / totalWeight
}

export function formatWeatherDateLabel(resolutionTime: string, timezone: string): string {
  // Markets resolve the morning AFTER the weather day — subtract 24h
  const weatherMs = new Date(resolutionTime).getTime() - 24 * 60 * 60 * 1000

  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
  })

  const weatherKey = fmt.format(new Date(weatherMs))
  const todayKey = fmt.format(new Date())
  if (weatherKey === todayKey) return 'Today'

  const tomorrowKey = fmt.format(new Date(Date.now() + 24 * 60 * 60 * 1000))
  if (weatherKey === tomorrowKey) return 'Tomorrow'

  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short', month: 'short', day: 'numeric',
  }).format(new Date(weatherMs))
}

function getDateKey(timestamp: string | number, timezone?: string): string {
  const date = new Date(timestamp)
  if (timezone) {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date)
  }
  return date.toDateString()
}

function pickBestWeatherCode(
  forecasts: WeatherForecast[],
  weights: EnsembleWeights
): number | null {
  let bestCode: number | null = null
  let bestWeight = -1
  for (const f of forecasts) {
    if (f.weatherCode != null) {
      const w = weights[f.source] ?? 0.15
      if (w > bestWeight) {
        bestCode = f.weatherCode
        bestWeight = w
      }
    }
  }
  return bestCode
}

// ============================================================================
// Core: Group forecasts by day with weighted consensus
// ============================================================================

/**
 * Groups forecasts by calendar day (timezone-aware) and computes
 * weighted-consensus high/low using DEFAULT_WEIGHTS.
 *
 * - Daily aggregates (min ≠ max): weighted average of daily extremes
 * - Hourly points (min === max): high = max of per-hour weighted temps,
 *   low = min of per-hour weighted temps
 * - If both exist for a day: prefer daily aggregates
 */
export function groupForecastsByDay(
  forecasts: WeatherForecast[],
  timezone?: string
): DailyForecast[] {
  if (!forecasts || forecasts.length === 0) return []

  const weights = DEFAULT_WEIGHTS

  // Filter to forecast sources only (exclude ground-truth observations like METAR)
  // for daily high/low calculations
  const forecastsOnly = forecasts.filter(f => FORECAST_SOURCES.has(f.source))

  // Group by date key (use forecast sources only for high/low consensus)
  const dayMap = new Map<string, WeatherForecast[]>()
  for (const f of forecastsOnly) {
    const key = getDateKey(f.timestamp, timezone)
    if (!dayMap.has(key)) {
      dayMap.set(key, [])
    }
    dayMap.get(key)!.push(f)
  }

  const results: DailyForecast[] = []

  for (const [dateKey, dayForecasts] of dayMap) {
    // Separate daily aggregates (min ≠ max) from hourly points (min === max)
    const dailyAggregates = dayForecasts.filter(f => f.temperature.min !== f.temperature.max)
    const hourlyPoints = dayForecasts.filter(f => f.temperature.min === f.temperature.max)

    let high: number
    let low: number

    if (dailyAggregates.length > 0) {
      // Use daily aggregates — weighted average of max temps for high, min temps for low
      const highValues = dailyAggregates
        .map(f => ({ value: f.temperature.max, weight: weights[f.source] ?? 0.15 }))
        .filter(v => typeof v.value === 'number' && !isNaN(v.value))
      const lowValues = dailyAggregates
        .map(f => ({ value: f.temperature.min, weight: weights[f.source] ?? 0.15 }))
        .filter(v => typeof v.value === 'number' && !isNaN(v.value))

      high = highValues.length > 0 ? weightedAvg(highValues) : 0
      low = lowValues.length > 0 ? weightedAvg(lowValues) : 0
    } else if (hourlyPoints.length > 0) {
      // Only hourly data: group by hour, compute weighted avg per hour, then take extremes
      const hourMap = new Map<string, Array<{ value: number; weight: number }>>()
      for (const f of hourlyPoints) {
        const hourKey = new Date(f.timestamp).toISOString().slice(0, 13) // "YYYY-MM-DDTHH"
        if (!hourMap.has(hourKey)) hourMap.set(hourKey, [])
        hourMap.get(hourKey)!.push({
          value: f.temperature.current,
          weight: weights[f.source] ?? 0.15,
        })
      }
      const hourlyAvgs = Array.from(hourMap.values()).map(vals => weightedAvg(vals))
      high = Math.max(...hourlyAvgs)
      low = Math.min(...hourlyAvgs)
    } else {
      high = 0
      low = 0
    }

    // Current temp: first forecast of the day
    const sorted = [...dayForecasts].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    )
    const currentTemp = sorted[0].temperature.current ?? 0

    // Precipitation: max across all sources for the day
    const precipProbability = Math.max(...dayForecasts.map(f => f.precipitation.probability))
    const precipAmount = Math.max(...dayForecasts.map(f => f.precipitation.amount))

    // Best weather code from highest-weighted source
    const bestWeatherCode = pickBestWeatherCode(dayForecasts, weights)

    // Count unique sources
    const sourceCount = new Set(dayForecasts.map(f => f.source)).size

    results.push({
      date: dateKey,
      timestamp: sorted[0].timestamp,
      high,
      low,
      currentTemp,
      precipProbability,
      precipAmount,
      bestWeatherCode,
      sourceCount,
    })
  }

  // Sort by timestamp ascending, limit to 7 days
  return results
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .slice(0, 7)
}

// ============================================================================
// Convenience: get today's forecast
// ============================================================================

/**
 * Returns just today's DailyForecast entry, or null if not available.
 */
export function getTodayForecast(
  forecasts: WeatherForecast[],
  timezone?: string
): DailyForecast | null {
  if (!forecasts || forecasts.length === 0) return null

  const todayKey = getDateKey(Date.now(), timezone)
  const all = groupForecastsByDay(forecasts, timezone)
  return all.find(d => d.date === todayKey) ?? null
}
