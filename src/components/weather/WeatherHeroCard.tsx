// Hero card displaying current weather conditions
// Shows temperature, range, precipitation probability

import { CloudIcon } from '@heroicons/react/24/solid'
import type { WeatherEnsemble, CityCoordinates } from '@/types/weather'

// ============================================================================
// Types
// ============================================================================

interface WeatherHeroCardProps {
  forecast?: WeatherEnsemble['consensus']
  city?: CityCoordinates
}

// ============================================================================
// Component
// ============================================================================

export function WeatherHeroCard({ forecast, city }: WeatherHeroCardProps) {
  if (!forecast || !city) {
    return (
      <div className="bg-black/40 border border-gray-700/50 rounded-xl p-6">
        <div className="animate-pulse">
          <div className="h-16 bg-gray-700/30 rounded mb-2"></div>
          <div className="h-4 bg-gray-700/30 rounded w-3/4 mb-4"></div>
          <div className="h-4 bg-gray-700/30 rounded w-1/2"></div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-black/40 border border-gray-700/50 rounded-xl p-6">
      {/* City Name */}
      <div className="text-sm text-gray-400 mb-2 uppercase tracking-wide">
        {city.name}
      </div>

      {/* Temperature */}
      <div className="text-5xl font-bold text-amber-400 mb-2">
        {forecast.temperatureMean.toFixed(1)}°F
      </div>

      {/* Temperature Range */}
      <div className="text-gray-300 text-sm mb-4">
        Range: {forecast.temperatureRange[0].toFixed(0)}° - {forecast.temperatureRange[1].toFixed(0)}°
      </div>

      {/* Precipitation */}
      <div className="flex items-center gap-2">
        <CloudIcon className="w-5 h-5 text-blue-400" />
        <span className="text-gray-300">
          {(forecast.precipProbability * 100).toFixed(0)}% chance of rain
        </span>
      </div>

      {/* Model Agreement Indicator */}
      <div className="mt-4 pt-4 border-t border-gray-700/30">
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-400">Model Agreement</span>
          <span className={`font-semibold ${
            forecast.modelAgreement >= 80 ? 'text-green-400' :
            forecast.modelAgreement >= 60 ? 'text-yellow-400' :
            'text-red-400'
          }`}>
            {forecast.modelAgreement.toFixed(1)}%
          </span>
        </div>
      </div>
    </div>
  )
}
