// Market opportunities table
// Shows trading opportunities with edge calculations and signals
// Supports event-grouped card view with all brackets per event

import type { WeatherOpportunity, EventGroup } from '@/hooks/useWeatherOpportunities'

// ============================================================================
// Types
// ============================================================================

interface MarketOpportunitiesTableProps {
  opportunities: WeatherOpportunity[]
  eventGroups?: EventGroup[]
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
// Event Card Component
// ============================================================================

function EventCard({ group }: { group: EventGroup }) {
  return (
    <div className="bg-black/40 border border-gray-700/50 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-gray-700/30">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-sm font-semibold text-white">
              {group.city} &middot; {group.marketType}
            </h4>
            <div className="text-xs text-gray-400 mt-1">
              {group.date} &middot; {group.hoursToResolution.toFixed(1)}h to resolution
            </div>
            {group.hoursToResolution > 120 && (
              <div className="text-xs text-yellow-500/70 mt-1">
                {Math.round(group.hoursToResolution / 24)}d out — lower forecast confidence
              </div>
            )}
          </div>
          <div className="text-right">
            <div className="text-sm font-semibold text-amber-400">
              {group.modelForecast.toFixed(1)}&deg;F
            </div>
            <div className="text-xs text-gray-500">model forecast</div>
          </div>
        </div>
      </div>

      {/* Bracket Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-900/50 border-b border-gray-700/50">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Bracket
              </th>
              <th className="px-4 py-2 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Market
              </th>
              <th className="px-4 py-2 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Model
              </th>
              <th className="px-4 py-2 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Edge
              </th>
              <th className="px-4 py-2 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Signal
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700/30">
            {group.brackets.map((opp) => {
              const isActionable = opp.edge >= 0.05
              const edgeDirection = opp.modelProbability > opp.marketPrice ? '\u25B2' : '\u25BC'

              return (
                <tr
                  key={opp.market.id}
                  className={`transition-colors ${
                    isActionable
                      ? 'bg-amber-500/5 hover:bg-amber-500/10'
                      : 'hover:bg-gray-800/30'
                  }`}
                >
                  <td className="px-4 py-2 text-sm text-gray-300">
                    {opp.market.outcome}
                  </td>
                  <td className="px-4 py-2 text-center text-sm text-gray-300">
                    {(opp.marketPrice * 100).toFixed(0)}&cent;
                  </td>
                  <td className="px-4 py-2 text-center text-sm font-semibold text-amber-400">
                    {(opp.modelProbability * 100).toFixed(1)}%
                  </td>
                  <td className="px-4 py-2 text-center">
                    {isActionable ? (
                      <span className={`text-sm font-semibold ${
                        opp.edge >= 0.15 ? 'text-green-400' :
                        opp.edge >= 0.10 ? 'text-yellow-400' :
                        'text-amber-400'
                      }`}>
                        {edgeDirection} {(opp.edge * 100).toFixed(1)}%
                      </span>
                    ) : (
                      <span className="text-sm text-gray-600">&mdash;</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-center">
                    {isActionable ? (
                      <SignalBadge signal={opp.signal} />
                    ) : (
                      <span className="text-xs text-gray-600">&mdash;</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Best-edge footer callout */}
      {group.bestEdge && (
        <div className="px-4 py-3 bg-gray-900/30 border-t border-gray-700/30 text-xs text-gray-400">
          <span className="text-amber-400 font-semibold">Best edge:</span>{' '}
          {group.bestEdge.market.outcome} &middot;{' '}
          <SignalBadge signal={group.bestEdge.signal} />{' '}
          @ {(group.bestEdge.marketPrice * 100).toFixed(0)}&cent; &middot;{' '}
          <span className={group.bestEdge.expectedValue > 0 ? 'text-green-400' : 'text-red-400'}>
            EV {group.bestEdge.expectedValue > 0 ? '+' : ''}${group.bestEdge.expectedValue.toFixed(2)}
          </span>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Flat Table (Fallback)
// ============================================================================

function FlatTable({ opportunities }: { opportunities: WeatherOpportunity[] }) {
  return (
    <div className="bg-black/40 border border-gray-700/50 rounded-xl overflow-hidden">
      <div className="p-6 pb-0">
        <h3 className="text-lg font-semibold mb-4 text-white">
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
                <td className="px-4 py-3 text-sm text-gray-300">
                  {opp.market.outcome}
                </td>
                <td className="px-4 py-3 text-center">
                  <div className="text-sm font-semibold text-amber-400">
                    {(opp.modelProbability * 100).toFixed(1)}%
                  </div>
                  <div className="text-xs text-gray-500">
                    {opp.confidence.toFixed(0)}% conf
                  </div>
                </td>
                <td className="px-4 py-3 text-center text-sm text-gray-300">
                  {(opp.marketPrice * 100).toFixed(1)}%
                </td>
                <td className="px-4 py-3 text-center">
                  <span className={`text-sm font-semibold ${
                    opp.edge >= 0.15 ? 'text-green-400' :
                    opp.edge >= 0.10 ? 'text-yellow-400' :
                    'text-gray-400'
                  }`}>
                    {(opp.edge * 100).toFixed(1)}%
                  </span>
                </td>
                <td className="px-4 py-3 text-center">
                  <SignalBadge signal={opp.signal} />
                </td>
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

      <div className="px-6 py-3 bg-gray-900/30 border-t border-gray-700/30 text-xs text-gray-400">
        Showing opportunities with edge &ge;5%. EV calculated for $100 position size with 15% all-in fees.
      </div>
    </div>
  )
}

// ============================================================================
// Main Component
// ============================================================================

export function MarketOpportunitiesTable({ opportunities, eventGroups }: MarketOpportunitiesTableProps) {
  // Use event-grouped cards if available
  if (eventGroups && eventGroups.length > 0) {
    return (
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-white">
          Market Opportunities ({eventGroups.length} events)
        </h3>
        {eventGroups.map((group) => (
          <EventCard key={group.eventTicker} group={group} />
        ))}
        <div className="text-xs text-gray-400 mt-2">
          Highlighted rows have edge &ge;5%. EV calculated for $100 position size with 15% all-in fees.
        </div>
      </div>
    )
  }

  // Fallback to flat table
  if (!opportunities || opportunities.length === 0) {
    return (
      <div className="bg-black/40 border border-gray-700/50 rounded-xl overflow-hidden">
        <div className="p-6">
          <h3 className="text-lg font-semibold mb-4 text-white">Market Opportunities</h3>
          <div className="text-center py-8 text-gray-400">
            No trading opportunities found. Check back later for new markets.
          </div>
        </div>
      </div>
    )
  }

  return <FlatTable opportunities={opportunities} />
}
