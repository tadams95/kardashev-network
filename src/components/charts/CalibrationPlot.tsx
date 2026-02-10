// Calibration Plot - scatter plot showing model predictions vs actual outcomes
// Custom SVG scatter plot following SolarCurve pattern

import { useMemo } from 'react'
import type { BacktestResult } from '@/types/weather'

interface CalibrationPlotProps {
  trades: BacktestResult[]
}

interface CalibrationBin {
  predictedProb: number
  actualRate: number
  count: number
  label: string
}

// Chart dimensions
const CHART_WIDTH = 400
const CHART_HEIGHT = 220
const PADDING = { top: 30, right: 30, bottom: 50, left: 50 }
const INNER_WIDTH = CHART_WIDTH - PADDING.left - PADDING.right
const INNER_HEIGHT = CHART_HEIGHT - PADDING.top - PADDING.bottom

export default function CalibrationPlot({ trades }: CalibrationPlotProps) {
  // Bin predictions and calculate calibration
  const calibrationData = useMemo((): CalibrationBin[] => {
    // Create 10 bins from 0% to 100%
    const bins = Array.from({ length: 10 }, (_, i) => {
      const min = i * 0.1
      const max = (i + 1) * 0.1
      const binTrades = trades.filter(t =>
        t.modelProbability >= min && t.modelProbability < max
      )

      const wins = binTrades.filter(t => t.outcome).length
      const actualRate = binTrades.length > 0 ? wins / binTrades.length : 0

      return {
        predictedProb: (min + max) / 2,
        actualRate,
        count: binTrades.length,
        label: `${Math.round(min * 100)}-${Math.round(max * 100)}%`,
      }
    })

    return bins.filter(b => b.count > 0) // Only show bins with data
  }, [trades])

  // Calculate Brier score
  const brierScore = useMemo(() => {
    if (trades.length === 0) return 0
    const squaredErrors = trades.map(t => {
      const predicted = t.modelProbability
      const actual = t.outcome ? 1 : 0
      return Math.pow(predicted - actual, 2)
    })
    return squaredErrors.reduce((sum, e) => sum + e, 0) / squaredErrors.length
  }, [trades])

  // Scale functions
  const scaleX = (prob: number) => PADDING.left + prob * INNER_WIDTH
  const scaleY = (rate: number) => PADDING.top + INNER_HEIGHT - rate * INNER_HEIGHT

  if (trades.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        No calibration data to display
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
          {/* Point gradient */}
          <radialGradient id="pointGradient">
            <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.5" />
          </radialGradient>

          {/* Glow filter for points */}
          <filter id="pointGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
          const y = PADDING.top + INNER_HEIGHT * (1 - fraction)
          const x = PADDING.left + INNER_WIDTH * fraction
          return (
            <g key={fraction}>
              {/* Horizontal grid */}
              <line
                x1={PADDING.left}
                y1={y}
                x2={CHART_WIDTH - PADDING.right}
                y2={y}
                stroke="#333"
                strokeWidth="1"
                strokeDasharray="2 2"
                opacity="0.3"
              />
              {/* Vertical grid */}
              <line
                x1={x}
                y1={PADDING.top}
                x2={x}
                y2={PADDING.top + INNER_HEIGHT}
                stroke="#333"
                strokeWidth="1"
                strokeDasharray="2 2"
                opacity="0.3"
              />
            </g>
          )
        })}

        {/* Perfect calibration line (diagonal) */}
        <line
          x1={PADDING.left}
          y1={PADDING.top + INNER_HEIGHT}
          x2={CHART_WIDTH - PADDING.right}
          y2={PADDING.top}
          stroke="#10b981"
          strokeWidth="1.5"
          strokeDasharray="4 4"
          opacity="0.5"
        />

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

        {/* Data points */}
        {calibrationData.map((bin, i) => {
          const x = scaleX(bin.predictedProb)
          const y = scaleY(bin.actualRate)

          // Size based on count (more trades = bigger point)
          const maxCount = Math.max(...calibrationData.map(b => b.count))
          const pointSize = 4 + (bin.count / maxCount) * 6

          return (
            <g key={i} filter="url(#pointGlow)">
              <circle
                cx={x}
                cy={y}
                r={pointSize}
                fill="url(#pointGradient)"
                stroke="#8b5cf6"
                strokeWidth="1.5"
                opacity="0.9"
              />
              {/* Count label */}
              {bin.count > 5 && (
                <text
                  x={x}
                  y={y - pointSize - 6}
                  textAnchor="middle"
                  className="fill-gray-400 text-[9px]"
                >
                  {bin.count}
                </text>
              )}
            </g>
          )
        })}

        {/* Y-axis labels */}
        {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
          const y = PADDING.top + INNER_HEIGHT * (1 - fraction)
          return (
            <text
              key={fraction}
              x={PADDING.left - 8}
              y={y + 3}
              textAnchor="end"
              className="fill-gray-500 text-[10px]"
            >
              {Math.round(fraction * 100)}%
            </text>
          )
        })}

        {/* X-axis labels */}
        {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
          const x = PADDING.left + INNER_WIDTH * fraction
          return (
            <text
              key={fraction}
              x={x}
              y={PADDING.top + INNER_HEIGHT + 16}
              textAnchor="middle"
              className="fill-gray-500 text-[10px]"
            >
              {Math.round(fraction * 100)}%
            </text>
          )
        })}

        {/* Axis titles */}
        <text
          x={CHART_WIDTH / 2}
          y={CHART_HEIGHT - PADDING.bottom + 35}
          textAnchor="middle"
          className="fill-gray-400 text-[11px] font-medium"
        >
          Predicted Probability
        </text>
        <text
          x={PADDING.left - 35}
          y={CHART_HEIGHT / 2}
          textAnchor="middle"
          className="fill-gray-400 text-[11px] font-medium"
          transform={`rotate(-90, ${PADDING.left - 35}, ${CHART_HEIGHT / 2})`}
        >
          Actual Win Rate
        </text>

        {/* Perfect calibration label */}
        <text
          x={CHART_WIDTH - PADDING.right - 40}
          y={PADDING.top + 20}
          textAnchor="end"
          className="fill-green-500 text-[9px] opacity-70"
        >
          Perfect Calibration
        </text>
      </svg>

      {/* Summary stats */}
      <div className="flex items-center justify-center gap-6 mt-3 text-xs">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-purple-500" />
          <span className="text-gray-400">Brier Score</span>
          <span className={`font-medium ${brierScore < 0.15 ? 'text-green-400' : 'text-yellow-400'}`}>
            {brierScore.toFixed(3)}
          </span>
          <span className="text-gray-500">
            {brierScore < 0.15 ? '(Good)' : '(Needs Work)'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-gray-400">Bins</span>
          <span className="text-white font-medium">{calibrationData.length}</span>
        </div>
      </div>
    </div>
  )
}

export function CalibrationPlotSkeleton() {
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
        {/* Diagonal line */}
        <line
          x1={PADDING.left}
          y1={PADDING.top + INNER_HEIGHT}
          x2={CHART_WIDTH - PADDING.right}
          y2={PADDING.top}
          stroke="rgb(55, 65, 81)"
          strokeWidth="1.5"
          strokeDasharray="4 4"
          opacity="0.5"
        />
        {/* Placeholder points */}
        {[0.2, 0.4, 0.6, 0.8].map((fraction, i) => {
          const x = PADDING.left + INNER_WIDTH * fraction
          const y = PADDING.top + INNER_HEIGHT * (1 - fraction + (Math.random() * 0.2 - 0.1))
          return (
            <circle
              key={i}
              cx={x}
              cy={y}
              r="6"
              fill="rgb(139, 92, 246)"
              opacity="0.4"
            />
          )
        })}
      </svg>
      <div className="flex items-center justify-center gap-6 mt-3">
        <div className="h-4 w-32 bg-gray-700 rounded" />
      </div>
    </div>
  )
}
