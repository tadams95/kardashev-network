// ROI Curve - cumulative P&L over time
// Custom SVG line chart following SolarCurve pattern

import { useMemo } from 'react'
import type { BacktestResult } from '@/types/weather'

interface ROICurveProps {
  trades: BacktestResult[]
  bankroll?: number
}

// Chart dimensions
const CHART_WIDTH = 400
const CHART_HEIGHT = 200
const PADDING = { top: 30, right: 30, bottom: 40, left: 50 }
const INNER_WIDTH = CHART_WIDTH - PADDING.left - PADDING.right
const INNER_HEIGHT = CHART_HEIGHT - PADDING.top - PADDING.bottom

// Create smooth bezier curve path
function createSmoothPath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return ''

  let path = `M ${points[0].x} ${points[0].y}`

  for (let i = 0; i < points.length - 1; i++) {
    const current = points[i]
    const next = points[i + 1]
    const prev = points[i - 1] || current
    const afterNext = points[i + 2] || next

    const tension = 0.3
    const cp1x = current.x + (next.x - prev.x) * tension
    const cp1y = current.y + (next.y - prev.y) * tension
    const cp2x = next.x - (afterNext.x - current.x) * tension
    const cp2y = next.y - (afterNext.y - current.y) * tension

    path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${next.x} ${next.y}`
  }

  return path
}

export default function ROICurve({ trades, bankroll = 100 }: ROICurveProps) {
  // Calculate cumulative P&L and points
  const { points, minY, maxY, finalPnL, maxDrawdownPoint } = useMemo<{
    points: Array<{ x: number; y: number; trade: BacktestResult }>
    minY: number
    maxY: number
    finalPnL: number
    maxDrawdownPoint: { x: number; y: number; index: number } | null
  }>(() => {
    if (trades.length === 0) {
      return { points: [], minY: 0, maxY: 0, finalPnL: 0, maxDrawdownPoint: null }
    }

    let cumulative = 0
    let peak = 0
    let maxDD = 0
    let maxDDPoint: { x: number; y: number; index: number } | null = null

    const pts = trades.map((trade, i) => {
      cumulative += trade.netProfit

      // Track drawdown
      if (cumulative > peak) {
        peak = cumulative
      }
      const drawdown = peak - cumulative
      if (drawdown > maxDD) {
        maxDD = drawdown
        maxDDPoint = { x: i, y: cumulative, index: i }
      }

      return { x: i, y: cumulative, trade }
    })

    const allY = pts.map(p => p.y)
    const min = Math.min(...allY, 0)
    const max = Math.max(...allY, 0)

    return {
      points: pts,
      minY: min,
      maxY: max,
      finalPnL: cumulative,
      maxDrawdownPoint: maxDDPoint,
    }
  }, [trades])

  // Scale points to chart dimensions
  const scaledPoints = useMemo(() => {
    if (points.length === 0) return []

    const yRange = maxY - minY || 1
    const xScale = INNER_WIDTH / Math.max(points.length - 1, 1)

    return points.map((p, i) => ({
      x: PADDING.left + i * xScale,
      y: PADDING.top + INNER_HEIGHT - ((p.y - minY) / yRange) * INNER_HEIGHT,
      originalY: p.y,
      index: i,
    }))
  }, [points, minY, maxY])

  // Create path
  const curvePath = useMemo(() => createSmoothPath(scaledPoints), [scaledPoints])

  // Create gradient fill area
  const gradientAreaPath = useMemo(() => {
    if (scaledPoints.length < 2) return ''
    const zeroY = PADDING.top + INNER_HEIGHT - ((0 - minY) / (maxY - minY || 1)) * INNER_HEIGHT
    return `${curvePath} L ${scaledPoints[scaledPoints.length - 1].x} ${zeroY} L ${scaledPoints[0].x} ${zeroY} Z`
  }, [curvePath, scaledPoints, minY, maxY])

  // Zero line Y position
  const zeroY = PADDING.top + INNER_HEIGHT - ((0 - minY) / (maxY - minY || 1)) * INNER_HEIGHT

  // Format currency
  const formatCurrency = (value: number) => {
    const sign = value >= 0 ? '+' : ''
    return `${sign}$${value.toFixed(2)}`
  }

  // Calculate ROI percentage
  const roiPercent = ((finalPnL / bankroll) * 100).toFixed(1)

  if (trades.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        No trades to display
      </div>
    )
  }

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        className="w-full h-auto"
        style={{ maxHeight: '220px' }}
      >
        <defs>
          {/* Profit gradient (green) */}
          <linearGradient id="profitGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0.05" />
          </linearGradient>

          {/* Loss gradient (red) */}
          <linearGradient id="lossGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#ef4444" stopOpacity="0.05" />
            <stop offset="100%" stopColor="#ef4444" stopOpacity="0.3" />
          </linearGradient>

          {/* Clip paths for profit/loss regions */}
          <clipPath id="profitRegion">
            <rect x="0" y="0" width={CHART_WIDTH} height={zeroY} />
          </clipPath>
          <clipPath id="lossRegion">
            <rect x="0" y={zeroY} width={CHART_WIDTH} height={CHART_HEIGHT - zeroY} />
          </clipPath>
        </defs>

        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
          const y = PADDING.top + INNER_HEIGHT * fraction
          return (
            <line
              key={fraction}
              x1={PADDING.left}
              y1={y}
              x2={CHART_WIDTH - PADDING.right}
              y2={y}
              stroke="#333"
              strokeWidth="1"
              strokeDasharray="2 2"
              opacity="0.3"
            />
          )
        })}

        {/* Zero line */}
        <line
          x1={PADDING.left}
          y1={zeroY}
          x2={CHART_WIDTH - PADDING.right}
          y2={zeroY}
          stroke="#666"
          strokeWidth="1.5"
          strokeDasharray="4 4"
          opacity="0.6"
        />

        {/* Gradient fills */}
        <path
          d={gradientAreaPath}
          fill="url(#profitGradient)"
          clipPath="url(#profitRegion)"
        />
        <path
          d={gradientAreaPath}
          fill="url(#lossGradient)"
          clipPath="url(#lossRegion)"
        />

        {/* ROI curve line */}
        <path
          d={curvePath}
          fill="none"
          stroke={finalPnL >= 0 ? '#10b981' : '#ef4444'}
          strokeWidth="2"
          strokeLinecap="round"
        />

        {/* Max drawdown indicator */}
        {maxDrawdownPoint && (() => {
          const scaledPoint = scaledPoints[maxDrawdownPoint.index]
          if (scaledPoint) {
            return (
              <g>
                <circle
                  cx={scaledPoint.x}
                  cy={scaledPoint.y}
                  r="4"
                  fill="#ef4444"
                  opacity="0.8"
                />
                <circle
                  cx={scaledPoint.x}
                  cy={scaledPoint.y}
                  r="6"
                  fill="none"
                  stroke="#ef4444"
                  strokeWidth="1"
                  opacity="0.5"
                />
              </g>
            )
          }
          return null
        })()}

        {/* Final value indicator */}
        {scaledPoints.length > 0 && (() => {
          const lastPoint = scaledPoints[scaledPoints.length - 1]
          return (
            <g>
              <circle
                cx={lastPoint.x}
                cy={lastPoint.y}
                r="4"
                fill={finalPnL >= 0 ? '#10b981' : '#ef4444'}
              />
            </g>
          )
        })()}

        {/* Y-axis labels */}
        <text
          x={PADDING.left - 8}
          y={PADDING.top}
          textAnchor="end"
          className="fill-gray-500 text-[10px]"
        >
          {formatCurrency(maxY)}
        </text>
        <text
          x={PADDING.left - 8}
          y={zeroY + 3}
          textAnchor="end"
          className="fill-gray-400 text-[10px]"
        >
          $0
        </text>
        <text
          x={PADDING.left - 8}
          y={PADDING.top + INNER_HEIGHT}
          textAnchor="end"
          className="fill-gray-500 text-[10px]"
        >
          {formatCurrency(minY)}
        </text>

        {/* X-axis labels */}
        <text
          x={PADDING.left}
          y={CHART_HEIGHT - PADDING.bottom + 20}
          textAnchor="start"
          className="fill-gray-500 text-[10px]"
        >
          Trade 1
        </text>
        <text
          x={CHART_WIDTH - PADDING.right}
          y={CHART_HEIGHT - PADDING.bottom + 20}
          textAnchor="end"
          className="fill-gray-500 text-[10px]"
        >
          Trade {trades.length}
        </text>
      </svg>

      {/* Summary stats */}
      <div className="flex items-center justify-center gap-6 mt-3 text-xs">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${finalPnL >= 0 ? 'bg-green-500' : 'bg-red-500'}`} />
          <span className="text-gray-400">Final P&L</span>
          <span className={`font-medium ${finalPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {formatCurrency(finalPnL)}
          </span>
          <span className="text-gray-500">({roiPercent}%)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-gray-400">Trades</span>
          <span className="text-white font-medium">{trades.length}</span>
        </div>
      </div>
    </div>
  )
}

export function ROICurveSkeleton() {
  return (
    <div className="w-full animate-pulse">
      <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} className="w-full h-auto" style={{ maxHeight: '220px' }}>
        {/* Grid lines */}
        {[0.25, 0.5, 0.75].map((fraction) => {
          const y = PADDING.top + INNER_HEIGHT * fraction
          return (
            <line
              key={fraction}
              x1={PADDING.left}
              y1={y}
              x2={CHART_WIDTH - PADDING.right}
              y2={y}
              stroke="rgb(55, 65, 81)"
              strokeWidth="1"
              strokeDasharray="2 2"
              opacity="0.3"
            />
          )
        })}
        {/* Placeholder curve */}
        <path
          d={`M ${PADDING.left} ${PADDING.top + INNER_HEIGHT * 0.8} Q ${CHART_WIDTH * 0.5} ${PADDING.top + INNER_HEIGHT * 0.3} ${CHART_WIDTH - PADDING.right} ${PADDING.top + INNER_HEIGHT * 0.5}`}
          fill="none"
          stroke="rgb(55, 65, 81)"
          strokeWidth="2"
          opacity="0.4"
        />
      </svg>
      <div className="flex items-center justify-center gap-6 mt-3">
        <div className="h-4 w-32 bg-gray-700 rounded" />
      </div>
    </div>
  )
}
