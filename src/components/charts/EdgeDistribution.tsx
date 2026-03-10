// Edge Distribution - bar chart showing win rate by edge bucket
// Custom SVG bar chart following SolarCurve pattern

import { useMemo } from 'react'
import type { BacktestResult } from '@/types/weather'

interface EdgeDistributionProps {
  trades: BacktestResult[]
}

interface EdgeBucket {
  label: string
  trades: number
  winRate: number
  min: number
  max: number
}

// Chart dimensions
const CHART_WIDTH = 400
const CHART_HEIGHT = 220
const PADDING = { top: 30, right: 30, bottom: 50, left: 50 }
const INNER_WIDTH = CHART_WIDTH - PADDING.left - PADDING.right
const INNER_HEIGHT = CHART_HEIGHT - PADDING.top - PADDING.bottom

export default function EdgeDistribution({ trades }: EdgeDistributionProps) {
  // Analyze edge distribution
  const buckets = useMemo((): EdgeBucket[] => {
    const bucketDefs = [
      { min: 0.15, max: 0.20, label: '15-20%' },
      { min: 0.20, max: 0.25, label: '20-25%' },
      { min: 0.25, max: 0.30, label: '25-30%' },
      { min: 0.30, max: 1.00, label: '30%+' },
    ]

    return bucketDefs.map(bucket => {
      const bucketTrades = trades.filter(t => t.edge >= bucket.min && t.edge < bucket.max)
      const wins = bucketTrades.filter(t => t.outcome).length
      const winRate = bucketTrades.length > 0 ? wins / bucketTrades.length : 0

      return {
        label: bucket.label,
        trades: bucketTrades.length,
        winRate,
        min: bucket.min,
        max: bucket.max,
      }
    })
  }, [trades])

  // Calculate max values for scaling
  const maxTrades = Math.max(...buckets.map(b => b.trades), 1)

  // Bar width and spacing
  const barWidth = INNER_WIDTH / (buckets.length * 2)
  const barSpacing = barWidth

  if (trades.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        No edge data to display
      </div>
    )
  }

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        className="w-full h-auto"
        style={{ maxHeight: '240px' }}
      >
        <defs>
          {/* Bar gradient */}
          <linearGradient id="barGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.4" />
          </linearGradient>

          {/* Win rate overlay gradient */}
          <linearGradient id="winRateGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0.6" />
          </linearGradient>
        </defs>

        {/* Y-axis grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
          const y = PADDING.top + INNER_HEIGHT * (1 - fraction)
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

        {/* X and Y axes */}
        <line
          x1={PADDING.left}
          y1={PADDING.top + INNER_HEIGHT}
          x2={CHART_WIDTH - PADDING.right}
          y2={PADDING.top + INNER_HEIGHT}
          stroke="#666"
          strokeWidth="1.5"
        />
        <line
          x1={PADDING.left}
          y1={PADDING.top}
          x2={PADDING.left}
          y2={PADDING.top + INNER_HEIGHT}
          stroke="#666"
          strokeWidth="1.5"
        />

        {/* Bars */}
        {buckets.map((bucket, i) => {
          const x = PADDING.left + i * (barWidth + barSpacing) + barSpacing / 2

          // Trade count bar (blue)
          const tradeBarHeight = (bucket.trades / maxTrades) * INNER_HEIGHT
          const tradeBarY = PADDING.top + INNER_HEIGHT - tradeBarHeight

          // Win rate overlay (green)
          const winRateHeight = tradeBarHeight * bucket.winRate
          const winRateY = PADDING.top + INNER_HEIGHT - winRateHeight

          return (
            <g key={bucket.label}>
              {/* Trade count bar */}
              <rect
                x={x}
                y={tradeBarY}
                width={barWidth}
                height={tradeBarHeight}
                fill="url(#barGradient)"
                stroke="#3b82f6"
                strokeWidth="1"
                opacity="0.7"
              />

              {/* Win rate overlay */}
              <rect
                x={x}
                y={winRateY}
                width={barWidth}
                height={winRateHeight}
                fill="url(#winRateGradient)"
                opacity="0.8"
              />

              {/* Trade count label */}
              {bucket.trades > 0 && (
                <text
                  x={x + barWidth / 2}
                  y={tradeBarY - 6}
                  textAnchor="middle"
                  className="fill-gray-400 text-[10px] font-medium"
                >
                  {bucket.trades}
                </text>
              )}

              {/* Win rate label */}
              {bucket.trades > 0 && bucket.winRate > 0 && (
                <text
                  x={x + barWidth / 2}
                  y={winRateY + winRateHeight / 2 + 3}
                  textAnchor="middle"
                  className="fill-white text-[10px] font-medium"
                  opacity={winRateHeight > 20 ? 1 : 0}
                >
                  {(bucket.winRate * 100).toFixed(0)}%
                </text>
              )}

              {/* X-axis label */}
              <text
                x={x + barWidth / 2}
                y={PADDING.top + INNER_HEIGHT + 16}
                textAnchor="middle"
                className="fill-gray-500 text-[10px]"
              >
                {bucket.label}
              </text>
            </g>
          )
        })}

        {/* Y-axis labels (win rate) */}
        <text
          x={PADDING.left - 8}
          y={PADDING.top + 3}
          textAnchor="end"
          className="fill-gray-500 text-[10px]"
        >
          100%
        </text>
        <text
          x={PADDING.left - 8}
          y={PADDING.top + INNER_HEIGHT / 2 + 3}
          textAnchor="end"
          className="fill-gray-500 text-[10px]"
        >
          50%
        </text>
        <text
          x={PADDING.left - 8}
          y={PADDING.top + INNER_HEIGHT}
          textAnchor="end"
          className="fill-gray-500 text-[10px]"
        >
          0%
        </text>

        {/* Axis titles */}
        <text
          x={CHART_WIDTH / 2}
          y={CHART_HEIGHT - PADDING.bottom + 35}
          textAnchor="middle"
          className="fill-gray-400 text-[11px] font-medium"
        >
          Edge Bucket
        </text>
        <text
          x={PADDING.left - 35}
          y={CHART_HEIGHT / 2}
          textAnchor="middle"
          className="fill-gray-400 text-[11px] font-medium"
          transform={`rotate(-90, ${PADDING.left - 35}, ${CHART_HEIGHT / 2})`}
        >
          Win Rate
        </text>
      </svg>

      {/* Legend */}
      <div className="flex items-center justify-center gap-4 mt-3 text-xs">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 bg-blue-500 opacity-70" />
          <span className="text-gray-400">Total Trades</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 bg-green-500 opacity-80" />
          <span className="text-gray-400">Win Rate</span>
        </div>
      </div>
    </div>
  )
}

export function EdgeDistributionSkeleton() {
  return (
    <div className="w-full animate-pulse">
      <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} className="w-full h-auto" style={{ maxHeight: '240px' }}>
        {/* Axes */}
        <line
          x1={PADDING.left}
          y1={PADDING.top + INNER_HEIGHT}
          x2={CHART_WIDTH - PADDING.right}
          y2={PADDING.top + INNER_HEIGHT}
          stroke="rgb(55, 65, 81)"
          strokeWidth="1.5"
        />
        <line
          x1={PADDING.left}
          y1={PADDING.top}
          x2={PADDING.left}
          y2={PADDING.top + INNER_HEIGHT}
          stroke="rgb(55, 65, 81)"
          strokeWidth="1.5"
        />
        {/* Placeholder bars */}
        {[0.6, 0.8, 0.5, 0.35].map((frac, i) => {
          const barWidth = INNER_WIDTH / 8
          const x = PADDING.left + i * (barWidth + barWidth) + barWidth / 2
          const height = INNER_HEIGHT * frac
          return (
            <rect
              key={i}
              x={x}
              y={PADDING.top + INNER_HEIGHT - height}
              width={barWidth}
              height={height}
              fill="rgb(55, 65, 81)"
              opacity="0.4"
            />
          )
        })}
      </svg>
      <div className="flex items-center justify-center gap-4 mt-3">
        <div className="h-4 w-24 bg-gray-700 rounded" />
      </div>
    </div>
  )
}
