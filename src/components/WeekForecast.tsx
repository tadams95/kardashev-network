import type { DailyForecast } from '@/types/solar'
import { getWeatherIcon } from '@/lib/weather'
import { estimateKwhFromRadiation } from '@/lib/calculations/solarValue'

function WeatherIcon({ code, className = 'w-5 h-5' }: { code: number; className?: string }) {
  const icon = getWeatherIcon(code)

  switch (icon) {
    case 'sun':
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="4" strokeWidth={1.5} />
          <path strokeLinecap="round" strokeWidth={1.5} d="M12 2v2m0 16v2m10-10h-2M4 12H2m15.07-5.07l-1.41 1.41M8.34 15.66l-1.41 1.41m0-10.14l1.41 1.41m7.32 7.32l1.41 1.41" />
        </svg>
      )
    case 'cloud-sun':
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a4 4 0 11-4-4m-2.5 4a4.5 4.5 0 108.5 2.5H6.5a3.5 3.5 0 010-7c.592 0 1.152.147 1.642.406" />
        </svg>
      )
    case 'rain':
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 10a4.5 4.5 0 10-8.5 2.5H6.5a3.5 3.5 0 010-7c.96 0 1.838.388 2.472 1.015A4.48 4.48 0 0115 5.5a4.5 4.5 0 014.5 4.5z" />
          <path strokeLinecap="round" strokeWidth={1.5} d="M8 15v3m4-4v3m4-2v3" />
        </svg>
      )
    case 'snow':
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 10a4.5 4.5 0 10-8.5 2.5H6.5a3.5 3.5 0 010-7c.96 0 1.838.388 2.472 1.015A4.48 4.48 0 0115 5.5a4.5 4.5 0 014.5 4.5z" />
          <circle cx="8" cy="16" r="0.75" fill="currentColor" />
          <circle cx="12" cy="17" r="0.75" fill="currentColor" />
          <circle cx="16" cy="16" r="0.75" fill="currentColor" />
        </svg>
      )
    case 'thunderstorm':
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 10a4.5 4.5 0 10-8.5 2.5H6.5a3.5 3.5 0 010-7c.96 0 1.838.388 2.472 1.015A4.48 4.48 0 0115 5.5a4.5 4.5 0 014.5 4.5z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 14l-2 4h3l-2 4" />
        </svg>
      )
    default: // cloud
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 10a4.5 4.5 0 10-8.5 2.5H6.5a3.5 3.5 0 010-7c.96 0 1.838.388 2.472 1.015A4.48 4.48 0 0115 5.5a4.5 4.5 0 014.5 4.5z" />
        </svg>
      )
  }
}

// Solar-quality color for the forecast icon stroke (plan §3.6).
// Thresholds in kWh/m²/day — typical residential range is ~1 (overcast) to
// ~7+ (perfect summer day). Absolute (not relative) so a sunny day in
// Seattle reads the same as a sunny day in Phoenix.
function getSolarQualityColor(radiationSumMJ: number): string {
  const kWh = radiationSumMJ / 3.6
  if (kWh < 2) return 'text-gray-500'    // poor — overcast
  if (kWh < 4) return 'text-yellow-500'  // moderate — partly cloudy
  if (kWh < 6) return 'text-orange-400'  // good — mostly sunny
  return 'text-amber-500'                 // excellent — sunny
}

function getDayName(dateStr: string): string {
  const date = new Date(dateStr)
  const today = new Date()
  if (date.toDateString() === today.toDateString()) return 'Today'
  return date.toLocaleDateString(undefined, { weekday: 'short' })
}

function isToday(dateStr: string): boolean {
  return new Date(dateStr).toDateString() === new Date().toDateString()
}

export default function WeekForecast({
  forecast,
  usableAreaM2,
}: {
  forecast: DailyForecast[]
  usableAreaM2?: number
}) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-thin">
      {forecast.map((day) => (
        <div
          key={day.date}
          className={`flex-shrink-0 flex flex-col items-center gap-1.5 bg-gray-800/40 rounded-inner p-card-sm min-w-[5.5rem] ${
            isToday(day.date) ? 'border border-amber-700/30' : 'border border-transparent'
          }`}
        >
          <span className="text-caption font-medium text-gray-300">{getDayName(day.date)}</span>
          <WeatherIcon code={day.weatherCode} className={`w-5 h-5 ${getSolarQualityColor(day.radiationSum)}`} />
          <span className="text-micro text-gray-500 text-center leading-tight">{day.weatherDescription}</span>
          <div className="text-center mt-0.5">
            <div className="text-body font-medium text-white">{(day.radiationSum / 3.6).toFixed(1)}</div>
            <div className="text-micro text-gray-500">kWh/m²</div>
          </div>
          <div className="text-center">
            <div className="text-caption font-medium text-amber-500">{Math.round(usableAreaM2
              ? estimateKwhFromRadiation(day.radiationSum, usableAreaM2, true)
              : day.estimatedKwh
            )}</div>
            <div className="text-micro text-gray-500">est. kWh</div>
          </div>
        </div>
      ))}
    </div>
  )
}

export function WeekForecastSkeleton() {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
      {Array.from({ length: 7 }).map((_, i) => (
        <div
          key={i}
          className="flex-shrink-0 flex flex-col items-center gap-1.5 bg-gray-800/40 rounded-inner p-card-sm min-w-[5.5rem] animate-pulse"
        >
          <div className="h-3 w-8 bg-gray-700/50 rounded-chip" />
          <div className="h-5 w-5 bg-gray-700/50 rounded-full" />
          <div className="h-3 w-12 bg-gray-700/50 rounded-chip" />
          <div className="h-4 w-8 bg-gray-700/50 rounded-chip mt-0.5" />
          <div className="h-3 w-10 bg-gray-700/50 rounded-chip" />
        </div>
      ))}
    </div>
  )
}
