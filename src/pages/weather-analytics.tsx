// Weather Intelligence Validation Dashboard
// Surfaces model calibration, Brier Skill Score, and P&L simulation

import { useState, useMemo } from 'react'
import Layout from '@/components/Layout'
import { useAnalytics } from '@/hooks/useAnalytics'
import type { PnLGroupSummary } from '@/hooks/useAnalytics'
import ReliabilityDiagram, { ReliabilityDiagramSkeleton } from '@/components/charts/ReliabilityDiagram'
import ROICurve, { ROICurveSkeleton } from '@/components/charts/ROICurve'
import EdgeDistribution, { EdgeDistributionSkeleton } from '@/components/charts/EdgeDistribution'

type PnLTab = 'city' | 'type' | 'lead'
type DatePreset = 'all' | '7d' | '30d' | 'post-fix'

const DATE_PRESETS: { key: DatePreset; label: string }[] = [
  { key: 'all', label: 'All Time' },
  { key: '7d', label: '7d' },
  { key: '30d', label: '30d' },
  { key: 'post-fix', label: 'Post-Fix' },
]

// 2026-03-13 00:00:00 UTC — tail guard + weight shift deployed
const POST_FIX_EPOCH = new Date('2026-03-13T00:00:00Z').getTime()

function SummaryCard({ label, value, subtitle, color }: {
  label: string
  value: string
  subtitle?: string
  color?: 'green' | 'red' | 'default'
}) {
  const valueColor = color === 'green'
    ? 'text-green-400'
    : color === 'red'
    ? 'text-red-400'
    : 'text-white'

  return (
    <div className="bg-black/40 border border-gray-700/50 rounded-xl p-4">
      <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">{label}</div>
      <div className={`text-2xl font-bold ${valueColor}`}>{value}</div>
      {subtitle && <div className="text-xs text-gray-400 mt-1">{subtitle}</div>}
    </div>
  )
}

function PnLTable({ data }: { data: PnLGroupSummary[] }) {
  if (data.length === 0) {
    return <div className="text-center py-6 text-gray-500 text-sm">No data</div>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-gray-500 border-b border-gray-700/50">
            <th className="text-left py-2 pr-3 font-medium">Group</th>
            <th className="text-right py-2 px-2 font-medium">Trades</th>
            <th className="text-right py-2 px-2 font-medium">Win Rate</th>
            <th className="text-right py-2 px-2 font-medium">Gross</th>
            <th className="text-right py-2 px-2 font-medium">Fees</th>
            <th className="text-right py-2 pl-2 font-medium">Net P&L</th>
          </tr>
        </thead>
        <tbody>
          {data.map(row => (
            <tr key={row.key} className="border-b border-gray-800/30">
              <td className="py-2 pr-3 text-white font-medium">{row.key}</td>
              <td className="py-2 px-2 text-right text-gray-300">{row.trades}</td>
              <td className="py-2 px-2 text-right text-gray-300">
                {(row.winRate * 100).toFixed(0)}%
              </td>
              <td className="py-2 px-2 text-right text-gray-300">
                {row.grossProfit >= 0 ? '+' : ''}{row.grossProfit.toFixed(2)}
              </td>
              <td className="py-2 px-2 text-right text-gray-400">
                -{row.totalFees.toFixed(2)}
              </td>
              <td className={`py-2 pl-2 text-right font-medium ${row.netProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {row.netProfit >= 0 ? '+' : ''}{row.netProfit.toFixed(2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function WeatherAnalytics() {
  const [datePreset, setDatePreset] = useState<DatePreset>('all')
  const since = useMemo(() => {
    const now = Date.now()
    switch (datePreset) {
      case '7d': return now - 7 * 86_400_000
      case '30d': return now - 30 * 86_400_000
      case 'post-fix': return POST_FIX_EPOCH
      default: return undefined
    }
  }, [datePreset])

  const { data, error, isLoading } = useAnalytics(since)
  const [pnlTab, setPnlTab] = useState<PnLTab>('city')

  const pnlTabData: PnLGroupSummary[] | undefined = data
    ? pnlTab === 'city'
      ? data.pnlBreakdown.byCity
      : pnlTab === 'type'
      ? data.pnlBreakdown.byMarketType
      : data.pnlBreakdown.byLeadBucket
    : undefined

  const bssColor = data
    ? data.snapshot.brierSkillScore > 0 ? 'green' : 'red'
    : 'default'

  return (
    <Layout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-white">Model Validation</h1>
          <div className="flex items-center gap-3">
            <div className="flex gap-1">
              {DATE_PRESETS.map(p => (
                <button
                  key={p.key}
                  onClick={() => setDatePreset(p.key)}
                  className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                    datePreset === p.key
                      ? 'bg-amber-600/30 text-amber-400 border border-amber-600/40'
                      : 'text-gray-400 hover:text-gray-300 border border-transparent'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {data && (
              <span className="text-xs text-gray-500">
                Updated {new Date(data.snapshot.timestamp).toLocaleTimeString()}
              </span>
            )}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-900/20 border border-red-800/50 rounded-xl p-5 text-red-400 text-sm">
            Failed to load analytics: {error.message}
          </div>
        )}

        {/* Row 1: Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-black/40 border border-gray-700/50 rounded-xl p-4 animate-pulse">
                <div className="h-3 w-20 bg-gray-700 rounded mb-3" />
                <div className="h-7 w-16 bg-gray-700 rounded" />
              </div>
            ))
          ) : data ? (
            <>
              <SummaryCard
                label="Brier Skill Score"
                value={data.snapshot.brierSkillScore.toFixed(3)}
                subtitle={data.snapshot.brierSkillScore > 0 ? 'Beats market' : 'Below market'}
                color={bssColor}
              />
              <SummaryCard
                label="Win Rate"
                value={`${(data.snapshot.winRate * 100).toFixed(1)}%`}
                subtitle={`${data.snapshot.resolvedSignals} resolved`}
              />
              <SummaryCard
                label="Resolved Trades"
                value={String(data.snapshot.resolvedSignals)}
                subtitle={`${data.trades.length} in P&L window`}
              />
              <SummaryCard
                label="Model Status"
                value={data.snapshot.modelDecay ? 'Decay' : 'Healthy'}
                subtitle={`Brier: ${data.snapshot.brierScore.toFixed(3)}`}
                color={data.snapshot.modelDecay ? 'red' : 'green'}
              />
            </>
          ) : null}
        </div>

        {/* Row 2: Reliability + ROI */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Reliability Diagram */}
          <div className="bg-black/40 border border-gray-700/50 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-gray-300 mb-4">Reliability Curve</h2>
            {isLoading ? (
              <ReliabilityDiagramSkeleton />
            ) : data ? (
              data.reliabilitySampleSize < 30 ? (
                <div className="text-center py-8 text-gray-500 text-sm">
                  Not enough resolved predictions for reliability analysis
                  <br />
                  <span className="text-gray-600">({data.reliabilitySampleSize}/30 minimum)</span>
                </div>
              ) : (
                <>
                  {data.reliabilitySampleSize < 50 && (
                    <div className="mb-3 px-3 py-2 bg-amber-900/20 border border-amber-700/30 rounded-lg text-xs text-amber-400">
                      Calibration may not be stable yet — need 50+ resolved predictions
                    </div>
                  )}
                  <ReliabilityDiagram
                    bins={data.reliabilityBins}
                    sampleSize={data.reliabilitySampleSize}
                  />
                </>
              )
            ) : null}
          </div>

          {/* ROI Curve */}
          <div className="bg-black/40 border border-gray-700/50 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-gray-300 mb-4">Cumulative P&L</h2>
            {isLoading ? (
              <ROICurveSkeleton />
            ) : data && data.trades.length > 0 ? (
              <ROICurve trades={data.trades} />
            ) : (
              <div className="text-center py-8 text-gray-500 text-sm">No resolved trades</div>
            )}
          </div>
        </div>

        {/* Row 3: Edge Distribution + P&L Table */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Edge Distribution */}
          <div className="bg-black/40 border border-gray-700/50 rounded-xl p-5">
            <h2 className="text-sm font-semibold text-gray-300 mb-4">Edge Distribution</h2>
            {isLoading ? (
              <EdgeDistributionSkeleton />
            ) : data && data.trades.length > 0 ? (
              <EdgeDistribution trades={data.trades} />
            ) : (
              <div className="text-center py-8 text-gray-500 text-sm">No resolved trades</div>
            )}
          </div>

          {/* P&L Breakdown Table */}
          <div className="bg-black/40 border border-gray-700/50 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-300">P&L Breakdown</h2>
              <div className="flex gap-1">
                {([
                  { key: 'city', label: 'City' },
                  { key: 'type', label: 'Type' },
                  { key: 'lead', label: 'Lead' },
                ] as const).map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => setPnlTab(tab.key)}
                    className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                      pnlTab === tab.key
                        ? 'bg-amber-600/30 text-amber-400 border border-amber-600/40'
                        : 'text-gray-400 hover:text-gray-300 border border-transparent'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>
            {isLoading ? (
              <div className="animate-pulse space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="h-4 bg-gray-700 rounded" />
                ))}
              </div>
            ) : pnlTabData && pnlTabData.length > 0 ? (
              <>
                <PnLTable data={pnlTabData} />
                {data && (
                  <div className="mt-3 pt-3 border-t border-gray-700/50 flex justify-between text-xs">
                    <span className="text-gray-500">Overall</span>
                    <span className={`font-medium ${data.pnlBreakdown.overall.netProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {data.pnlBreakdown.overall.netProfit >= 0 ? '+' : ''}
                      {data.pnlBreakdown.overall.netProfit.toFixed(2)} net
                    </span>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-8 text-gray-500 text-sm">No resolved trades</div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  )
}
