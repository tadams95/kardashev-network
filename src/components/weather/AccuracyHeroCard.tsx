// Hero card displaying prediction accuracy with pass/fail indicator
// Shows large accuracy percentage with green checkmark for passing validation

import { CheckCircleIcon } from '@heroicons/react/24/solid'

interface AccuracyHeroCardProps {
  accuracy: number // 0-1 (0.868 = 86.8%)
  totalMarkets: number
  target: number // 0.70 for 70%
}

export function AccuracyHeroCard({ accuracy, totalMarkets, target }: AccuracyHeroCardProps) {
  const passed = accuracy >= target
  const percentage = (accuracy * 100).toFixed(1)

  return (
    <div className="bg-black/40 border border-gray-700/50 rounded-xl p-6">
      {/* Large accuracy number with pass/fail indicator */}
      <div className="flex items-center gap-4 mb-4">
        <div className={`text-6xl font-bold ${passed ? 'text-green-400' : 'text-red-400'}`}>
          {percentage}%
        </div>
        {passed && (
          <div className="flex items-center gap-2 text-green-400">
            <CheckCircleIcon className="w-8 h-8" />
            <span className="text-xl font-semibold">PASS</span>
          </div>
        )}
      </div>

      {/* Subtitle */}
      <div className="text-gray-300 text-lg mb-2">
        Prediction Accuracy on {totalMarkets.toLocaleString()} Real Kalshi Markets
      </div>

      {/* Target comparison */}
      <div className="flex items-center gap-2 text-sm text-gray-400">
        <span>Target: ≥{(target * 100).toFixed(0)}%</span>
        <span className="text-gray-600">•</span>
        <span className={passed ? 'text-green-400' : 'text-red-400'}>
          {passed ? `+${((accuracy - target) * 100).toFixed(1)}% above target` : 'Below target'}
        </span>
      </div>
    </div>
  )
}
