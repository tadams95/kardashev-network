// Premium forecast visualization with accurate sunrise/sunset

interface HourlyData {
  time: string
  ghi: number
}

interface ForecastSparklineProps {
  hourly: HourlyData[]
  sunrise: string  // ISO timestamp from API
  sunset: string   // ISO timestamp from API
  maxHours?: number
}

// Format time for display (e.g., "6:47 AM")
function formatTime(timeStr: string): string {
  if (!timeStr) return '--:--'
  const date = new Date(timeStr)
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

// Format hour only (e.g., "8 AM")
function formatHour(timeStr: string): string {
  const date = new Date(timeStr)
  return date.toLocaleTimeString([], { hour: 'numeric' })
}

// Get hour as number for comparison
function getHour(timeStr: string): number {
  return new Date(timeStr).getHours()
}

export default function ForecastSparkline({
  hourly,
  sunrise,
  sunset,
  maxHours = 12
}: ForecastSparklineProps) {
  const now = new Date()
  const currentHour = now.getHours()
  const sunriseHour = sunrise ? getHour(sunrise) : 6
  const sunsetHour = sunset ? getHour(sunset) : 18

  // Determine if it's currently night
  const isNight = currentHour < sunriseHour || currentHour >= sunsetHour

  // Smart data selection
  let displayData: HourlyData[]
  let showingFutureDay = false

  if (isNight && currentHour >= sunsetHour) {
    // After sunset: show tomorrow's forecast starting from sunrise
    const sunriseIndex = hourly.findIndex(h => {
      const hHour = getHour(h.time)
      const hDate = new Date(h.time).getDate()
      return hHour >= sunriseHour && hDate > now.getDate()
    })
    if (sunriseIndex !== -1) {
      displayData = hourly.slice(sunriseIndex, sunriseIndex + maxHours)
      showingFutureDay = true
    } else {
      displayData = hourly.slice(0, maxHours)
    }
  } else if (isNight) {
    // Before sunrise: show today from sunrise onwards
    const sunriseIndex = hourly.findIndex(h => getHour(h.time) >= sunriseHour)
    if (sunriseIndex !== -1) {
      displayData = hourly.slice(sunriseIndex, sunriseIndex + maxHours)
      showingFutureDay = true
    } else {
      displayData = hourly.slice(0, maxHours)
    }
  } else {
    // Daytime: show from current hour
    displayData = hourly.slice(0, maxHours)
  }

  // Calculate peak for scaling
  const peakGhi = Math.max(...displayData.map(h => h.ghi), 100)
  const peakHour = displayData.find(h => h.ghi === peakGhi)
  const allZero = displayData.every(h => h.ghi === 0)

  return (
    <div className="w-full">
      {/* Sun Times Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <div className="w-5 h-5 rounded-full bg-gradient-to-br from-yellow-400 to-orange-500 flex items-center justify-center">
              <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 17a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zm5.657-2.343a1 1 0 010 1.414l-.707.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM18 10a1 1 0 011-1h1a1 1 0 110 2h-1a1 1 0 01-1-1zm-2.343 5.657a1 1 0 011.414 0l.707.707a1 1 0 11-1.414 1.414l-.707-.707a1 1 0 010-1.414zM3 10a1 1 0 011-1h1a1 1 0 110 2H4a1 1 0 01-1-1zm2.343-5.657a1 1 0 011.414 0l.707.707a1 1 0 11-1.414 1.414l-.707-.707a1 1 0 010-1.414zM10 3a1 1 0 011 1v1a1 1 0 11-2 0V4a1 1 0 011-1z" clipRule="evenodd" />
              </svg>
            </div>
            <span className="text-sm text-gray-400">Sunrise</span>
            <span className="text-sm font-medium text-white">{formatTime(sunrise)}</span>
          </div>
          <div className="w-px h-4 bg-gray-700" />
          <div className="flex items-center gap-1.5">
            <div className="w-5 h-5 rounded-full bg-gradient-to-br from-orange-500 to-purple-600 flex items-center justify-center">
              <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
              </svg>
            </div>
            <span className="text-sm text-gray-400">Sunset</span>
            <span className="text-sm font-medium text-white">{formatTime(sunset)}</span>
          </div>
        </div>

        {isNight && (
          <span className="text-xs px-2 py-1 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
            {showingFutureDay ? 'Tomorrow' : 'Showing daylight hours'}
          </span>
        )}
      </div>

      {allZero ? (
        <div className="text-center py-8 bg-gray-800/30 rounded-xl border border-gray-700/50">
          <div className="text-4xl mb-2">🌙</div>
          <p className="text-gray-400 text-sm">No solar production forecast</p>
          <p className="text-gray-500 text-xs mt-1">
            Next sunlight at {formatTime(sunrise)}
          </p>
        </div>
      ) : (
        <>
          {/* Chart */}
          <div className="relative">
            {/* Peak indicator line */}
            <div className="absolute left-0 right-0 top-0 h-px bg-gradient-to-r from-transparent via-yellow-500/30 to-transparent" />

            <div className="flex items-end gap-0.5 h-24 px-1">
              {displayData.map((hour, idx) => {
                const percentage = hour.ghi / peakGhi
                const height = hour.ghi > 0 ? Math.max(percentage * 100, 6) : 3
                const isCurrentHour = !showingFutureDay && idx === 0
                const isPeak = hour.ghi === peakGhi && hour.ghi > 0
                const hasSun = hour.ghi > 0

                return (
                  <div
                    key={hour.time}
                    className="flex-1 flex flex-col items-center group relative"
                  >
                    {/* Tooltip */}
                    <div className="absolute -top-14 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                      <div className="bg-gray-900 border border-gray-600 rounded-lg px-2.5 py-1.5 text-xs whitespace-nowrap shadow-xl">
                        <div className="text-gray-400 font-medium">{formatHour(hour.time)}</div>
                        <div className="mt-0.5">
                          <span className="text-white font-semibold">{Math.round(hour.ghi)}</span>
                          <span className="text-gray-400 ml-1">W/m²</span>
                        </div>
                      </div>
                      <div className="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-600" />
                    </div>

                    {/* Bar */}
                    <div
                      className={`w-full rounded-t-sm transition-all duration-300 relative overflow-hidden ${
                        isCurrentHour
                          ? 'bg-gradient-to-t from-cyan-700 to-cyan-500 shadow-lg shadow-cyan-700/20'
                          : isPeak
                            ? 'bg-gradient-to-t from-yellow-500 to-yellow-300'
                            : hasSun
                              ? 'bg-gradient-to-t from-yellow-600/60 to-yellow-400/80 group-hover:from-yellow-500/70 group-hover:to-yellow-300/90'
                              : 'bg-gray-700/30'
                      }`}
                      style={{ height: `${height}%` }}
                    >
                      {/* Shimmer effect for peak */}
                      {isPeak && (
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer" />
                      )}
                    </div>

                    {/* Current hour indicator */}
                    {isCurrentHour && (
                      <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-cyan-500 animate-pulse" />
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Time labels */}
          <div className="flex gap-0.5 mt-3 px-1">
            {displayData.map((hour, idx) => {
              const isCurrentHour = !showingFutureDay && idx === 0
              // Show labels at key positions
              const labelPositions = [
                0,
                Math.floor(displayData.length / 3),
                Math.floor(displayData.length * 2 / 3),
                displayData.length - 1
              ]
              const showLabel = labelPositions.includes(idx)

              return (
                <div key={hour.time} className="flex-1 text-center">
                  {showLabel && (
                    <span className={`text-[10px] ${
                      isCurrentHour
                        ? 'text-cyan-500 font-semibold'
                        : 'text-gray-500'
                    }`}>
                      {isCurrentHour ? 'Now' : formatHour(hour.time)}
                    </span>
                  )}
                </div>
              )
            })}
          </div>

          {/* Summary footer */}
          <div className="flex items-center justify-center gap-4 mt-4 text-xs">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-yellow-400" />
              <span className="text-gray-400">Peak</span>
              <span className="text-white font-medium">{Math.round(peakGhi)} W/m²</span>
              {peakHour && (
                <span className="text-gray-500">at {formatHour(peakHour.time)}</span>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export function ForecastSparklineSkeleton() {
  return (
    <div className="w-full animate-pulse">
      {/* Header skeleton */}
      <div className="flex items-center gap-4 mb-4">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-full bg-gray-700" />
          <div className="h-4 w-20 bg-gray-700 rounded" />
        </div>
        <div className="w-px h-4 bg-gray-700" />
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-full bg-gray-700" />
          <div className="h-4 w-20 bg-gray-700 rounded" />
        </div>
      </div>

      {/* Chart skeleton */}
      <div className="flex items-end gap-0.5 h-24 px-1">
        {Array.from({ length: 12 }).map((_, idx) => (
          <div
            key={idx}
            className="flex-1 bg-gray-700/50 rounded-t-sm"
            style={{ height: `${20 + Math.sin(idx * 0.8) * 40 + 30}%` }}
          />
        ))}
      </div>

      {/* Labels skeleton */}
      <div className="flex gap-0.5 mt-3 px-1">
        {[0, 4, 8, 11].map(idx => (
          <div key={idx} className="flex-1 text-center" style={{ marginLeft: idx === 0 ? 0 : 'auto' }}>
            <div className="h-3 w-8 bg-gray-700 rounded mx-auto" />
          </div>
        ))}
      </div>
    </div>
  )
}
