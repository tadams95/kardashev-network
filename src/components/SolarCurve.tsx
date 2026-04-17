// Apple Watch-style solar arc visualization
// Smooth bell curve with horizon line, glowing sun dot, minimal labels

import { useMemo } from 'react'
import { createSmoothPath } from '@/lib/utils/svgChartUtils'

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

function getHourFraction(timeStr: string): number {
  const d = new Date(timeStr)
  return d.getHours() + d.getMinutes() / 60
}

// Interpolate Y position on the curve at a given X
function interpolateY(points: { x: number; y: number }[], targetX: number): number | null {
  if (points.length < 2) return null
  for (let i = 0; i < points.length - 1; i++) {
    if (targetX >= points[i].x && targetX <= points[i + 1].x) {
      const t = (targetX - points[i].x) / (points[i + 1].x - points[i].x)
      return points[i].y + t * (points[i + 1].y - points[i].y)
    }
  }
  return null
}

// Chart dimensions
const CHART_WIDTH = 400
const CHART_HEIGHT = 200
const PADDING = { top: 30, right: 25, bottom: 30, left: 25 }
const INNER_WIDTH = CHART_WIDTH - PADDING.left - PADDING.right
const INNER_HEIGHT = CHART_HEIGHT - PADDING.top - PADDING.bottom
const HORIZON_Y = PADDING.top + INNER_HEIGHT * 0.65 // horizon sits in lower portion

export default function SolarCurve({ hourly, sunrise, sunset }: SolarCurveProps) {
  const currentHour = useMemo(() => new Date().getHours(), [])
  const currentMinutes = useMemo(() => new Date().getMinutes(), [])
  const currentDate = useMemo(() => new Date().getDate(), [])
  const sunriseHour = sunrise ? getHourFraction(sunrise) : 6
  const sunsetHour = sunset ? getHourFraction(sunset) : 18

  // Extended data window: 1.5 hours before sunrise, 1.5 hours after sunset
  const { displayData, isNight, showingTomorrow } = useMemo(() => {
    const isCurrentlyNight = currentHour < Math.floor(sunriseHour) || currentHour >= Math.ceil(sunsetHour)

    if (isCurrentlyNight && currentHour >= Math.ceil(sunsetHour)) {
      // After sunset - show tomorrow
      const tomorrowStart = hourly.findIndex(h => {
        const hDate = new Date(h.time).getDate()
        return hDate > currentDate && getHour(h.time) >= Math.floor(sunriseHour) - 2
      })
      if (tomorrowStart !== -1) {
        const tomorrowEnd = hourly.findIndex((h, i) =>
          i > tomorrowStart && getHour(h.time) >= Math.ceil(sunsetHour) + 2
        )
        return {
          displayData: hourly.slice(tomorrowStart, tomorrowEnd !== -1 ? tomorrowEnd + 1 : tomorrowStart + 18),
          isNight: true,
          showingTomorrow: true
        }
      }
    }

    // Extended window: 1.5 hrs before sunrise to 1.5 hrs after sunset
    const extStart = Math.max(0, Math.floor(sunriseHour) - 2)
    const extEnd = Math.min(23, Math.ceil(sunsetHour) + 2)

    const dayStart = hourly.findIndex(h => getHour(h.time) >= extStart)
    const dayEnd = hourly.findIndex((h, i) => i > dayStart && getHour(h.time) > extEnd)

    return {
      displayData: hourly.slice(
        Math.max(0, dayStart),
        dayEnd !== -1 ? dayEnd : Math.min(hourly.length, dayStart + 20)
      ),
      isNight: isCurrentlyNight,
      showingTomorrow: false
    }
  }, [hourly, currentHour, currentDate, sunriseHour, sunsetHour])

  // Calculate scales and points - Y mapped so GHI=0 is at horizon, positive arcs above
  const { points, peakPoint, currentX, currentY, peakGhi, currentGhi, sunriseX, sunsetX } = useMemo(() => {
    if (displayData.length === 0) {
      return { points: [], peakPoint: null, currentX: null, currentY: null, peakGhi: 0, currentGhi: 0, sunriseX: null, sunsetX: null }
    }

    const maxGhi = Math.max(...displayData.map(h => h.ghi), 100)
    const startHourF = getHourFraction(displayData[0].time)
    const endHourF = getHourFraction(displayData[displayData.length - 1].time)
    const hourSpan = endHourF - startHourF || 1

    // Below-horizon dip amount (how far GHI=0 points go below horizon)
    const dipBelow = INNER_HEIGHT * 0.15

    const pts = displayData.map(d => {
      const hourF = getHourFraction(d.time)
      const x = PADDING.left + ((hourF - startHourF) / hourSpan) * INNER_WIDTH
      // GHI=0 maps to HORIZON_Y + dipBelow (slightly below horizon for smooth arc)
      // Max GHI maps to PADDING.top
      const aboveHorizon = HORIZON_Y - PADDING.top
      const y = d.ghi > 0
        ? HORIZON_Y - (d.ghi / maxGhi) * aboveHorizon
        : HORIZON_Y + dipBelow
      return { x, y, ghi: d.ghi, hour: getHour(d.time), time: d.time }
    })

    // Find peak
    const peak = pts.reduce((max, p) => p.ghi > max.ghi ? p : max, pts[0])

    // Calculate sunrise/sunset X positions
    const srX = PADDING.left + ((sunriseHour - startHourF) / hourSpan) * INNER_WIDTH
    const ssX = PADDING.left + ((sunsetHour - startHourF) / hourSpan) * INNER_WIDTH

    // Calculate current position on curve
    let currX: number | null = null
    let currY: number | null = null
    let currGhi = 0
    if (!isNight && !showingTomorrow) {
      const currentHourF = currentHour + currentMinutes / 60
      const progress = (currentHourF - startHourF) / hourSpan
      if (progress >= 0 && progress <= 1) {
        currX = PADDING.left + progress * INNER_WIDTH
        // Interpolate Y on the actual curve
        currY = interpolateY(pts, currX)
        // Interpolate GHI
        const idx = Math.floor(progress * (pts.length - 1))
        const nextIdx = Math.min(idx + 1, pts.length - 1)
        const t = (progress * (pts.length - 1)) - idx
        currGhi = pts[idx].ghi * (1 - t) + pts[nextIdx].ghi * t
      }
    }

    return {
      points: pts,
      peakPoint: peak,
      currentX: currX,
      currentY: currY,
      peakGhi: maxGhi,
      currentGhi: currGhi,
      sunriseX: srX,
      sunsetX: ssX
    }
  }, [displayData, isNight, showingTomorrow, currentHour, currentMinutes, sunriseHour, sunsetHour])

  // Create path
  const curvePath = useMemo(() => createSmoothPath(points), [points])

  // Create gradient fill area path (curve down to horizon, clipped)
  const gradientAreaPath = useMemo(() => {
    if (points.length < 2) return ''
    // Close path along horizon line
    return `${curvePath} L ${points[points.length - 1].x} ${HORIZON_Y} L ${points[0].x} ${HORIZON_Y} Z`
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
      {/* SVG Chart. Tomorrow badge (when after sunset) overlays the chart's
          top-right corner per plan §3.4 — integrated with the chart instead
          of sitting above it as a separate row. */}
      <div className="relative">
        {showingTomorrow && (
          <div className="absolute top-1 right-1 z-10 pointer-events-none">
            <span className="text-caption p-chip rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
              Tomorrow
            </span>
          </div>
        )}
        <svg
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          className="w-full h-auto"
          style={{ maxHeight: '220px' }}
        >
          <defs>
            {/* Warm gradient fill above horizon */}
            <linearGradient id="solarArcGradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.35" />
              <stop offset="60%" stopColor="#f97316" stopOpacity="0.12" />
              <stop offset="100%" stopColor="#f97316" stopOpacity="0" />
            </linearGradient>

            {/* Clip to above-horizon region for gradient fill */}
            <clipPath id="aboveHorizon">
              <rect x="0" y="0" width={CHART_WIDTH} height={HORIZON_Y} />
            </clipPath>

            {/* Glow filter for sun dot */}
            <filter id="sunGlow" x="-100%" y="-100%" width="300%" height="300%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Horizon line */}
          <line
            x1={PADDING.left}
            y1={HORIZON_Y}
            x2={CHART_WIDTH - PADDING.right}
            y2={HORIZON_Y}
            stroke="#333"
            strokeWidth="1"
            strokeDasharray="4 4"
            opacity="0.6"
          />

          {/* Gradient fill above horizon */}
          <path
            d={gradientAreaPath}
            fill="url(#solarArcGradient)"
            clipPath="url(#aboveHorizon)"
            className="animate-fade-in"
          />

          {/* Arc curve line */}
          <path
            d={curvePath}
            fill="none"
            stroke="#9ca3af"
            strokeWidth="1.5"
            strokeLinecap="round"
            opacity="0.5"
          />

          {/* Peak annotation — only when the day clears a "high" threshold
              (>=500 W/m²). Free chart real estate gives the user the peak
              value at a glance without scanning the summary row.
              Per plan §3.4. */}
          {peakPoint && peakGhi >= 500 && (
            <g>
              <circle
                cx={peakPoint.x}
                cy={peakPoint.y}
                r="3"
                fill="#facc15"
                opacity="0.9"
              />
              <line
                x1={peakPoint.x}
                y1={peakPoint.y - 5}
                x2={peakPoint.x}
                y2={peakPoint.y - 13}
                stroke="#facc15"
                strokeWidth="1"
                opacity="0.5"
              />
              <text
                x={peakPoint.x}
                y={peakPoint.y - 17}
                textAnchor="middle"
                className="fill-yellow-400 text-micro font-medium"
              >
                {Math.round(peakGhi)} W/m²
              </text>
            </g>
          )}

          {/* Sun dot with glow at current position */}
          {currentX !== null && currentY !== null && (
            <g filter="url(#sunGlow)">
              <circle
                cx={currentX}
                cy={currentY}
                r="6"
                fill="#f59e0b"
              />
            </g>
          )}

          {/* Sunrise label */}
          {sunriseX !== null && sunriseX > PADDING.left - 5 && sunriseX < CHART_WIDTH - PADDING.right + 5 && (
            <text
              x={sunriseX}
              y={HORIZON_Y + 16}
              textAnchor="middle"
              className="fill-gray-500 text-micro"
            >
              {formatTime(sunrise)}
            </text>
          )}

          {/* Sunset label */}
          {sunsetX !== null && sunsetX > PADDING.left - 5 && sunsetX < CHART_WIDTH - PADDING.right + 5 && (
            <text
              x={sunsetX}
              y={HORIZON_Y + 16}
              textAnchor="middle"
              className="fill-gray-500 text-micro"
            >
              {formatTime(sunset)}
            </text>
          )}

          {/* Sunrise/sunset small markers on horizon */}
          {sunriseX !== null && sunriseX > PADDING.left && sunriseX < CHART_WIDTH - PADDING.right && (
            <circle cx={sunriseX} cy={HORIZON_Y} r="2" fill="#eab308" opacity="0.4" />
          )}
          {sunsetX !== null && sunsetX > PADDING.left && sunsetX < CHART_WIDTH - PADDING.right && (
            <circle cx={sunsetX} cy={HORIZON_Y} r="2" fill="#f97316" opacity="0.4" />
          )}
        </svg>
      </div>

      {/* Summary stats */}
      <div className="flex items-center justify-center gap-6 mt-3 text-caption">
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
            <div className="w-2 h-2 rounded-full bg-amber-500 shadow-lg shadow-amber-500/50" />
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
      {/* Chart skeleton - arc shape with horizon */}
      <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} className="w-full h-auto" style={{ maxHeight: '220px' }}>
        {/* Horizon line */}
        <line
          x1={PADDING.left}
          y1={HORIZON_Y}
          x2={CHART_WIDTH - PADDING.right}
          y2={HORIZON_Y}
          stroke="rgb(55, 65, 81)"
          strokeWidth="1"
          strokeDasharray="4 4"
          opacity="0.3"
        />
        {/* Arc shape */}
        <path
          d={`M ${PADDING.left} ${HORIZON_Y + 15} Q ${CHART_WIDTH * 0.3} ${HORIZON_Y} ${CHART_WIDTH * 0.5} ${PADDING.top + 20} Q ${CHART_WIDTH * 0.7} ${HORIZON_Y} ${CHART_WIDTH - PADDING.right} ${HORIZON_Y + 15}`}
          fill="none"
          stroke="rgb(55, 65, 81)"
          strokeWidth="1.5"
          opacity="0.4"
        />
      </svg>

      {/* Summary skeleton — two indicators (Peak + Now) to match the
          loaded structure (item 3.11). */}
      <div className="flex items-center justify-center gap-6 mt-3">
        <div className="h-4 w-32 bg-gray-700 rounded-chip" />
        <div className="h-4 w-24 bg-gray-700 rounded-chip" />
      </div>
    </div>
  )
}
