// Market opportunities table
// Shows trading opportunities with edge calculations and signals

import type { WeatherOpportunity } from '@/hooks/useWeatherOpportunities'

// ============================================================================
// Types
// ============================================================================

interface MarketOpportunitiesTableProps {
  opportunities: WeatherOpportunity[]
}

// ============================================================================
// Signal Badge Component
// ============================================================================

function SignalBadge({ signal }: { signal: string }) {
  const colors: Record<string, string> = {
    'STRONG_BUY': 'bg-green-500/20 text-green-400 border-green-500/50',
    'BUY': 'bg-green-500/10 text-green-400 border-green-500/30',
    'HOLD': 'bg-gray-500/20 text-gray-400 border-gray-500/50',
    'SELL': 'bg-red-500/10 text-red-400 border-red-500/30',
    'STRONG_SELL': 'bg-red-500/20 text-red-400 border-red-500/50',
  }

  return (
    <span className={`px-2 py-1 rounded-md text-xs font-semibold border ${colors[signal] || colors['HOLD']}`}>
      {signal.replace('_', ' ')}
    </span>
  )
}

// ============================================================================
// Component
// ============================================================================

export function MarketOpportunitiesTable({ opportunities }: MarketOpportunitiesTableProps) {
  if (!opportunities || opportunities.length === 0) {
    return (
      <div className="bg-black/40 border border-gray-700/50 rounded-xl overflow-hidden">
        <div className="p-6">
          <h3 className="text-lg font-semibold mb-4">Market Opportunities</h3>
          <div className="text-center py-8 text-gray-400">
            No trading opportunities found. Check back later for new markets.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-black/40 border border-gray-700/50 rounded-xl overflow-hidden">
      <div className="p-6 pb-0">
        <h3 className="text-lg font-semibold mb-4">
          Market Opportunities ({opportunities.length})
        </h3>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-900/50 border-b border-gray-700/50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Market
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Threshold
              </th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Model Prob
              </th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Market Price
              </th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Edge
              </th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Signal
              </th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-400 uppercase tracking-wider">
                EV ($100)
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700/30">
            {opportunities.map((opp) => (
              <tr
                key={opp.market.id}
                className="hover:bg-gray-800/30 transition-colors"
              >
                {/* Market */}
                <td className="px-4 py-3">
                  <div className="text-sm font-medium text-white">
                    {opp.market.id}
                  </div>
                  <div className="text-xs text-gray-400 truncate max-w-[200px]">
                    {opp.market.question}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {opp.hoursToResolution.toFixed(1)}h to resolution
                  </div>
                </td>

                {/* Threshold */}
                <td className="px-4 py-3 text-sm text-gray-300">
                  {opp.market.outcome}
                </td>

                {/* Model Probability */}
                <td className="px-4 py-3 text-center">
                  <div className="text-sm font-semibold text-amber-400">
                    {(opp.modelProbability * 100).toFixed(1)}%
                  </div>
                  <div className="text-xs text-gray-500">
                    {opp.confidence.toFixed(0)}% conf
                  </div>
                </td>

                {/* Market Price */}
                <td className="px-4 py-3 text-center text-sm text-gray-300">
                  {(opp.marketPrice * 100).toFixed(1)}%
                </td>

                {/* Edge */}
                <td className="px-4 py-3 text-center">
                  <span className={`text-sm font-semibold ${
                    opp.edge >= 0.15 ? 'text-green-400' :
                    opp.edge >= 0.10 ? 'text-yellow-400' :
                    'text-gray-400'
                  }`}>
                    {(opp.edge * 100).toFixed(1)}%
                  </span>
                </td>

                {/* Signal */}
                <td className="px-4 py-3 text-center">
                  <SignalBadge signal={opp.signal} />
                </td>

                {/* Expected Value */}
                <td className="px-4 py-3 text-right">
                  <span className={`text-sm font-semibold ${
                    opp.expectedValue > 0 ? 'text-green-400' : 'text-red-400'
                  }`}>
                    ${opp.expectedValue.toFixed(2)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer Info */}
      <div className="px-6 py-3 bg-gray-900/30 border-t border-gray-700/30 text-xs text-gray-400">
        Showing opportunities with edge ≥5%. EV calculated for $100 position size with 15% all-in fees.
      </div>
    </div>
  )
}
