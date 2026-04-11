// Shared daily forecast aggregation utility
// Provides a single canonical function for computing daily high/low
// used by WeatherHeroCard, ForecastCards, and MarketOpportunitiesTable

import type { WeatherForecast, EnsembleWeights } from '@/types/weather'
import { DEFAULT_WEIGHTS, FORECAST_SOURCES } from '@/lib/models/weatherProbability'
import { getWeatherNoonFromResolution, localDateKey } from '@/lib/utils/weatherDate'
import { celsiusToFahrenheit } from '@/lib/utils/temperature'

// ============================================================================
// Types
// ============================================================================

export interface DailyForecast {
  date: string                    // timezone-aware date key
  timestamp: string | number      // representative timestamp (first forecast of day)
  high: number | null             // consensus daily high (°C), null if no data
  low: number | null              // consensus daily low (°C), null if no data
  currentTemp: number             // current/first temp of day (°C)
  precipProbability: number       // max across sources
  precipAmount: number            // max across sources
  bestWeatherCode: number | null  // from highest-weighted source
  sourceCount: number             // how many sources contributed
  // Phase 2a UI surfacing (2026-04-11): Tier 1 atmospheric consensus fields.
  // Weighted averages across sources that publish each field for the day.
  // Null when no source contributed the variable. Additive/optional —
  // existing consumers that only read temperature/precip remain unaffected.
  humidity?: number | null           // 0-100% (day mean)
  cloudCover?: number | null         // 0-100% (day mean)
  apparentTemperature?: number | null // °C (feels-like day mean)
  windSpeed?: number | null          // mph (day mean)
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
  const weatherNoon = getWeatherNoonFromResolution(resolutionTime)

  const shortDateFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    month: 'short', day: 'numeric',
  })

  const weatherKey = localDateKey(weatherNoon.getTime(), timezone)
  const shortDate = shortDateFmt.format(weatherNoon)
  const todayKey = localDateKey(Date.now(), timezone)
  if (weatherKey === todayKey) return `Today ${shortDate}`

  const tomorrowKey = localDateKey(Date.now() + 24 * 60 * 60 * 1000, timezone)
  if (weatherKey === tomorrowKey) return `Tomorrow ${shortDate}`

  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short', month: 'short', day: 'numeric',
  }).format(weatherNoon)
}

export function getDateKey(timestamp: string | number, timezone: string): string {
  const date = new Date(timestamp)
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
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
  timezone: string,
  weightsOverride?: EnsembleWeights
): DailyForecast[] {
  if (!forecasts || forecasts.length === 0) return []

  const weights = weightsOverride ?? DEFAULT_WEIGHTS

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

    let high: number | null
    let low: number | null

    if (dailyAggregates.length > 0) {
      // Use daily aggregates — weighted average of max temps for high, min temps for low
      const highValues = dailyAggregates
        .map(f => ({ value: f.temperature.max, weight: weights[f.source] ?? 0.15 }))
        .filter(v => typeof v.value === 'number' && !isNaN(v.value))
      const lowValues = dailyAggregates
        .map(f => ({ value: f.temperature.min, weight: weights[f.source] ?? 0.15 }))
        .filter(v => typeof v.value === 'number' && !isNaN(v.value))

      high = highValues.length > 0 ? weightedAvg(highValues) : null
      low = lowValues.length > 0 ? weightedAvg(lowValues) : null
    } else if (hourlyPoints.length > 0) {
      // Only hourly data: group by hour, compute weighted avg per hour, then take extremes
      // Use timezone-aware hour key to avoid DST issues (not UTC-based toISOString)
      const hourFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: 'numeric', hour12: false,
      })
      const hourMap = new Map<string, Array<{ value: number; weight: number }>>()
      for (const f of hourlyPoints) {
        const hourKey = hourFormatter.format(new Date(f.timestamp))
        if (!hourMap.has(hourKey)) hourMap.set(hourKey, [])
        hourMap.get(hourKey)!.push({
          value: f.temperature.current,
          weight: weights[f.source] ?? 0.15,
        })
      }
      const hourlyAvgs = Array.from(hourMap.values()).map(vals => weightedAvg(vals))
      high = hourlyAvgs.length > 0 ? Math.max(...hourlyAvgs) : null
      low = hourlyAvgs.length > 0 ? Math.min(...hourlyAvgs) : null
    } else {
      high = null
      low = null
    }

    // Guard: if high < low after aggregation, swap and log (likely source data corruption)
    if (high != null && low != null && high < low) {
      console.warn(
        `[dailyForecasts] high < low for ${dateKey}: high=${high.toFixed(2)}°C, low=${low.toFixed(2)}°C — swapping. Sources: ${dayForecasts.map(f => `${f.source}(min:${f.temperature.min?.toFixed(1)},max:${f.temperature.max?.toFixed(1)})`).join(', ')}`
      )
      const tmp = high
      high = low
      low = tmp
    }

    // Current temp: first forecast of the day
    const sorted = [...dayForecasts].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    )
    const currentTemp = sorted[0].temperature.current ?? 0

    // Precipitation: max across sources for the day (intentionally not weighted avg —
    // daily scope answers "will it rain today?" where any high-probability hour counts)
    const precipProbability = Math.max(...dayForecasts.map(f => f.precipitation.probability))
    const precipAmount = Math.max(...dayForecasts.map(f => f.precipitation.amount))

    // Best weather code from highest-weighted source
    const bestWeatherCode = pickBestWeatherCode(dayForecasts, weights)

    // Count unique sources
    const sourceCount = new Set(dayForecasts.map(f => f.source)).size

    // Tier 1 atmospheric consensus — weighted mean across sources that
    // publish each field. Null when no source contributed the variable.
    const humidityVals = dayForecasts
      .filter(f => typeof f.humidity === 'number')
      .map(f => ({ value: f.humidity as number, weight: weights[f.source] ?? 0.15 }))
    const cloudCoverVals = dayForecasts
      .filter(f => typeof f.cloudCover === 'number')
      .map(f => ({ value: f.cloudCover as number, weight: weights[f.source] ?? 0.15 }))
    const apparentVals = dayForecasts
      .filter(f => typeof f.temperature.apparent === 'number')
      .map(f => ({ value: f.temperature.apparent as number, weight: weights[f.source] ?? 0.15 }))
    const windVals = dayForecasts
      .filter(f => typeof f.windSpeed === 'number')
      .map(f => ({ value: f.windSpeed as number, weight: weights[f.source] ?? 0.15 }))

    const humidity = humidityVals.length > 0 ? weightedAvg(humidityVals) : null
    const cloudCover = cloudCoverVals.length > 0 ? weightedAvg(cloudCoverVals) : null
    const apparentTemperature = apparentVals.length > 0 ? weightedAvg(apparentVals) : null
    const windSpeed = windVals.length > 0 ? weightedAvg(windVals) : null

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
      humidity,
      cloudCover,
      apparentTemperature,
      windSpeed,
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
  timezone: string,
  weightsOverride?: EnsembleWeights
): DailyForecast | null {
  if (!forecasts || forecasts.length === 0) return null

  const todayKey = getDateKey(Date.now(), timezone)
  const all = groupForecastsByDay(forecasts, timezone, weightsOverride)
  return all.find(d => d.date === todayKey) ?? null
}

// ============================================================================
// Per-source temperature extraction (for server-side accuracy tracking)
// ============================================================================

/**
 * Extract per-source daily temperature for a specific date and type.
 * Returns a map of source → temperature in °F.
 * Used by server-side forecast capture for source accuracy tracking.
 */
export function extractPerSourceTemps(
  forecasts: WeatherForecast[],
  timezone: string,
  targetDateKey: string,
  type: 'high' | 'low'
): Record<string, number> {
  const filtered = forecasts.filter(f =>
    FORECAST_SOURCES.has(f.source) &&
    getDateKey(f.timestamp, timezone) === targetDateKey
  )

  // Group by source
  const bySource = new Map<string, WeatherForecast[]>()
  for (const f of filtered) {
    if (!bySource.has(f.source)) bySource.set(f.source, [])
    bySource.get(f.source)!.push(f)
  }

  const result: Record<string, number> = {}
  for (const [source, sourceForecasts] of bySource) {
    // Daily aggregates have min ≠ max
    const dailyAggs = sourceForecasts.filter(f => f.temperature.min !== f.temperature.max)
    if (dailyAggs.length > 0) {
      const temps = dailyAggs
        .map(f => type === 'high' ? f.temperature.max : f.temperature.min)
        .filter(t => typeof t === 'number' && !isNaN(t))
      if (temps.length > 0) {
        const temp = type === 'high' ? Math.max(...temps) : Math.min(...temps)
        result[source] = celsiusToFahrenheit(temp)
      }
    } else {
      // Hourly-only: take max/min of current temps
      const temps = sourceForecasts
        .map(f => f.temperature.current)
        .filter(t => typeof t === 'number' && !isNaN(t))
      if (temps.length > 0) {
        const temp = type === 'high' ? Math.max(...temps) : Math.min(...temps)
        result[source] = celsiusToFahrenheit(temp)
      }
    }
  }

  return result
}
