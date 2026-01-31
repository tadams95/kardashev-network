// Compact sparkline visualization for hourly solar forecast

interface HourlyData {
  time: string
  ghi: number
}

interface ForecastSparklineProps {
  hourly: HourlyData[]
  maxHours?: number
}

export default function ForecastSparkline({ hourly, maxHours = 12 }: ForecastSparklineProps) {
  const data = hourly.slice(0, maxHours)
  const maxGhi = Math.max(...data.map(h => h.ghi), 100)
  const currentHour = new Date().getHours()

  return (
    <div className="w-full">
      {/* Chart */}
      <div className="flex items-end gap-1 h-16">
        {data.map((hour, idx) => {
          const height = Math.max((hour.ghi / maxGhi) * 100, 4)
          const isNow = idx === 0
          const hasSun = hour.ghi > 0

          return (
            <div
              key={hour.time}
              className="flex-1 flex flex-col items-center group relative"
            >
              {/* Tooltip */}
              <div className="absolute -top-10 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                <div className="bg-gray-900 border border-gray-700 rounded-lg px-2 py-1 text-xs whitespace-nowrap shadow-lg">
                  <span className="text-white font-medium">{Math.round(hour.ghi)}</span>
                  <span className="text-gray-400"> W/m²</span>
                </div>
              </div>

              {/* Bar */}
              <div
                className={`w-full rounded-t transition-all duration-300 ${
                  isNow
                    ? 'bg-gradient-to-t from-green-600 to-green-400'
                    : hasSun
                      ? 'bg-gradient-to-t from-yellow-600/60 to-yellow-400/80 group-hover:from-yellow-600 group-hover:to-yellow-400'
                      : 'bg-gray-700/50 group-hover:bg-gray-600/50'
                }`}
                style={{ height: `${height}%` }}
              />
            </div>
          )
        })}
      </div>

      {/* Time labels */}
      <div className="flex gap-1 mt-2">
        {data.map((hour, idx) => {
          const time = new Date(hour.time)
          const isNow = idx === 0
          const showLabel = idx === 0 || idx === Math.floor(data.length / 2) || idx === data.length - 1

          return (
            <div key={hour.time} className="flex-1 text-center">
              {showLabel && (
                <span className={`text-[10px] ${isNow ? 'text-green-400 font-medium' : 'text-gray-500'}`}>
                  {isNow ? 'Now' : time.toLocaleTimeString([], { hour: 'numeric' })}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function ForecastSparklineSkeleton() {
  return (
    <div className="w-full animate-pulse">
      <div className="flex items-end gap-1 h-16">
        {Array.from({ length: 12 }).map((_, idx) => (
          <div
            key={idx}
            className="flex-1 bg-gray-700/50 rounded-t"
            style={{ height: `${20 + Math.random() * 60}%` }}
          />
        ))}
      </div>
      <div className="flex gap-1 mt-2">
        <div className="flex-1 text-center">
          <div className="h-3 w-8 bg-gray-700 rounded mx-auto" />
        </div>
        <div className="flex-1" />
        <div className="flex-1" />
        <div className="flex-1" />
        <div className="flex-1" />
        <div className="flex-1 text-center">
          <div className="h-3 w-8 bg-gray-700 rounded mx-auto" />
        </div>
        <div className="flex-1" />
        <div className="flex-1" />
        <div className="flex-1" />
        <div className="flex-1" />
        <div className="flex-1" />
        <div className="flex-1 text-center">
          <div className="h-3 w-8 bg-gray-700 rounded mx-auto" />
        </div>
      </div>
    </div>
  )
}
