// Radial gauge component showing current solar irradiance

import { getIrradianceLevel } from '@/lib/calculations/solarValue'

interface SolarMeterProps {
  ghi: number // Global Horizontal Irradiance in W/m²
  maxGhi?: number // Maximum expected GHI (default 1000 W/m²)
  size?: 'sm' | 'md' | 'lg'
  showLabel?: boolean
}

export default function SolarMeter({
  ghi,
  maxGhi = 1000,
  size = 'md',
  showLabel = true,
}: SolarMeterProps) {
  // Calculate percentage (0-100)
  const percentage = Math.min(100, Math.max(0, (ghi / maxGhi) * 100))

  // Get level info
  const { label, color } = getIrradianceLevel(ghi)

  // Size configurations
  const sizeConfig = {
    sm: { width: 120, stroke: 8, fontSize: 'text-xl', labelSize: 'text-xs' },
    md: { width: 180, stroke: 12, fontSize: 'text-3xl', labelSize: 'text-sm' },
    lg: { width: 240, stroke: 16, fontSize: 'text-4xl', labelSize: 'text-base' },
  }

  const config = sizeConfig[size]
  const radius = (config.width - config.stroke) / 2
  const circumference = 2 * Math.PI * radius

  // Arc goes from -135° to 135° (270° total)
  const arcLength = (270 / 360) * circumference
  const filledLength = (percentage / 100) * arcLength

  // Gradient colors based on percentage
  const getGradientColor = () => {
    if (percentage < 20) return { start: '#6b7280', end: '#9ca3af' } // Gray
    if (percentage < 40) return { start: '#ca8a04', end: '#eab308' } // Yellow
    if (percentage < 60) return { start: '#ea580c', end: '#f97316' } // Orange
    if (percentage < 80) return { start: '#dc2626', end: '#f97316' } // Red-Orange
    return { start: '#16a34a', end: '#22c55e' } // Green (peak)
  }

  const gradientColors = getGradientColor()
  const gradientId = `solar-gradient-${Math.random().toString(36).substr(2, 9)}`

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: config.width, height: config.width }}>
        <svg
          width={config.width}
          height={config.width}
          className="transform -rotate-[135deg]"
        >
          <defs>
            <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={gradientColors.start} />
              <stop offset="100%" stopColor={gradientColors.end} />
            </linearGradient>
          </defs>

          {/* Background arc */}
          <circle
            cx={config.width / 2}
            cy={config.width / 2}
            r={radius}
            fill="none"
            stroke="#374151"
            strokeWidth={config.stroke}
            strokeDasharray={`${arcLength} ${circumference}`}
            strokeLinecap="round"
          />

          {/* Filled arc */}
          <circle
            cx={config.width / 2}
            cy={config.width / 2}
            r={radius}
            fill="none"
            stroke={`url(#${gradientId})`}
            strokeWidth={config.stroke}
            strokeDasharray={`${filledLength} ${circumference}`}
            strokeLinecap="round"
            className="transition-all duration-500 ease-out"
          />
        </svg>

        {/* Center content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`${config.fontSize} font-bold text-white`}>
            {Math.round(ghi)}
          </span>
          <span className={`${config.labelSize} text-gray-400`}>W/m²</span>
        </div>
      </div>

      {showLabel && (
        <div className="mt-2 text-center">
          <span className={`${config.labelSize} font-medium ${color}`}>
            {label}
          </span>
          {ghi > 0 && (
            <span className={`${config.labelSize} text-gray-500 ml-2`}>
              ({Math.round(percentage)}% of peak)
            </span>
          )}
        </div>
      )}
    </div>
  )
}

// Skeleton loader for SolarMeter
export function SolarMeterSkeleton({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const sizeConfig = {
    sm: { width: 120 },
    md: { width: 180 },
    lg: { width: 240 },
  }

  return (
    <div className="flex flex-col items-center animate-pulse">
      <div
        className="rounded-full bg-gray-700"
        style={{ width: sizeConfig[size].width, height: sizeConfig[size].width }}
      />
      <div className="mt-2 h-4 w-20 bg-gray-700 rounded" />
    </div>
  )
}
