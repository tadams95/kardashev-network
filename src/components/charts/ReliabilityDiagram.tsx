// Reliability Diagram - predicted vs actual probability calibration curve
// Custom SVG chart following ROICurve/EdgeDistribution pattern

import { useMemo } from 'react'
import { createSmoothPath } from '@/lib/utils/svgChartUtils'

interface ReliabilityDiagramProps {
  bins: Array<{ binCenter: number; avgPredicted: number; avgActual: number; count: number }>
  sampleSize?: number
}

// Chart dimensions (CHART_HEIGHT=220 matches EdgeDistribution)
const CHART_WIDTH = 400
const CHART_HEIGHT = 220
const PADDING = { top: 30, right: 30, bottom: 40, left: 50 }
const INNER_WIDTH = CHART_WIDTH - PADDING.left - PADDING.right
const INNER_HEIGHT = CHART_HEIGHT - PADDING.top - PADDING.bottom

export default function ReliabilityDiagram({ bins, sampleSize }: ReliabilityDiagramProps) {
  // Scale points to chart coordinates (both axes 0..1)
  const scaledPoints = useMemo(() => {
    return bins.map(b => ({
      x: PADDING.left + b.avgPredicted * INNER_WIDTH,
      y: PADDING.top + INNER_HEIGHT - b.avgActual * INNER_HEIGHT,
      count: b.count,
    }))
  }, [bins])

  // Create model curve path — fall back to polyline with < 6 non-empty bins
  const curvePath = useMemo(() => {
    const nonEmpty = scaledPoints.filter((_, i) => bins[i].count > 0)
    if (nonEmpty.length < 2) return ''
    return nonEmpty.length >= 6
      ? createSmoothPath(nonEmpty)
      : nonEmpty.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
  }, [scaledPoints, bins])

  // Perfect calibration diagonal coords
  const diagStart = { x: PADDING.left, y: PADDING.top + INNER_HEIGHT }
  const diagEnd = { x: PADDING.left + INNER_WIDTH, y: PADDING.top }

  // Shaded gap area between model curve and diagonal
  const gapAreaPath = useMemo(() => {
    const nonEmpty = scaledPoints.filter((_, i) => bins[i].count > 0)
    if (nonEmpty.length < 2) return ''

    // Model curve forward
    const forward = nonEmpty.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')

    // Diagonal backward (same x coords, y on the diagonal)
    const backward = [...nonEmpty]
      .reverse()
      .map((p, i) => {
        // For a given x, diagonal y = PADDING.top + INNER_HEIGHT - ((x - PADDING.left) / INNER_WIDTH) * INNER_HEIGHT
        const frac = (p.x - PADDING.left) / INNER_WIDTH
        const diagY = PADDING.top + INNER_HEIGHT - frac * INNER_HEIGHT
        return `${i === 0 ? 'L' : 'L'} ${p.x} ${diagY}`
      })
      .join(' ')

    return `${forward} ${backward} Z`
  }, [scaledPoints, bins])

  if (bins.every(b => b.count === 0)) {
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
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
          const y = PADDING.top + INNER_HEIGHT * (1 - fraction)
          return (
            <line
              key={`h-${fraction}`}
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
        {[0.25, 0.5, 0.75].map((fraction) => {
          const x = PADDING.left + INNER_WIDTH * fraction
          return (
            <line
              key={`v-${fraction}`}
              x1={x}
              y1={PADDING.top}
              x2={x}
              y2={PADDING.top + INNER_HEIGHT}
              stroke="#333"
              strokeWidth="1"
              strokeDasharray="2 2"
              opacity="0.3"
            />
          )
        })}

        {/* Perfect calibration diagonal */}
        <line
          x1={diagStart.x}
          y1={diagStart.y}
          x2={diagEnd.x}
          y2={diagEnd.y}
          stroke="#666"
          strokeWidth="1.5"
          strokeDasharray="6 4"
        />

        {/* Shaded gap between model and diagonal */}
        {gapAreaPath && (
          <path
            d={gapAreaPath}
            fill="#38bdf8"
            opacity="0.15"
          />
        )}

        {/* Model curve */}
        {curvePath && (
          <path
            d={curvePath}
            fill="none"
            stroke="#38bdf8"
            strokeWidth="2"
            strokeLinecap="round"
          />
        )}

        {/* Data points + bin count labels */}
        {scaledPoints.map((p, i) => {
          if (bins[i].count === 0) return null
          return (
            <g key={i}>
              <circle
                cx={p.x}
                cy={p.y}
                r="3.5"
                fill="#38bdf8"
              />
              <text
                x={p.x}
                y={p.y - 8}
                textAnchor="middle"
                className="fill-gray-400"
                style={{ fontSize: '8px' }}
              >
                n={p.count}
              </text>
            </g>
          )
        })}

        {/* Y-axis labels */}
        {[0, 0.5, 1].map(v => (
          <text
            key={v}
            x={PADDING.left - 8}
            y={PADDING.top + INNER_HEIGHT * (1 - v) + 3}
            textAnchor="end"
            className="fill-gray-500 text-[10px]"
          >
            {v.toFixed(1)}
          </text>
        ))}

        {/* X-axis labels */}
        {[0, 0.5, 1].map(v => (
          <text
            key={v}
            x={PADDING.left + INNER_WIDTH * v}
            y={CHART_HEIGHT - PADDING.bottom + 16}
            textAnchor="middle"
            className="fill-gray-500 text-[10px]"
          >
            {v.toFixed(1)}
          </text>
        ))}

        {/* Axis titles */}
        <text
          x={CHART_WIDTH / 2}
          y={CHART_HEIGHT - 2}
          textAnchor="middle"
          className="fill-gray-400 text-[11px] font-medium"
        >
          Predicted
        </text>
        <text
          x={PADDING.left - 35}
          y={CHART_HEIGHT / 2}
          textAnchor="middle"
          className="fill-gray-400 text-[11px] font-medium"
          transform={`rotate(-90, ${PADDING.left - 35}, ${CHART_HEIGHT / 2})`}
        >
          Actual
        </text>
      </svg>

      {/* Summary */}
      <div className="flex items-center justify-center gap-4 mt-3 text-xs">
        <div className="flex items-center gap-2">
          <div className="w-3 h-0.5 bg-gray-500" style={{ borderTop: '1.5px dashed #666' }} />
          <span className="text-gray-400">Perfect</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-0.5 bg-sky-400" />
          <span className="text-gray-400">Model</span>
        </div>
        {sampleSize != null && (
          <span className="text-gray-500">{sampleSize} predictions</span>
        )}
      </div>
    </div>
  )
}

export function ReliabilityDiagramSkeleton() {
  return (
    <div className="w-full animate-pulse">
      <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} className="w-full h-auto" style={{ maxHeight: '240px' }}>
        {/* Grid */}
        {[0.25, 0.5, 0.75].map((fraction) => {
          const y = PADDING.top + INNER_HEIGHT * (1 - fraction)
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
        {/* Diagonal placeholder */}
        <line
          x1={PADDING.left}
          y1={PADDING.top + INNER_HEIGHT}
          x2={PADDING.left + INNER_WIDTH}
          y2={PADDING.top}
          stroke="rgb(55, 65, 81)"
          strokeWidth="1.5"
          strokeDasharray="6 4"
          opacity="0.4"
        />
      </svg>
      <div className="flex items-center justify-center gap-4 mt-3">
        <div className="h-4 w-32 bg-gray-700 rounded" />
      </div>
    </div>
  )
}
