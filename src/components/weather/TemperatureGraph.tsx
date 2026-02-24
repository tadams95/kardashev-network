// Temperature Graph — smooth SVG temperature curve with precipitation overlay
// 24h mode: hourly consensus curve with current-hour glow
// 7-day mode: high/low dual curves with filled band

import { useState, useMemo } from 'react'
import type { WeatherForecast } from '@/types/weather'
import { celsiusToFahrenheit } from '@/lib/utils/temperature'
import { getHourlyConsensus } from '@/lib/utils/hourlyConsensus'
import { groupForecastsByDay, type DailyForecast } from '@/lib/utils/dailyForecasts'
import { createSmoothPath } from '@/lib/utils/svgChartUtils'

// ============================================================================
// Chart dimensions
// ============================================================================

const CHART_WIDTH = 600
const CHART_HEIGHT = 240
const PADDING = { top: 25, right: 30, bottom: 35, left: 52 }
const INNER_WIDTH = CHART_WIDTH - PADDING.left - PADDING.right
const INNER_HEIGHT = CHART_HEIGHT - PADDING.top - PADDING.bottom

// ============================================================================
// Types
// ============================================================================

type Mode = '24h' | '7day'

interface TemperatureGraphProps {
  forecasts: WeatherForecast[]
  timezone?: string
}

// ============================================================================
// Helpers
// ============================================================================

function formatHourLabel(hour: number): string {
  if (hour === 0 || hour === 24) return '12 AM'
  if (hour === 12) return '12 PM'
  const period = hour >= 12 ? 'PM' : 'AM'
  const displayHour = hour > 12 ? hour - 12 : hour
  return `${displayHour} ${period}`
}

function formatDayLabel(timestamp: string | number, timezone?: string): string {
  const date = new Date(timestamp)
  const today = new Date()
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  if (timezone) {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
    const dateKey = fmt.format(date)
    if (dateKey === fmt.format(today)) return 'Today'
    if (dateKey === fmt.format(tomorrow)) return 'Tomorrow'
    return new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(date)
  }

  if (date.toDateString() === today.toDateString()) return 'Today'
  if (date.toDateString() === tomorrow.toDateString()) return 'Tomorrow'
  return date.toLocaleDateString('en-US', { weekday: 'short' })
}

// ============================================================================
// 24h Chart
// ============================================================================

function Chart24h({ forecasts, timezone }: { forecasts: WeatherForecast[]; timezone?: string }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)

  const hourlyData = useMemo(() => getHourlyConsensus(forecasts, timezone), [forecasts, timezone])

  // Get daily high from the same pipeline the 7-day view uses — this is the
  // "true" daily max (from server-computed daily aggregates, not hourly snapshots).
  // We overlay it as a reference line so the hourly curve and daily forecast agree.
  const dailyHighF = useMemo(() => {
    const daily = groupForecastsByDay(forecasts, timezone)
    // The 24h window starts "now" and spans into tomorrow.
    // Show the first day with data that has a valid high (today or tomorrow).
    for (const d of daily) {
      if (d.high != null) return celsiusToFahrenheit(d.high)
    }
    return null
  }, [forecasts, timezone])

  const { points, precipBars, currentIndex, minTemp, maxTemp } = useMemo(() => {
    if (hourlyData.length < 3) return { points: [], precipBars: [], currentIndex: -1, minTemp: 0, maxTemp: 0 }

    const temps = hourlyData.map(d => celsiusToFahrenheit(d.temperature))
    const min = Math.min(...temps) - 2
    const max = Math.max(...temps) + 2
    const range = max - min || 1

    const pts = hourlyData.map((d, i) => {
      const tempF = celsiusToFahrenheit(d.temperature)
      return {
        x: PADDING.left + (i / (hourlyData.length - 1)) * INNER_WIDTH,
        y: PADDING.top + INNER_HEIGHT - ((tempF - min) / range) * INNER_HEIGHT,
        tempF,
        hour: d.hour,
        precip: d.precipProbability,
        isCurrentHour: d.isCurrentHour,
        isNextDay: d.isNextDay,
      }
    })

    const bars = pts.map((p, i) => ({
      x: p.x,
      probability: hourlyData[i].precipProbability,
    }))

    const currIdx = pts.findIndex(p => p.isCurrentHour)

    return { points: pts, precipBars: bars, currentIndex: currIdx, minTemp: min, maxTemp: max }
  }, [hourlyData])

  const curvePath = useMemo(() => createSmoothPath(points), [points])

  const gradientAreaPath = useMemo(() => {
    if (points.length < 2) return ''
    const bottomY = PADDING.top + INNER_HEIGHT
    return `${curvePath} L ${points[points.length - 1].x} ${bottomY} L ${points[0].x} ${bottomY} Z`
  }, [curvePath, points])

  if (hourlyData.length < 3) {
    return (
      <div className="flex items-center justify-center h-40 text-gray-500 text-sm">
        Not enough hourly data for graph
      </div>
    )
  }

  const tempRange = maxTemp - minTemp || 1
  const gridTemps = [minTemp, minTemp + tempRange * 0.33, minTemp + tempRange * 0.67, maxTemp]
  const barWidth = INNER_WIDTH / hourlyData.length * 0.6
  const maxPrecipHeight = INNER_HEIGHT * 0.25

  return (
    <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} className="w-full h-auto">
      <defs>
        <linearGradient id="temp-graph-amber-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.02" />
        </linearGradient>
        <filter id="temp-graph-glow" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Grid lines + Y-axis labels */}
      {gridTemps.map((temp, i) => {
        const y = PADDING.top + INNER_HEIGHT - ((temp - minTemp) / tempRange) * INNER_HEIGHT
        return (
          <g key={i}>
            <line
              x1={PADDING.left} y1={y}
              x2={CHART_WIDTH - PADDING.right} y2={y}
              stroke="#333" strokeWidth="1" strokeDasharray="2 2" opacity="0.3"
            />
            <text x={PADDING.left - 8} y={y + 3} textAnchor="end" className="fill-gray-500 text-[9px]">
              {temp.toFixed(1)}°F
            </text>
          </g>
        )
      })}

      {/* X-axis hour labels (every 3rd) */}
      {points.filter((_, i) => i % 3 === 0 || i === points.length - 1).map((p, i) => (
        <text
          key={i}
          x={p.x} y={CHART_HEIGHT - PADDING.bottom + 15}
          textAnchor="middle" className="fill-gray-500 text-[9px]"
        >
          {formatHourLabel(p.hour)}
        </text>
      ))}

      {/* Precipitation bars */}
      {precipBars.map((bar, i) => {
        if (bar.probability < 0.05) return null
        const barH = bar.probability * maxPrecipHeight
        return (
          <rect
            key={i}
            x={bar.x - barWidth / 2}
            y={PADDING.top + INNER_HEIGHT - barH}
            width={barWidth}
            height={barH}
            fill="#3b82f6"
            opacity="0.25"
            rx="1"
          />
        )
      })}

      {/* Gradient fill under curve */}
      <path d={gradientAreaPath} fill="url(#temp-graph-amber-gradient)" />

      {/* Temperature curve */}
      <path d={curvePath} fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" />

      {/* Daily high reference line — consensus daily max from daily aggregates */}
      {dailyHighF != null && dailyHighF >= minTemp && dailyHighF <= maxTemp && (() => {
        const y = PADDING.top + INNER_HEIGHT - ((dailyHighF - minTemp) / tempRange) * INNER_HEIGHT
        return (
          <g>
            <line
              x1={PADDING.left} y1={y}
              x2={CHART_WIDTH - PADDING.right} y2={y}
              stroke="#f59e0b" strokeWidth="1" strokeDasharray="4 3" opacity="0.5"
            />
            <text
              x={CHART_WIDTH - PADDING.right} y={y - 4}
              textAnchor="end" className="fill-amber-400/70 text-[8px]"
            >
              Daily High: {dailyHighF.toFixed(1)}°F
            </text>
          </g>
        )
      })()}

      {/* Current hour glow dot */}
      {currentIndex >= 0 && currentIndex < points.length && (
        <g filter="url(#temp-graph-glow)">
          <circle
            cx={points[currentIndex].x}
            cy={points[currentIndex].y}
            r="5" fill="#f59e0b"
          />
        </g>
      )}

      {/* Hit zones for hover */}
      {points.map((p, i) => {
        const hitWidth = INNER_WIDTH / Math.max(points.length - 1, 1)
        return (
          <rect
            key={i}
            x={p.x - hitWidth / 2}
            y={PADDING.top}
            width={hitWidth}
            height={INNER_HEIGHT}
            fill="transparent"
            onMouseEnter={() => setHoveredIndex(i)}
            onMouseLeave={() => setHoveredIndex(null)}
            onTouchStart={() => setHoveredIndex(i)}
            onTouchEnd={() => setHoveredIndex(null)}
          />
        )
      })}

      {/* Tooltip */}
      {hoveredIndex !== null && hoveredIndex < points.length && (() => {
        const p = points[hoveredIndex]
        const flipRight = p.x > CHART_WIDTH / 2
        const tooltipX = flipRight ? p.x - 88 : p.x + 8
        const tooltipY = Math.max(PADDING.top, Math.min(p.y - 30, PADDING.top + INNER_HEIGHT - 50))

        return (
          <g>
            {/* Vertical line */}
            <line
              x1={p.x} y1={PADDING.top}
              x2={p.x} y2={PADDING.top + INNER_HEIGHT}
              stroke="#f59e0b" strokeWidth="1" strokeDasharray="3 3" opacity="0.5"
            />
            {/* Dot on curve */}
            <circle cx={p.x} cy={p.y} r="4" fill="#f59e0b" stroke="#000" strokeWidth="1.5" />
            {/* Tooltip box */}
            <rect x={tooltipX} y={tooltipY} width="80" height="44" rx="4" fill="#1a1a2e" stroke="#333" strokeWidth="0.5" />
            <text x={tooltipX + 6} y={tooltipY + 14} className="fill-amber-400 text-[10px] font-medium">
              {p.tempF.toFixed(1)}°F
            </text>
            <text x={tooltipX + 6} y={tooltipY + 26} className="fill-gray-400 text-[9px]">
              {formatHourLabel(p.hour)}
            </text>
            <text x={tooltipX + 6} y={tooltipY + 38} className="fill-blue-400 text-[9px]">
              {(p.precip * 100).toFixed(0)}% rain
            </text>
          </g>
        )
      })()}
    </svg>
  )
}

// ============================================================================
// 7-Day Chart
// ============================================================================

function Chart7Day({ forecasts, timezone }: { forecasts: WeatherForecast[]; timezone?: string }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)

  const dailyData = useMemo(() => groupForecastsByDay(forecasts, timezone), [forecasts, timezone])

  // FA-04: validData (filtered to non-null high/low) must be used for hit zones,
  // labels, and tooltip access so indices align with highPoints/lowPoints arrays
  const { highPoints, lowPoints, precipBars, minTemp, maxTemp, validData } = useMemo(() => {
    if (dailyData.length < 2) return { highPoints: [], lowPoints: [], precipBars: [], minTemp: 0, maxTemp: 0, validData: [] as DailyForecast[] }

    const validData = dailyData.filter(d => d.high != null && d.low != null)
    if (validData.length < 2) return { highPoints: [], lowPoints: [], precipBars: [], minTemp: 0, maxTemp: 0, validData: [] as DailyForecast[] }
    const highs = validData.map(d => celsiusToFahrenheit(d.high!))
    const lows = validData.map(d => celsiusToFahrenheit(d.low!))
    const allTemps = [...highs, ...lows]
    const min = Math.min(...allTemps) - 2
    const max = Math.max(...allTemps) + 2
    const range = max - min || 1

    const hPts = validData.map((d, i) => {
      const tempF = celsiusToFahrenheit(d.high!)
      return {
        x: PADDING.left + (i / (validData.length - 1)) * INNER_WIDTH,
        y: PADDING.top + INNER_HEIGHT - ((tempF - min) / range) * INNER_HEIGHT,
        tempF,
      }
    })

    const lPts = validData.map((d, i) => {
      const tempF = celsiusToFahrenheit(d.low!)
      return {
        x: PADDING.left + (i / (validData.length - 1)) * INNER_WIDTH,
        y: PADDING.top + INNER_HEIGHT - ((tempF - min) / range) * INNER_HEIGHT,
        tempF,
      }
    })

    const bars = validData.map((d, i) => ({
      x: PADDING.left + (i / (validData.length - 1)) * INNER_WIDTH,
      probability: d.precipProbability,
    }))

    return { highPoints: hPts, lowPoints: lPts, precipBars: bars, minTemp: min, maxTemp: max, validData }
  }, [dailyData])

  const highPath = useMemo(() => createSmoothPath(highPoints), [highPoints])
  const lowPath = useMemo(() => createSmoothPath(lowPoints), [lowPoints])

  // Band path: trace high forward, low backward with lines
  const simpleBandPath = useMemo(() => {
    if (highPoints.length < 2) return ''
    const reversedLow = [...lowPoints].reverse()
    let path = highPath
    reversedLow.forEach(p => {
      path += ` L ${p.x} ${p.y}`
    })
    path += ' Z'
    return path
  }, [highPath, highPoints, lowPoints])

  if (dailyData.length < 2) {
    return (
      <div className="flex items-center justify-center h-40 text-gray-500 text-sm">
        Not enough daily data for graph
      </div>
    )
  }

  const tempRange = maxTemp - minTemp || 1
  const gridTemps = [minTemp, minTemp + tempRange * 0.33, minTemp + tempRange * 0.67, maxTemp]
  const barWidth = INNER_WIDTH / Math.max(validData.length, 1) * 0.5
  const maxPrecipHeight = INNER_HEIGHT * 0.25

  return (
    <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} className="w-full h-auto">
      <defs>
        <linearGradient id="temp-graph-band-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.08" />
        </linearGradient>
      </defs>

      {/* Grid lines + Y-axis labels */}
      {gridTemps.map((temp, i) => {
        const y = PADDING.top + INNER_HEIGHT - ((temp - minTemp) / tempRange) * INNER_HEIGHT
        return (
          <g key={i}>
            <line
              x1={PADDING.left} y1={y}
              x2={CHART_WIDTH - PADDING.right} y2={y}
              stroke="#333" strokeWidth="1" strokeDasharray="2 2" opacity="0.3"
            />
            <text x={PADDING.left - 8} y={y + 3} textAnchor="end" className="fill-gray-500 text-[9px]">
              {temp.toFixed(1)}°F
            </text>
          </g>
        )
      })}

      {/* X-axis day labels — use validData to align with point arrays */}
      {validData.map((d, i) => {
        const x = PADDING.left + (i / Math.max(validData.length - 1, 1)) * INNER_WIDTH
        return (
          <text
            key={i}
            x={x} y={CHART_HEIGHT - PADDING.bottom + 15}
            textAnchor="middle" className="fill-gray-500 text-[9px]"
          >
            {formatDayLabel(d.timestamp, timezone)}
          </text>
        )
      })}

      {/* Precipitation bars */}
      {precipBars.map((bar, i) => {
        if (bar.probability < 0.05) return null
        const barH = bar.probability * maxPrecipHeight
        return (
          <rect
            key={i}
            x={bar.x - barWidth / 2}
            y={PADDING.top + INNER_HEIGHT - barH}
            width={barWidth}
            height={barH}
            fill="#3b82f6"
            opacity="0.2"
            rx="2"
          />
        )
      })}

      {/* Filled band between high and low */}
      <path d={simpleBandPath} fill="url(#temp-graph-band-gradient)" />

      {/* High curve (amber) */}
      <path d={highPath} fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" />

      {/* Low curve (blue) */}
      <path d={lowPath} fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" />

      {/* Dot markers */}
      {highPoints.map((p, i) => (
        <circle key={`h-${i}`} cx={p.x} cy={p.y} r="3" fill="#f59e0b" />
      ))}
      {lowPoints.map((p, i) => (
        <circle key={`l-${i}`} cx={p.x} cy={p.y} r="3" fill="#60a5fa" />
      ))}

      {/* Hit zones for hover — iterate validData so indices align with highPoints/lowPoints */}
      {validData.map((_, i) => {
        const hitWidth = INNER_WIDTH / Math.max(validData.length - 1, 1)
        const x = PADDING.left + (i / Math.max(validData.length - 1, 1)) * INNER_WIDTH
        return (
          <rect
            key={i}
            x={x - hitWidth / 2}
            y={PADDING.top}
            width={hitWidth}
            height={INNER_HEIGHT}
            fill="transparent"
            onMouseEnter={() => setHoveredIndex(i)}
            onMouseLeave={() => setHoveredIndex(null)}
            onTouchStart={() => setHoveredIndex(i)}
            onTouchEnd={() => setHoveredIndex(null)}
          />
        )
      })}

      {/* Tooltip — use validData for data lookup to match point array indices */}
      {hoveredIndex !== null && hoveredIndex < validData.length && (() => {
        const hP = highPoints[hoveredIndex]
        const lP = lowPoints[hoveredIndex]
        const d = validData[hoveredIndex]
        const midX = hP.x
        const flipRight = midX > CHART_WIDTH / 2
        const tooltipX = flipRight ? midX - 94 : midX + 8
        const tooltipY = Math.max(PADDING.top, Math.min(hP.y - 10, PADDING.top + INNER_HEIGHT - 55))

        return (
          <g>
            <line
              x1={midX} y1={PADDING.top}
              x2={midX} y2={PADDING.top + INNER_HEIGHT}
              stroke="#f59e0b" strokeWidth="1" strokeDasharray="3 3" opacity="0.5"
            />
            <circle cx={hP.x} cy={hP.y} r="4" fill="#f59e0b" stroke="#000" strokeWidth="1.5" />
            <circle cx={lP.x} cy={lP.y} r="4" fill="#60a5fa" stroke="#000" strokeWidth="1.5" />
            <rect x={tooltipX} y={tooltipY} width="86" height="50" rx="4" fill="#1a1a2e" stroke="#333" strokeWidth="0.5" />
            <text x={tooltipX + 6} y={tooltipY + 14} className="fill-gray-300 text-[10px] font-medium">
              {formatDayLabel(d.timestamp, timezone)}
            </text>
            <text x={tooltipX + 6} y={tooltipY + 28} className="fill-amber-400 text-[9px]">
              H: {hP.tempF.toFixed(1)}°F
            </text>
            <text x={tooltipX + 6} y={tooltipY + 40} className="fill-blue-400 text-[9px]">
              L: {lP.tempF.toFixed(1)}°F
            </text>
            {d.precipProbability > 0.05 && (
              <text x={tooltipX + 50} y={tooltipY + 28} className="fill-blue-300 text-[8px]">
                {(d.precipProbability * 100).toFixed(0)}%
              </text>
            )}
          </g>
        )
      })()}
    </svg>
  )
}

// ============================================================================
// Main Component
// ============================================================================

export default function TemperatureGraph({ forecasts, timezone }: TemperatureGraphProps) {
  const [mode, setMode] = useState<Mode>('24h')

  return (
    <div className="bg-black/40 border border-gray-700/50 rounded-xl p-5">
      {/* Header row */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-white">Temperature Forecast</h3>
        <div className="flex bg-gray-800/50 rounded-lg p-0.5">
          <button
            onClick={() => setMode('24h')}
            className={`px-3 py-1 text-xs rounded-md transition-colors ${
              mode === '24h'
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                : 'text-gray-400 hover:text-gray-300'
            }`}
          >
            24-Hour
          </button>
          <button
            onClick={() => setMode('7day')}
            className={`px-3 py-1 text-xs rounded-md transition-colors ${
              mode === '7day'
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                : 'text-gray-400 hover:text-gray-300'
            }`}
          >
            7-Day
          </button>
        </div>
      </div>

      {/* Chart */}
      {mode === '24h' ? (
        <Chart24h forecasts={forecasts} timezone={timezone} />
      ) : (
        <Chart7Day forecasts={forecasts} timezone={timezone} />
      )}

      {/* Legend */}
      <div className="flex items-center justify-center gap-5 mt-3 text-xs">
        {mode === '24h' ? (
          <>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-0.5 bg-amber-500 rounded-full" />
              <span className="text-gray-400">Temperature</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-0 border-t border-dashed border-amber-500/50" />
              <span className="text-gray-400">Daily High</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 bg-blue-500/30 rounded-sm" />
              <span className="text-gray-400">Precipitation</span>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-0.5 bg-amber-500 rounded-full" />
              <span className="text-gray-400">High</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-0.5 bg-blue-400 rounded-full" />
              <span className="text-gray-400">Low</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 bg-blue-500/25 rounded-sm" />
              <span className="text-gray-400">Precipitation</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// Skeleton
// ============================================================================

export function TemperatureGraphSkeleton() {
  return (
    <div className="bg-black/40 border border-gray-700/50 rounded-xl p-5 animate-pulse">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="h-4 w-36 bg-gray-700/30 rounded" />
        <div className="flex gap-1">
          <div className="h-6 w-16 bg-gray-700/30 rounded-md" />
          <div className="h-6 w-14 bg-gray-700/30 rounded-md" />
        </div>
      </div>

      {/* Chart placeholder */}
      <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} className="w-full h-auto">
        {/* Grid lines */}
        {[0.25, 0.5, 0.75].map((fraction) => {
          const y = PADDING.top + INNER_HEIGHT * fraction
          return (
            <line
              key={fraction}
              x1={PADDING.left} y1={y}
              x2={CHART_WIDTH - PADDING.right} y2={y}
              stroke="rgb(55, 65, 81)" strokeWidth="1" strokeDasharray="2 2" opacity="0.3"
            />
          )
        })}
        {/* Placeholder bezier */}
        <path
          d={`M ${PADDING.left} ${PADDING.top + INNER_HEIGHT * 0.6} Q ${PADDING.left + INNER_WIDTH * 0.3} ${PADDING.top + INNER_HEIGHT * 0.3} ${PADDING.left + INNER_WIDTH * 0.5} ${PADDING.top + INNER_HEIGHT * 0.25} Q ${PADDING.left + INNER_WIDTH * 0.7} ${PADDING.top + INNER_HEIGHT * 0.2} ${CHART_WIDTH - PADDING.right} ${PADDING.top + INNER_HEIGHT * 0.5}`}
          fill="none" stroke="rgb(55, 65, 81)" strokeWidth="2" opacity="0.4"
        />
      </svg>

      {/* Legend placeholder */}
      <div className="flex items-center justify-center gap-4 mt-3">
        <div className="h-3 w-24 bg-gray-700/30 rounded" />
        <div className="h-3 w-20 bg-gray-700/30 rounded" />
      </div>
    </div>
  )
}
