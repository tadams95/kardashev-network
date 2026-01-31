// Premium solar forecast curve visualization
// Renders a smooth bell curve showing daily irradiance pattern

import { useMemo } from 'react'

interface HourlyData {
  time: string
  ghi: number
}

interface SolarCurveProps {
  hourly: HourlyData[]
  sunrise: string
  sunset: string
}

// Format time for display
function formatTime(timeStr: string): string {
  if (!timeStr) return '--:--'
  const date = new Date(timeStr)
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function formatHour(timeStr: string): string {
  const date = new Date(timeStr)
  return date.toLocaleTimeString([], { hour: 'numeric' })
}

function getHour(timeStr: string): number {
  return new Date(timeStr).getHours()
}

// Create smooth bezier curve path from data points
function createSmoothPath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return ''

  let path = `M ${points[0].x} ${points[0].y}`

  for (let i = 0; i < points.length - 1; i++) {
    const current = points[i]
    const next = points[i + 1]
    const prev = points[i - 1] || current
    const afterNext = points[i + 2] || next

    // Calculate control points for smooth curve
    const tension = 0.3
    const cp1x = current.x + (next.x - prev.x) * tension
    const cp1y = current.y + (next.y - prev.y) * tension
    const cp2x = next.x - (afterNext.x - current.x) * tension
    const cp2y = next.y - (afterNext.y - current.y) * tension

    path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${next.x} ${next.y}`
  }

  return path
}

// Chart dimensions (constants)
const CHART_WIDTH = 400
const CHART_HEIGHT = 120
const PADDING = { top: 20, right: 20, bottom: 30, left: 20 }
const INNER_WIDTH = CHART_WIDTH - PADDING.left - PADDING.right
const INNER_HEIGHT = CHART_HEIGHT - PADDING.top - PADDING.bottom

export default function SolarCurve({ hourly, sunrise, sunset }: SolarCurveProps) {
  const currentHour = useMemo(() => new Date().getHours(), [])
  const currentMinutes = useMemo(() => new Date().getMinutes(), [])
  const currentDate = useMemo(() => new Date().getDate(), [])
  const sunriseHour = sunrise ? getHour(sunrise) : 6
  const sunsetHour = sunset ? getHour(sunset) : 18

  // Filter to daylight hours for display
  const { displayData, isNight, showingTomorrow } = useMemo(() => {
    const isCurrentlyNight = currentHour < sunriseHour || currentHour >= sunsetHour

    if (isCurrentlyNight && currentHour >= sunsetHour) {
      // After sunset - show tomorrow
      const tomorrowStart = hourly.findIndex(h => {
        const hDate = new Date(h.time).getDate()
        return hDate > currentDate && getHour(h.time) >= sunriseHour
      })
      if (tomorrowStart !== -1) {
        const tomorrowEnd = hourly.findIndex((h, i) =>
          i > tomorrowStart && getHour(h.time) >= sunsetHour
        )
        return {
          displayData: hourly.slice(tomorrowStart, tomorrowEnd !== -1 ? tomorrowEnd + 1 : tomorrowStart + 14),
          isNight: true,
          showingTomorrow: true
        }
      }
    }

    // Show today's daylight hours
    const dayStart = hourly.findIndex(h => getHour(h.time) >= sunriseHour)
    const dayEnd = hourly.findIndex((h, i) => i > dayStart && getHour(h.time) > sunsetHour)

    return {
      displayData: hourly.slice(
        Math.max(0, dayStart),
        dayEnd !== -1 ? dayEnd : Math.min(hourly.length, dayStart + 14)
      ),
      isNight: isCurrentlyNight,
      showingTomorrow: false
    }
  }, [hourly, currentHour, currentDate, sunriseHour, sunsetHour])

  // Calculate scales and points
  const { points, peakPoint, currentX, peakGhi, currentGhi } = useMemo(() => {
    if (displayData.length === 0) {
      return { points: [], peakPoint: null, currentX: null, peakGhi: 0, currentGhi: 0 }
    }

    const maxGhi = Math.max(...displayData.map(h => h.ghi), 100)
    const startHour = getHour(displayData[0].time)
    const endHour = getHour(displayData[displayData.length - 1].time)
    const hourSpan = endHour - startHour || 1

    const pts = displayData.map((d, i) => {
      const hour = getHour(d.time)
      const x = PADDING.left + ((hour - startHour) / hourSpan) * INNER_WIDTH
      const y = PADDING.top + INNER_HEIGHT - (d.ghi / maxGhi) * INNER_HEIGHT
      return { x, y, ghi: d.ghi, hour, time: d.time }
    })

    // Find peak
    const peak = pts.reduce((max, p) => p.ghi > max.ghi ? p : max, pts[0])

    // Calculate current position
    let currX = null
    let currGhi = 0
    if (!isNight && !showingTomorrow) {
      const progress = (currentHour + currentMinutes / 60 - startHour) / hourSpan
      if (progress >= 0 && progress <= 1) {
        currX = PADDING.left + progress * INNER_WIDTH
        // Interpolate current GHI
        const idx = Math.floor(progress * (pts.length - 1))
        const nextIdx = Math.min(idx + 1, pts.length - 1)
        const t = (progress * (pts.length - 1)) - idx
        currGhi = pts[idx].ghi * (1 - t) + pts[nextIdx].ghi * t
      }
    }

    return { points: pts, peakPoint: peak, currentX: currX, peakGhi: maxGhi, currentGhi: currGhi }
  }, [displayData, isNight, showingTomorrow, currentHour, currentMinutes])

  // Create path
  const curvePath = useMemo(() => createSmoothPath(points), [points])

  // Create area path (curve + bottom edge)
  const areaPath = useMemo(() => {
    if (points.length < 2) return ''
    const bottomY = PADDING.top + INNER_HEIGHT
    return `${curvePath} L ${points[points.length - 1].x} ${bottomY} L ${points[0].x} ${bottomY} Z`
  }, [curvePath, points])

  if (displayData.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        No forecast data available
      </div>
    )
  }

  return (
    <div className="w-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <div className="w-5 h-5 rounded-full bg-gradient-to-br from-yellow-400 to-orange-500 flex items-center justify-center shadow-lg shadow-yellow-500/20">
              <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 17a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zm5.657-2.343a1 1 0 010 1.414l-.707.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            </div>
            <span className="text-sm text-gray-400">Sunrise</span>
            <span className="text-sm font-medium text-white">{formatTime(sunrise)}</span>
          </div>
          <div className="w-px h-4 bg-gray-700" />
          <div className="flex items-center gap-1.5">
            <div className="w-5 h-5 rounded-full bg-gradient-to-br from-orange-500 to-purple-600 flex items-center justify-center shadow-lg shadow-orange-500/20">
              <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
              </svg>
            </div>
            <span className="text-sm text-gray-400">Sunset</span>
            <span className="text-sm font-medium text-white">{formatTime(sunset)}</span>
          </div>
        </div>

        {showingTomorrow && (
          <span className="text-xs px-2 py-1 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
            Tomorrow
          </span>
        )}
      </div>

      {/* SVG Chart */}
      <div className="relative">
        <svg
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          className="w-full h-auto"
          style={{ maxHeight: '160px' }}
        >
          <defs>
            {/* Gradient for area fill */}
            <linearGradient id="curveGradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#facc15" stopOpacity="0.6" />
              <stop offset="50%" stopColor="#f97316" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#f97316" stopOpacity="0" />
            </linearGradient>

            {/* Glow filter for peak */}
            <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>

            {/* Gradient for current indicator line */}
            <linearGradient id="nowLineGradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#22c55e" stopOpacity="0" />
              <stop offset="30%" stopColor="#22c55e" stopOpacity="1" />
              <stop offset="70%" stopColor="#22c55e" stopOpacity="1" />
              <stop offset="100%" stopColor="#22c55e" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Area fill */}
          <path
            d={areaPath}
            fill="url(#curveGradient)"
            className="animate-fade-in"
          />

          {/* Main curve line */}
          <path
            d={curvePath}
            fill="none"
            stroke="url(#curveGradient)"
            strokeWidth="2.5"
            strokeLinecap="round"
            className="animate-draw"
            style={{
              filter: 'drop-shadow(0 0 6px rgba(250, 204, 21, 0.4))'
            }}
          />

          {/* Peak indicator */}
          {peakPoint && (
            <g filter="url(#glow)">
              <circle
                cx={peakPoint.x}
                cy={peakPoint.y}
                r="5"
                fill="#facc15"
                className="animate-pulse"
              />
              <circle
                cx={peakPoint.x}
                cy={peakPoint.y}
                r="8"
                fill="none"
                stroke="#facc15"
                strokeWidth="1"
                opacity="0.5"
              />
            </g>
          )}

          {/* Current time indicator */}
          {currentX !== null && (
            <g>
              {/* Vertical line */}
              <line
                x1={currentX}
                y1={PADDING.top - 5}
                x2={currentX}
                y2={PADDING.top + INNER_HEIGHT + 5}
                stroke="url(#nowLineGradient)"
                strokeWidth="2"
                strokeDasharray="4 2"
              />
              {/* Current point on curve */}
              <circle
                cx={currentX}
                cy={PADDING.top + INNER_HEIGHT - (currentGhi / peakGhi) * INNER_HEIGHT}
                r="6"
                fill="#22c55e"
                stroke="#fff"
                strokeWidth="2"
                style={{ filter: 'drop-shadow(0 0 4px rgba(34, 197, 94, 0.6))' }}
              />
            </g>
          )}

          {/* X-axis time labels */}
          {points.filter((_, i) => i === 0 || i === Math.floor(points.length / 2) || i === points.length - 1).map((p, i) => (
            <text
              key={i}
              x={p.x}
              y={CHART_HEIGHT - 8}
              textAnchor="middle"
              className="fill-gray-500 text-[10px]"
            >
              {formatHour(p.time)}
            </text>
          ))}

          {/* Sunrise/sunset markers */}
          <text
            x={PADDING.left}
            y={PADDING.top + INNER_HEIGHT + 2}
            textAnchor="start"
            className="fill-yellow-500/60 text-[10px]"
          >
            ↑
          </text>
          <text
            x={CHART_WIDTH - PADDING.right}
            y={PADDING.top + INNER_HEIGHT + 2}
            textAnchor="end"
            className="fill-orange-500/60 text-[10px]"
          >
            ↓
          </text>
        </svg>

        {/* Current value overlay */}
        {currentX !== null && currentGhi > 0 && (
          <div
            className="absolute top-0 bg-gray-900/90 border border-green-500/30 rounded-lg px-2 py-1 text-xs shadow-lg"
            style={{
              left: `${(currentX / CHART_WIDTH) * 100}%`,
              transform: 'translateX(-50%)'
            }}
          >
            <span className="text-green-400 font-semibold">{Math.round(currentGhi)}</span>
            <span className="text-gray-400 ml-1">W/m²</span>
          </div>
        )}
      </div>

      {/* Summary */}
      <div className="flex items-center justify-center gap-6 mt-4 text-xs">
        {peakPoint && (
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-yellow-400 shadow-lg shadow-yellow-400/50" />
            <span className="text-gray-400">Peak</span>
            <span className="text-white font-medium">{Math.round(peakPoint.ghi)} W/m²</span>
            <span className="text-gray-500">at {formatHour(peakPoint.time)}</span>
          </div>
        )}
        {currentGhi > 0 && (
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-400 shadow-lg shadow-green-400/50" />
            <span className="text-gray-400">Now</span>
            <span className="text-white font-medium">{Math.round(currentGhi)} W/m²</span>
          </div>
        )}
      </div>
    </div>
  )
}

export function SolarCurveSkeleton() {
  return (
    <div className="w-full animate-pulse">
      {/* Header skeleton */}
      <div className="flex items-center gap-4 mb-4">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-full bg-gray-700" />
          <div className="h-4 w-24 bg-gray-700 rounded" />
        </div>
        <div className="w-px h-4 bg-gray-700" />
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-full bg-gray-700" />
          <div className="h-4 w-24 bg-gray-700 rounded" />
        </div>
      </div>

      {/* Chart skeleton - bell curve shape */}
      <svg viewBox="0 0 400 120" className="w-full h-auto" style={{ maxHeight: '160px' }}>
        <path
          d="M 20 100 Q 100 100 150 60 Q 200 20 250 60 Q 300 100 380 100"
          fill="none"
          stroke="rgb(55, 65, 81)"
          strokeWidth="2"
          opacity="0.5"
        />
        <path
          d="M 20 100 Q 100 100 150 60 Q 200 20 250 60 Q 300 100 380 100 L 380 100 L 20 100 Z"
          fill="rgb(55, 65, 81)"
          opacity="0.2"
        />
      </svg>

      {/* Summary skeleton */}
      <div className="flex items-center justify-center gap-6 mt-4">
        <div className="h-4 w-32 bg-gray-700 rounded" />
      </div>
    </div>
  )
}
