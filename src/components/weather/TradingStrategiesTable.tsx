// Trading Strategies Table
// Classifies weather market opportunities into intuitive strategy types
// Derives all data from existing eventGroups — no new data fetching

import { useMemo } from 'react'
import type { WeatherOpportunity, EventGroup } from '@/hooks/useWeatherOpportunities'
import Card from '@/components/Card'

// ============================================================================
// Types
// ============================================================================

type StrategyType = 'EDGE_HUNT' | 'FORECAST_PLAY' | 'TAIL_SELL'

interface StrategyPick {
  type: StrategyType
  opportunity: WeatherOpportunity
  eventGroup: EventGroup
  action: 'BUY_YES' | 'BUY_NO'
  rationale: string
  marketType?: string
}

interface TradingStrategiesTableProps {
  eventGroups: EventGroup[]
}

// ============================================================================
// Strategy Classification
// ============================================================================

function classifyStrategies(eventGroups: EventGroup[]): StrategyPick[] {
  const picks: StrategyPick[] = []

  for (const group of eventGroups) {
    // 1. EDGE_HUNT: best edge bracket per event, edge >= 10%, signal !== HOLD
    if (group.bestEdge && group.bestEdge.edge >= 0.10 && group.bestEdge.signal !== 'HOLD') {
      const opp = group.bestEdge
      const action: 'BUY_YES' | 'BUY_NO' = opp.modelProbability > opp.marketPrice ? 'BUY_YES' : 'BUY_NO'
      picks.push({
        type: 'EDGE_HUNT',
        opportunity: opp,
        eventGroup: group,
        action,
        rationale: `Model ${(opp.modelProbability * 100).toFixed(0)}% vs Market ${(opp.marketPrice * 100).toFixed(0)}% — ${(opp.edge * 100).toFixed(0)}% edge`,
        marketType: group.marketType,
      })
    }

    // 2. FORECAST_PLAY: forecast bracket, model > market (YES direction), edge >= 5%
    if (group.forecastBracketIndex !== null) {
      const opp = group.brackets[group.forecastBracketIndex]
      if (opp && opp.modelProbability > opp.marketPrice && opp.edge >= 0.05) {
        const rationale = group.forecastBracketExact
          ? `Forecast ${group.modelForecast.toFixed(1)}°F lands in this bracket`
          : `Forecast ${group.modelForecast.toFixed(1)}°F — nearest available bracket`
        picks.push({
          type: 'FORECAST_PLAY',
          opportunity: opp,
          eventGroup: group,
          action: 'BUY_YES',
          rationale,
          marketType: group.marketType,
        })
      }
    }

    // 3. TAIL_SELL: non-forecast brackets, 2+ away from forecast, model < market, edge >= 5%
    if (group.forecastBracketIndex !== null) {
      let bestTail: { opp: WeatherOpportunity; distance: number } | null = null
      for (let i = 0; i < group.brackets.length; i++) {
        const opp = group.brackets[i]
        if (opp.isForecastBracket) continue
        const distance = Math.abs(i - group.forecastBracketIndex!)
        if (distance < 2) continue
        if (opp.modelProbability >= opp.marketPrice) continue
        if (opp.edge < 0.05) continue
        if (!bestTail || opp.edge > bestTail.opp.edge) {
          bestTail = { opp, distance }
        }
      }
      if (bestTail) {
        picks.push({
          type: 'TAIL_SELL',
          opportunity: bestTail.opp,
          eventGroup: group,
          action: 'BUY_NO',
          rationale: `Model ${(bestTail.opp.modelProbability * 100).toFixed(0)}% vs Market ${(bestTail.opp.marketPrice * 100).toFixed(0)}% — ${bestTail.distance} brackets from forecast`,
          marketType: group.marketType,
        })
      }
    }
  }

  // Deduplicate by market.id — priority: EDGE_HUNT > FORECAST_PLAY > TAIL_SELL
  const priorityMap: Record<StrategyType, number> = { EDGE_HUNT: 0, FORECAST_PLAY: 1, TAIL_SELL: 2 }
  const seen = new Map<string, StrategyPick>()
  for (const pick of picks) {
    const id = pick.opportunity.market.id
    const existing = seen.get(id)
    if (!existing || priorityMap[pick.type] < priorityMap[existing.type]) {
      seen.set(id, pick)
    }
  }

  // Sort by expectedValue descending, limit to top 8
  return Array.from(seen.values())
    .sort((a, b) => b.opportunity.expectedValue - a.opportunity.expectedValue)
    .slice(0, 8)
}

// ============================================================================
// Sub-components
// ============================================================================

const STRATEGY_STYLES: Record<StrategyType, { label: string; className: string }> = {
  EDGE_HUNT: { label: 'Edge Hunt', className: 'bg-green-500/20 text-green-400' },
  FORECAST_PLAY: { label: 'Forecast Play', className: 'bg-cyan-500/20 text-cyan-400' },
  TAIL_SELL: { label: 'Tail Sell', className: 'bg-purple-500/20 text-purple-400' },
}

function tempTypeLabel(marketType?: string): string | null {
  if (!marketType) return null
  if (marketType.includes('low')) return 'Low'
  if (marketType.includes('high')) return 'High'
  return null
}

function StrategyBadge({ type, marketType }: { type: StrategyType; marketType?: string }) {
  const style = STRATEGY_STYLES[type]
  const temp = tempTypeLabel(marketType)
  return (
    <span className={`px-2 py-0.5 rounded-md text-caption font-semibold ${style.className}`}>
      {style.label}{temp ? ` \u00b7 ${temp}` : ''}
    </span>
  )
}

function ActionBadge({ action }: { action: 'BUY_YES' | 'BUY_NO' }) {
  if (action === 'BUY_YES') {
    return (
      <span className="px-2 py-0.5 rounded-md text-caption font-semibold bg-green-500/20 text-green-400">
        BUY YES
      </span>
    )
  }
  return (
    <span className="px-2 py-0.5 rounded-md text-caption font-semibold bg-red-500/20 text-red-400">
      BUY NO
    </span>
  )
}

function formatMarketLabel(pick: StrategyPick): string {
  const { eventGroup, opportunity } = pick
  const city = eventGroup.city.length > 3 ? eventGroup.city : eventGroup.city
  return `${city} ${opportunity.market.outcome} · ${eventGroup.date}`
}

function edgeColor(edge: number): string {
  if (edge >= 0.15) return 'text-green-400'
  if (edge >= 0.10) return 'text-yellow-400'
  return 'text-amber-400'
}

function StrategyCard({ pick }: { pick: StrategyPick }) {
  const ev = pick.opportunity.expectedValue
  return (
    <div className="bg-gray-900/30 border border-green-900/30 rounded-lg p-3 space-y-2">
      <div className="flex items-center gap-2">
        <StrategyBadge type={pick.type} marketType={pick.marketType} />
        <ActionBadge action={pick.action} />
      </div>
      <div className="text-body text-gray-300">
        {formatMarketLabel(pick)}
      </div>
      <div className="flex items-center gap-4">
        <span className={`text-body font-semibold ${edgeColor(pick.opportunity.edge)}`}>
          Edge: {(pick.opportunity.edge * 100).toFixed(1)}%
        </span>
        <span className={`text-body font-semibold ${ev > 0 ? 'text-green-400' : 'text-red-400'}`}>
          EV: {ev > 0 ? '+' : ''}${ev.toFixed(2)}
        </span>
      </div>
      <div className="text-caption text-gray-400">
        {pick.rationale}
      </div>
    </div>
  )
}

// ============================================================================
// Main Component
// ============================================================================

export function TradingStrategiesTable({ eventGroups }: TradingStrategiesTableProps) {
  const picks = useMemo(() => classifyStrategies(eventGroups), [eventGroups])

  // Don't render at all if no event groups
  if (!eventGroups || eventGroups.length === 0) return null

  return (
    <Card noPadding className="overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-gray-700/30 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-subhead font-semibold text-white">Trading Strategies</h3>
          {picks.length > 0 && (
            <span className="px-2 py-0.5 rounded-full text-caption font-semibold bg-blue-500/15 text-blue-400">
              {picks.length}
            </span>
          )}
        </div>
      </div>

      {picks.length === 0 ? (
        /* Empty state */
        <div className="text-center py-8 px-4 text-gray-400 text-body">
          No strategies meet minimum criteria right now. Markets refresh every 5 minutes.
        </div>
      ) : (
        <>
        {/* Mobile card view */}
        <div className="md:hidden p-3 space-y-3">
          {picks.map((pick) => (
            <StrategyCard key={pick.opportunity.market.id} pick={pick} />
          ))}
        </div>

        {/* Desktop table view */}
        <div className="max-md:hidden overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-900/50 border-b border-gray-700/50">
              <tr>
                <th className="px-4 py-2 text-left text-caption font-semibold text-gray-400 uppercase tracking-wider">
                  Strategy
                </th>
                <th className="px-4 py-2 text-left text-caption font-semibold text-gray-400 uppercase tracking-wider">
                  Market
                </th>
                <th className="px-4 py-2 text-center text-caption font-semibold text-gray-400 uppercase tracking-wider">
                  Action
                </th>
                <th className="px-4 py-2 text-center text-caption font-semibold text-gray-400 uppercase tracking-wider">
                  Edge
                </th>
                <th className="px-4 py-2 text-right text-caption font-semibold text-gray-400 uppercase tracking-wider">
                  EV ($100)
                </th>
                <th className="px-4 py-2 text-left text-caption font-semibold text-gray-400 uppercase tracking-wider">
                  Rationale
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/30">
              {picks.map((pick) => {
                const ev = pick.opportunity.expectedValue
                return (
                  <tr
                    key={pick.opportunity.market.id}
                    className="hover:bg-gray-800/30 transition-colors"
                  >
                    <td className="px-4 py-2.5">
                      <StrategyBadge type={pick.type} marketType={pick.marketType} />
                    </td>
                    <td className="px-4 py-2.5 text-body text-gray-300 whitespace-nowrap">
                      {formatMarketLabel(pick)}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <ActionBadge action={pick.action} />
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={`text-body font-semibold ${edgeColor(pick.opportunity.edge)}`}>
                        {(pick.opportunity.edge * 100).toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className={`text-body font-semibold ${ev > 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {ev > 0 ? '+' : ''}${ev.toFixed(2)}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-caption text-gray-400 max-w-[220px] truncate">
                      {pick.rationale}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        </>
      )}
    </Card>
  )
}
