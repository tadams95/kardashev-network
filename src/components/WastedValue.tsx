// Animated dollar counter showing wasted solar energy value

import CountUp from 'react-countup'
import type { WastedEnergy } from '@/types/solar'
import { formatWatts } from '@/lib/calculations/solarValue'

interface WastedValueProps {
  wastedEnergy: WastedEnergy
  showBreakdown?: boolean
}

export default function WastedValue({
  wastedEnergy,
  showBreakdown = true,
}: WastedValueProps) {
  const { currentWatts, currentValue, todayValue, monthlyEstimate } = wastedEnergy

  return (
    <div className="space-y-6">
      {/* Main value - current hourly rate */}
      <div className="text-center">
        <div className="text-sm text-gray-400 uppercase tracking-wide mb-1">
          Uncaptured Energy Value
        </div>
        <div className="flex items-baseline justify-center gap-1">
          <span className="text-5xl sm:text-6xl font-bold text-green-400">
            $
            <CountUp
              end={currentValue}
              decimals={2}
              duration={1.5}
              preserveValue
            />
          </span>
          <span className="text-xl text-gray-400">/hour</span>
        </div>
        <div className="text-sm text-gray-500 mt-2">
          {formatWatts(currentWatts)} potential generation
        </div>
      </div>

      {/* Breakdown cards */}
      {showBreakdown && (
        <div className="grid grid-cols-2 gap-4">
          {/* Today's estimate */}
          <div className="bg-[#0a0a0a]/80 rounded-xl p-4 border border-gray-700/50">
            <div className="text-xs text-gray-400 uppercase tracking-wide mb-1">
              Today&apos;s Potential
            </div>
            <div className="text-2xl font-bold text-white">
              $
              <CountUp
                end={todayValue}
                decimals={0}
                duration={1.5}
                preserveValue
              />
            </div>
            <div className="text-xs text-gray-500 mt-1">remaining today</div>
          </div>

          {/* Monthly estimate */}
          <div className="bg-[#0a0a0a]/80 rounded-xl p-4 border border-gray-700/50">
            <div className="text-xs text-gray-400 uppercase tracking-wide mb-1">
              Monthly Estimate
            </div>
            <div className="text-2xl font-bold text-white">
              $
              <CountUp
                end={monthlyEstimate}
                separator=","
                duration={1.5}
                preserveValue
              />
            </div>
            <div className="text-xs text-gray-500 mt-1">if captured</div>
          </div>
        </div>
      )}
    </div>
  )
}

// Compact version for smaller displays
export function WastedValueCompact({
  wastedEnergy,
}: {
  wastedEnergy: WastedEnergy
}) {
  return (
    <div className="flex items-center gap-4">
      <div>
        <span className="text-2xl font-bold text-green-400">
          $
          <CountUp
            end={wastedEnergy.currentValue}
            decimals={2}
            duration={1}
            preserveValue
          />
        </span>
        <span className="text-sm text-gray-400">/hr</span>
      </div>
      <div className="text-sm text-gray-500">
        ${wastedEnergy.monthlyEstimate.toLocaleString()}/mo potential
      </div>
    </div>
  )
}

// Skeleton loader
export function WastedValueSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="text-center">
        <div className="h-4 w-32 bg-gray-700 rounded mx-auto mb-2" />
        <div className="h-14 w-48 bg-gray-700 rounded mx-auto" />
        <div className="h-4 w-40 bg-gray-700 rounded mx-auto mt-2" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-[#0a0a0a]/80 rounded-xl p-4 border border-gray-700/50">
          <div className="h-3 w-20 bg-gray-700 rounded mb-2" />
          <div className="h-8 w-16 bg-gray-700 rounded" />
        </div>
        <div className="bg-[#0a0a0a]/80 rounded-xl p-4 border border-gray-700/50">
          <div className="h-3 w-20 bg-gray-700 rounded mb-2" />
          <div className="h-8 w-16 bg-gray-700 rounded" />
        </div>
      </div>
    </div>
  )
}
