// Dataset insights card showing key metrics and characteristics
// Text-based display with progress bar for outcome distribution

import { InformationCircleIcon } from '@heroicons/react/24/outline'

interface DatasetInsightsProps {
  totalMarkets: number
  dateRange: string // "June - September 2024"
  outcomeSplit: { yes: number; no: number }
  averageEdge: number // 0.208
}

export function DatasetInsights({
  totalMarkets,
  dateRange,
  outcomeSplit,
  averageEdge
}: DatasetInsightsProps) {
  const noPercentage = ((outcomeSplit.no / totalMarkets) * 100).toFixed(0)

  return (
    <div className="bg-black/40 border border-gray-700/50 rounded-xl p-6">
      <h3 className="text-lg font-semibold mb-4">Dataset Insights</h3>

      <div className="space-y-4">
        {/* Total markets */}
        <div className="flex justify-between items-center">
          <span className="text-gray-300">Total Markets Validated</span>
          <span className="text-xl font-bold text-blue-400">
            {totalMarkets.toLocaleString()}
          </span>
        </div>

        {/* Date range */}
        <div className="flex justify-between items-center">
          <span className="text-gray-300">Period</span>
          <span className="text-gray-400">{dateRange}</span>
        </div>

        {/* Outcome distribution */}
        <div>
          <div className="flex justify-between items-center mb-2">
            <span className="text-gray-300">Outcome Distribution</span>
            <span className="text-gray-400">
              {noPercentage}% NO / {100 - parseInt(noPercentage)}% YES
            </span>
          </div>
          <div className="flex gap-1 h-2 rounded-full overflow-hidden bg-gray-700">
            <div
              className="bg-red-500"
              style={{ width: `${noPercentage}%` }}
            />
            <div
              className="bg-green-500"
              style={{ width: `${100 - parseInt(noPercentage)}%` }}
            />
          </div>
        </div>

        {/* Average edge */}
        <div className="flex justify-between items-center">
          <span className="text-gray-300">Average Edge</span>
          <span className="text-xl font-bold text-green-400">
            {(averageEdge * 100).toFixed(1)}%
          </span>
        </div>

        {/* Key insight */}
        <div className="pt-4 border-t border-gray-700/50">
          <div className="flex gap-2 items-start">
            <InformationCircleIcon className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-gray-300">
              <span className="font-semibold text-blue-400">Key Finding:</span> Model excels at identifying unlikely events. Dataset has extreme thresholds (late summer heat), resulting in 95% NO outcomes.
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
