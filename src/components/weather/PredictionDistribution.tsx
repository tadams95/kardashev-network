// Bar chart showing distribution of predictions across probability buckets
// Custom SVG with gradient colors and hover tooltips

interface DistributionData {
  bucket: string // "0-20%"
  count: number // 618
  accuracy: number // 0.968
}

interface PredictionDistributionProps {
  data: DistributionData[]
}

export function PredictionDistribution({ data }: PredictionDistributionProps) {
  const width = 400
  const height = 250
  const padding = { top: 20, right: 20, bottom: 40, left: 50 }

  const maxCount = Math.max(...data.map(d => d.count))
  const barWidth = (width - padding.left - padding.right) / data.length - 10

  const xScale = (index: number) =>
    padding.left + index * ((width - padding.left - padding.right) / data.length) + 5

  const yScale = (count: number) =>
    height - padding.bottom - ((count / maxCount) * (height - padding.top - padding.bottom))

  return (
    <div className="bg-black/40 border border-gray-700/50 rounded-xl p-6">
      <h3 className="text-lg font-semibold mb-4">Prediction Distribution</h3>

      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto">
        {/* Bars */}
        {data.map((item, i) => {
          const x = xScale(i)
          const y = yScale(item.count)
          const barHeight = height - padding.bottom - y

          // Gradient color based on probability bucket
          const colorIntensity = ((i + 1) / data.length) * 100
          const hue = colorIntensity < 50 ? 0 : 120
          const lightness = 40 + colorIntensity * 0.3
          const color = `hsl(${hue}, 60%, ${lightness}%)`

          return (
            <g key={i}>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={barHeight}
                fill={color}
                opacity={0.8}
                className="hover:opacity-100 transition-opacity"
              >
                <title>
                  {item.bucket}: {item.count} markets ({(item.accuracy * 100).toFixed(1)}% accurate)
                </title>
              </rect>

              {/* Count label on bar */}
              <text
                x={x + barWidth / 2}
                y={y - 5}
                textAnchor="middle"
                fill="rgb(156, 163, 175)"
                fontSize={11}
                fontWeight="bold"
              >
                {item.count}
              </text>

              {/* X-axis label */}
              <text
                x={x + barWidth / 2}
                y={height - padding.bottom + 15}
                textAnchor="middle"
                fill="rgb(156, 163, 175)"
                fontSize={10}
              >
                {item.bucket}
              </text>
            </g>
          )
        })}

        {/* Y-axis */}
        <line
          x1={padding.left}
          y1={padding.top}
          x2={padding.left}
          y2={height - padding.bottom}
          stroke="rgb(75, 85, 99)"
          strokeWidth={1}
        />

        {/* Y-axis ticks and labels */}
        {[0, Math.floor(maxCount / 4), Math.floor(maxCount / 2), Math.floor(maxCount * 3 / 4), maxCount].map((tick) => (
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

        {/* Y-axis label */}
        <text
          x={-height / 2}
          y={15}
          textAnchor="middle"
          fill="rgb(156, 163, 175)"
          fontSize={12}
          transform={`rotate(-90)`}
        >
          Number of Markets
        </text>
      </svg>

      <div className="mt-3 text-xs text-gray-400">
        Most predictions in 0-40% range (804/976 markets)
      </div>
    </div>
  )
}
