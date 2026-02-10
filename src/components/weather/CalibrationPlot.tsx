// Calibration plot showing model predictions vs actual accuracy
// Custom SVG scatter plot with perfect calibration line (y=x)

interface CalibrationData {
  bucket: string // "0-20%"
  predictedProbMidpoint: number // 10 for 0-20%
  actualAccuracy: number // 0.968 for 96.8%
  marketCount: number // 618
}

interface CalibrationPlotProps {
  data: CalibrationData[]
}

export function CalibrationPlot({ data }: CalibrationPlotProps) {
  const width = 400
  const height = 300
  const padding = { top: 20, right: 20, bottom: 40, left: 50 }

  const xScale = (prob: number) =>
    padding.left + ((prob / 100) * (width - padding.left - padding.right))

  const yScale = (accuracy: number) =>
    height - padding.bottom - ((accuracy / 100) * (height - padding.top - padding.bottom))

  return (
    <div className="bg-black/40 border border-gray-700/50 rounded-xl p-6">
      <h3 className="text-lg font-semibold mb-4">Model Calibration</h3>

      <svg width={width} height={height} className="overflow-visible">
        {/* Perfect calibration line (y=x) */}
        <line
          x1={xScale(0)}
          y1={yScale(0)}
          x2={xScale(100)}
          y2={yScale(100)}
          stroke="rgb(75, 85, 99)"
          strokeWidth={2}
          strokeDasharray="5,5"
        />

        {/* Axes */}
        <line
          x1={padding.left}
          y1={height - padding.bottom}
          x2={width - padding.right}
          y2={height - padding.bottom}
          stroke="rgb(75, 85, 99)"
          strokeWidth={1}
        />
        <line
          x1={padding.left}
          y1={padding.top}
          x2={padding.left}
          y2={height - padding.bottom}
          stroke="rgb(75, 85, 99)"
          strokeWidth={1}
        />

        {/* X-axis ticks and labels */}
        {[0, 25, 50, 75, 100].map((tick) => (
          <g key={`x-${tick}`}>
            <line
              x1={xScale(tick)}
              y1={height - padding.bottom}
              x2={xScale(tick)}
              y2={height - padding.bottom + 5}
              stroke="rgb(75, 85, 99)"
              strokeWidth={1}
            />
            <text
              x={xScale(tick)}
              y={height - padding.bottom + 18}
              textAnchor="middle"
              fill="rgb(156, 163, 175)"
              fontSize={10}
            >
              {tick}
            </text>
          </g>
        ))}

        {/* Y-axis ticks and labels */}
        {[0, 25, 50, 75, 100].map((tick) => (
          <g key={`y-${tick}`}>
            <line
              x1={padding.left - 5}
              y1={yScale(tick)}
              x2={padding.left}
              y2={yScale(tick)}
              stroke="rgb(75, 85, 99)"
              strokeWidth={1}
            />
            <text
              x={padding.left - 10}
              y={yScale(tick)}
              textAnchor="end"
              fill="rgb(156, 163, 175)"
              fontSize={10}
              dominantBaseline="middle"
            >
              {tick}
            </text>
          </g>
        ))}

        {/* Data points */}
        {data.map((point, i) => {
          const cx = xScale(point.predictedProbMidpoint)
          const cy = yScale(point.actualAccuracy * 100)
          const radius = Math.max(4, Math.min(12, Math.sqrt(point.marketCount) / 3))

          // Color based on accuracy
          const color = point.actualAccuracy > 0.80
            ? 'rgb(74, 222, 128)' // green-400
            : point.actualAccuracy > 0.60
            ? 'rgb(250, 204, 21)' // yellow-400
            : 'rgb(248, 113, 113)' // red-400

          return (
            <g key={i}>
              <circle
                cx={cx}
                cy={cy}
                r={radius}
                fill={color}
                opacity={0.7}
                className="hover:opacity-100 transition-opacity cursor-pointer"
              >
                <title>
                  {point.bucket} predicted: {point.marketCount} markets, {(point.actualAccuracy * 100).toFixed(1)}% accurate
                </title>
              </circle>
            </g>
          )
        })}

        {/* X-axis label */}
        <text
          x={width / 2}
          y={height - 5}
          textAnchor="middle"
          fill="rgb(156, 163, 175)"
          fontSize={12}
        >
          Predicted Probability (%)
        </text>

        {/* Y-axis label */}
        <text
          x={-height / 2}
          y={15}
          textAnchor="middle"
          fill="rgb(156, 163, 175)"
          fontSize={12}
          transform={`rotate(-90)`}
        >
          Actual Accuracy (%)
        </text>

        {/* Legend */}
        <g transform={`translate(${width - 100}, ${padding.top})`}>
          <text fill="rgb(156, 163, 175)" fontSize={9} dy={10}>
            Point size = sample size
          </text>
        </g>
      </svg>

      <div className="mt-3 text-xs text-gray-400">
        Perfect calibration would align points with dashed line
      </div>
    </div>
  )
}
