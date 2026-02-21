// Market opportunities table
// Shows trading opportunities with edge calculations and signals
// Supports event-grouped card view with all brackets per event

import React, { useState } from 'react'
import type { WeatherOpportunity, EventGroup } from '@/hooks/useWeatherOpportunities'
import { DEFAULT_FEE_RATE } from '@/lib/models/weatherProbability'

interface MarketOpportunitiesTableProps {
  opportunities: WeatherOpportunity[]
  eventGroups?: EventGroup[]
  totalMarketsCount?: number
  allWithinBuffer?: boolean
}

// ============================================================================
// Signal Badge Component
// ============================================================================

const SIGNAL_LABELS: Record<string, string> = {
  'STRONG_YES': 'Strong Buy',
  'YES': 'Buy',
  'HOLD': 'Hold',
  'NO': 'Sell',
  'STRONG_NO': 'Strong Sell',
}

const SIGNAL_COLORS: Record<string, string> = {
  'STRONG_YES': 'bg-green-500/20 text-green-400 border-green-500/50',
  'YES': 'bg-green-500/10 text-green-400 border-green-500/30',
  'HOLD': 'bg-gray-500/20 text-gray-400 border-gray-500/50',
  'NO': 'bg-red-500/10 text-red-400 border-red-500/30',
  'STRONG_NO': 'bg-red-500/20 text-red-400 border-red-500/50',
}

function SignalBadge({ signal }: { signal: string }) {
  return (
    <span className={`px-2 py-1 rounded-md text-xs font-semibold border ${SIGNAL_COLORS[signal] || SIGNAL_COLORS['HOLD']}`}>
      {SIGNAL_LABELS[signal] || signal}
    </span>
  )
}

// ============================================================================
// Forecast Badge Component
// ============================================================================

function ForecastBadge() {
  return (
    <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide bg-amber-500/15 text-amber-400 border border-amber-500/30">
      Forecast
    </span>
  )
}

// ============================================================================
// Event Card Component
// ============================================================================

function SpreadColor({ spread }: { spread: number }) {
  const cents = spread * 100
  const color = cents <= 5 ? 'text-green-400' : cents <= 10 ? 'text-yellow-400' : 'text-red-400'
  return <span className={color}>{cents.toFixed(1)}&cent;</span>
}

function DetailContent({ opp }: { opp: WeatherOpportunity }) {
  const market = opp.market
  const isSellOnForecast = opp.isForecastBracket && (opp.signal === 'NO' || opp.signal === 'STRONG_NO')

  return (
    <>
      {isSellOnForecast && (
        <p className="text-xs text-amber-400/80 mb-2">
          This is the forecasted bracket, but the market is overpricing it
          ({(opp.marketPrice * 100).toFixed(0)}&cent; vs model {(opp.modelProbability * 100).toFixed(0)}%).
          Selling the overpriced side is +EV over time.
        </p>
      )}
      {opp.reasoning && (
        <p className="text-sm text-gray-300 mb-2">{opp.reasoning}</p>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400 mb-2">
        {market.yesBid != null && (
          <span>Bid <span className="text-gray-200">{(market.yesBid * 100).toFixed(1)}&cent;</span></span>
        )}
        {market.yesAsk != null && (
          <span>Ask <span className="text-gray-200">{(market.yesAsk * 100).toFixed(1)}&cent;</span></span>
        )}
        {market.spread != null && (
          <span>Spread <SpreadColor spread={market.spread} /></span>
        )}
        {market.volume != null && (
          <span>Volume <span className="text-gray-200">${market.volume.toLocaleString()}</span></span>
        )}
        {market.liquidity != null && (
          <span>Liquidity <span className="text-gray-200">${market.liquidity.toLocaleString()}</span></span>
        )}
        <span>Confidence <span className="text-gray-200">{opp.confidence.toFixed(0)}%</span></span>
        <span>EV <span className={opp.expectedValue > 0 ? 'text-green-400' : 'text-red-400'}>
          {opp.expectedValue > 0 ? '+' : ''}${opp.expectedValue.toFixed(2)}
        </span></span>
      </div>
      {market.question && (
        <p className="text-xs italic text-gray-500">{market.question}</p>
      )}
    </>
  )
}

function DetailRow({ opp }: { opp: WeatherOpportunity }) {
  return (
    <tr className="bg-gray-900/40">
      <td colSpan={5} className="px-4 py-3">
        <DetailContent opp={opp} />
      </td>
    </tr>
  )
}

function MobileBracketRow({ opp }: { opp: WeatherOpportunity }) {
  const [isExpanded, setIsExpanded] = useState(false)
  const isActionable = opp.edge >= 0.05
  const isForecast = opp.isForecastBracket
  const edgeDirection = opp.modelProbability > opp.marketPrice ? '\u25B2' : '\u25BC'

  return (
    <div className={`border-b border-gray-700/30 ${isForecast ? 'border-l-[3px] border-l-amber-400' : ''} ${isActionable ? 'bg-amber-500/5' : ''}`}>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full text-left py-3 px-3 space-y-1.5"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm text-gray-300 truncate">{opp.market.outcome}</span>
            {isForecast && <ForecastBadge />}
          </div>
          <svg className={`w-4 h-4 text-gray-500 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-gray-400">Mkt <span className="text-gray-300">{(opp.marketPrice * 100).toFixed(0)}&cent;</span></span>
          <span className="text-gray-400">Model <span className="text-amber-400 font-semibold">{(opp.modelProbability * 100).toFixed(1)}%</span></span>
          {isActionable ? (
            <span className={`font-semibold ${opp.edge >= 0.15 ? 'text-green-400' : opp.edge >= 0.10 ? 'text-yellow-400' : 'text-amber-400'}`}>
              {edgeDirection} {(opp.edge * 100).toFixed(1)}%
            </span>
          ) : (
            <span className="text-gray-600">&mdash;</span>
          )}
          {isActionable ? (
            <SignalBadge signal={opp.signal} />
          ) : (
            <span className="text-gray-600 text-xs">&mdash;</span>
          )}
        </div>
      </button>
      {isExpanded && (
        <div className="px-3 pb-3 bg-gray-900/40">
          <DetailContent opp={opp} />
        </div>
      )}
    </div>
  )
}

function EventCard({ group }: { group: EventGroup }) {
  const [expandedRow, setExpandedRow] = useState<string | null>(null)

  return (
    <div className="bg-black/40 border border-gray-700/50 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="p-3 border-b border-gray-700/30">
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

      {/* Mobile bracket rows */}
      <div className="md:hidden">
        {group.brackets.map((opp) => (
          <MobileBracketRow key={opp.market.id} opp={opp} />
        ))}
      </div>

      {/* Desktop bracket table */}
      <div className="max-md:hidden overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-900/50 border-b border-gray-700/50">
            <tr>
              <th className="px-3 py-1.5 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Bracket
              </th>
              <th className="px-3 py-1.5 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Market
              </th>
              <th className="px-3 py-1.5 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Model
              </th>
              <th className="px-3 py-1.5 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Edge
              </th>
              <th className="px-3 py-1.5 text-center text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Signal
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700/30">
            {group.brackets.map((opp) => {
              const isActionable = opp.edge >= 0.05
              const isForecast = opp.isForecastBracket
              const edgeDirection = opp.modelProbability > opp.marketPrice ? '\u25B2' : '\u25BC'
              const isExpanded = expandedRow === opp.market.id

              return (
                <React.Fragment key={opp.market.id}>
                  <tr
                    onClick={() => setExpandedRow(isExpanded ? null : opp.market.id)}
                    className={`cursor-pointer transition-colors ${
                      isForecast ? 'border-l-[3px] border-l-amber-400' : ''
                    } ${
                      isActionable
                        ? 'bg-amber-500/5 hover:bg-amber-500/10'
                        : 'hover:bg-gray-800/30'
                    }`}
                  >
                    <td className="px-3 py-1.5 text-sm text-gray-300">
                      <span className="inline-block w-4 text-gray-500 text-xs">
                        {isExpanded ? '\u25BE' : '\u25B8'}
                      </span>
                      {opp.market.outcome}
                      {isForecast && <ForecastBadge />}
                    </td>
                    <td className="px-3 py-1.5 text-center text-sm text-gray-300">
                      {(opp.marketPrice * 100).toFixed(0)}&cent;
                    </td>
                    <td className="px-3 py-1.5 text-center text-sm font-semibold text-amber-400">
                      {(opp.modelProbability * 100).toFixed(1)}%
                    </td>
                    <td className="px-3 py-1.5 text-center">
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
                    <td className="px-3 py-1.5 text-center">
                      {isActionable ? (
                        <SignalBadge signal={opp.signal} />
                      ) : (
                        <span className="text-xs text-gray-600">&mdash;</span>
                      )}
                    </td>
                  </tr>
                  {isExpanded && <DetailRow opp={opp} />}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Forecast bracket footer callout */}
      {group.forecastBracketIndex !== null && (
        <div className="px-3 py-2 bg-gray-900/30 border-t border-gray-700/30 text-xs text-gray-400">
          <span className="text-amber-400 font-semibold">Forecast bracket:</span>{' '}
          {group.brackets[group.forecastBracketIndex].market.outcome}{' '}
          @ {(group.brackets[group.forecastBracketIndex].marketPrice * 100).toFixed(0)}&cent;
        </div>
      )}

      {/* Best-edge footer callout */}
      {group.bestEdge && (
        <div className="px-3 py-2 bg-gray-900/30 border-t border-gray-700/30 text-xs text-gray-400">
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

      {/* Mobile card view */}
      <div className="md:hidden p-3 space-y-3">
        {opportunities.map((opp) => (
          <div key={opp.market.id} className="bg-gray-900/30 border border-gray-700/30 rounded-lg p-3 space-y-2">
            <div className="text-sm font-medium text-white">{opp.market.id}</div>
            <div className="text-xs text-gray-400">{opp.market.outcome}</div>
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span className="text-gray-400">Model <span className="text-amber-400 font-semibold">{(opp.modelProbability * 100).toFixed(1)}%</span></span>
              <span className={`font-semibold ${opp.edge >= 0.15 ? 'text-green-400' : opp.edge >= 0.10 ? 'text-yellow-400' : 'text-gray-400'}`}>
                Edge {(opp.edge * 100).toFixed(1)}%
              </span>
              <SignalBadge signal={opp.signal} />
              <span className={`font-semibold ${opp.expectedValue > 0 ? 'text-green-400' : 'text-red-400'}`}>
                EV ${opp.expectedValue.toFixed(2)}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop table view */}
      <div className="max-md:hidden overflow-x-auto">
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
        Showing opportunities with edge &ge;5%. EV calculated for $100 position size with {(DEFAULT_FEE_RATE * 100).toFixed(0)}% all-in fees.
      </div>
    </div>
  )
}

// ============================================================================
// Main Component
// ============================================================================

function EmptyState({ totalMarketsCount, allWithinBuffer }: { totalMarketsCount?: number; allWithinBuffer?: boolean }) {
  let message: string
  if (allWithinBuffer) {
    message = 'All markets are within the 12-hour buffer zone. Trading signals are paused near resolution.'
  } else if (totalMarketsCount != null && totalMarketsCount > 0) {
    message = `${totalMarketsCount} markets active, but no edge above 5%. Markets refresh every 5 minutes.`
  } else {
    message = 'No active markets found for this city. Check back when new markets open.'
  }

  return (
    <div className="bg-black/40 border border-gray-700/50 rounded-xl overflow-hidden">
      <div className="p-6">
        <h3 className="text-lg font-semibold mb-4 text-white">Market Opportunities</h3>
        <div className="text-center py-8 text-gray-400">{message}</div>
      </div>
    </div>
  )
}

export function MarketOpportunitiesTable({ opportunities, eventGroups, totalMarketsCount, allWithinBuffer }: MarketOpportunitiesTableProps) {
  // Use event-grouped cards if available
  if (eventGroups && eventGroups.length > 0) {
    return (
      <div className="space-y-3">
        <h3 className="text-lg font-semibold text-white">
          Market Opportunities ({eventGroups.length} events)
        </h3>
        {eventGroups.map((group) => (
          <EventCard key={group.eventTicker} group={group} />
        ))}
        <div className="text-xs text-gray-400 mt-2">
          Highlighted rows have edge &ge;5%. EV calculated for $100 position size with {(DEFAULT_FEE_RATE * 100).toFixed(0)}% all-in fees.
        </div>
      </div>
    )
  }

  // Fallback to flat table
  if (!opportunities || opportunities.length === 0) {
    return <EmptyState totalMarketsCount={totalMarketsCount} allWithinBuffer={allWithinBuffer} />
  }

  return <FlatTable opportunities={opportunities} />
}
