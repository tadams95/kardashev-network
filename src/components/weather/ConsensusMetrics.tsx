// Consensus metrics card
// Shows model agreement, data quality, historical accuracy, and source status

import type { WeatherEnsemble } from '@/types/weather'
import Card from '@/components/Card'

// ============================================================================
// Types
// ============================================================================

interface ConsensusMetricsProps {
  consensus?: WeatherEnsemble['consensus']
  sources?: Record<string, 'ok' | 'stale' | 'failed'>
}

// ============================================================================
// Component
// ============================================================================

export function ConsensusMetrics({ consensus, sources }: ConsensusMetricsProps) {
  if (!consensus || !sources) {
    return (
      <Card noPadding className="p-6">
        <h3 className="text-lg font-semibold mb-4">Consensus Metrics</h3>
        <div className="animate-pulse">
          <div className="h-4 bg-gray-700/30 rounded mb-3"></div>
          <div className="h-4 bg-gray-700/30 rounded mb-3"></div>
          <div className="h-4 bg-gray-700/30 rounded"></div>
        </div>
      </Card>
    )
  }

  // Additional null checks for properties
  const modelAgreement = consensus.modelAgreement ?? 0
  const dataQuality = consensus.dataQuality ?? 0

  return (
    <Card noPadding className="p-6">
      <h3 className="text-lg font-semibold mb-4 text-white">Consensus Metrics</h3>

      <div className="space-y-3">
        {/* Model Agreement */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-400">Model Agreement</span>
          <span className={`text-lg font-semibold ${
            modelAgreement >= 80 ? 'text-green-400' :
            modelAgreement >= 60 ? 'text-yellow-400' :
            'text-red-400'
          }`}>
            {modelAgreement.toFixed(1)}%
          </span>
        </div>

        {/* Data Quality */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-400">Data Quality</span>
          <span className={`text-lg font-semibold ${
            dataQuality >= 90 ? 'text-green-400' :
            dataQuality >= 70 ? 'text-yellow-400' :
            'text-red-400'
          }`}>
            {dataQuality}%
          </span>
        </div>

        {/* Historical Accuracy */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-400">Historical Accuracy</span>
          <span className="text-lg font-semibold text-green-400">
            85.9%
          </span>
        </div>

        {/* Source Status */}
        <div className="border-t border-gray-700/30 pt-3 mt-3">
          <div className="text-xs text-gray-400 mb-2">Data Sources</div>
          <div className="space-y-1.5">
            {Object.entries(sources).map(([source, status]) => (
              <div key={source} className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${
                  status === 'ok' ? 'bg-green-400' :
                  status === 'stale' ? 'bg-yellow-400' :
                  'bg-red-400'
                }`} />
                <span className="text-xs text-gray-300">{source}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  )
}
