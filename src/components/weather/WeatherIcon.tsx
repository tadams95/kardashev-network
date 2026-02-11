// Shared weather icon component
// Maps WMO weather codes to Heroicon sun/cloud icons

import { CloudIcon, SunIcon } from '@heroicons/react/24/solid'
import { getWeatherIcon } from '@/lib/weather'

interface WeatherIconProps {
  weatherCode: number | null
  className?: string
}

export function WeatherIcon({ weatherCode, className = 'w-5 h-5' }: WeatherIconProps) {
  if (weatherCode == null) {
    return <SunIcon className={`${className} text-amber-400`} />
  }
  const icon = getWeatherIcon(weatherCode)
  if (icon === 'sun' || icon === 'cloud-sun') {
    return <SunIcon className={`${className} text-amber-400`} />
  }
  return <CloudIcon className={`${className} text-blue-400`} />
}
