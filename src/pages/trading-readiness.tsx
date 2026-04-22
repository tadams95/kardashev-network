// Trading Readiness Dashboard
// Answers: "Are we ready to go live with real money?"
// Two strategies tracked independently: Tail Sells (first automation candidate) and Sweet Spot (20-40¢ NO)

import Layout from '@/components/Layout'
import { useTradingReadiness } from '@/hooks/useTradingReadiness'
import type { TailSellGates, SignalRow, NECorrelationDay, SweetSpotGates } from '@/hooks/useTradingReadiness'

// ============================================================================
// Gate Progress Row
// ============================================================================

function GateRow({ label, met, detail, progress }: {
  label: string
  met: boolean
  detail: string
  progress?: { current: number; target: number }
}) {
  const pct = progress
    ? Math.min(100, (progress.current / progress.target) * 100)
    : undefined

  return (
    <div className="flex items-center gap-3 py-3 border-b border-gray-800/30 last:border-0">
      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
        met ? 'bg-green-500/20 text-green-400' : 'bg-gray-700/30 text-gray-500'
      }`}>
        {met ? '\u2713' : '\u2717'}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-white">{label}</div>
        <div className="text-xs text-gray-500 truncate">{detail}</div>
      </div>
      {pct !== undefined && (
        <div className="w-24 shrink-0">
          <div className="w-full bg-gray-800 rounded-full h-1.5">
            <div
              className={`h-1.5 rounded-full transition-all ${met ? 'bg-green-500' : 'bg-amber-500'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}
      <div className={`text-xs font-mono shrink-0 w-16 text-right ${
        met ? 'text-green-400' : 'text-gray-500'
      }`}>
        {progress ? `${progress.current}/${progress.target}` : met ? 'PASS' : 'PENDING'}
      </div>
    </div>
  )
}

// ============================================================================
// Tail Sell Gates Section
// ============================================================================

function TailSellGatesSection({ gates }: { gates: TailSellGates }) {
  const d2Detail = gates.winRateD2.current !== null
    ? `${(gates.winRateD2.current * 100).toFixed(0)}% on ${gates.winRateD2.resolved} resolved (need ${gates.winRateD2.minSample}+)`
    : `No resolved \u00b12 signals yet (need ${gates.winRateD2.minSample}+)`

  const d3Detail = gates.winRateD3.current !== null
    ? `${(gates.winRateD3.current * 100).toFixed(0)}% on ${gates.winRateD3.resolved} resolved (need ${gates.winRateD3.minSample}+)`
    : `No resolved \u00b13 signals yet (need ${gates.winRateD3.minSample}+)`

  const lossDetail = gates.survivedLoss.hasLoss
    ? gates.survivedLoss.cumulativePnlPositive
      ? 'Loss observed, cumulative P&L still positive'
      : 'Loss observed but cumulative P&L is negative'
    : 'No losses observed yet — need to see failure mode'

  const neDetail = gates.neCorridorValidated.multiCityDays > 0
    ? `${gates.neCorridorValidated.multiCityDays} multi-city days, ${gates.neCorridorValidated.resolvedDays} fully resolved`
    : 'No multi-city NE corridor days observed'

  return (
    <div className="bg-black/40 border border-gray-700/50 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-gray-300 mb-2">Go-Live Gates</h3>
      <GateRow
        label="Resolved signals"
        met={gates.resolvedCount.met}
        detail={`${gates.resolvedCount.current} resolved — need 100+ for statistical confidence`}
        progress={{ current: gates.resolvedCount.current, target: gates.resolvedCount.target }}
      />
      <GateRow
        label={`\u00b12 bracket win rate \u2265 ${(gates.winRateD2.target * 100).toFixed(0)}%`}
        met={gates.winRateD2.met}
        detail={d2Detail}
        progress={gates.winRateD2.resolved > 0
          ? { current: gates.winRateD2.resolved, target: gates.winRateD2.minSample }
          : undefined
        }
      />
      <GateRow
        label={`\u00b13 bracket win rate \u2265 ${(gates.winRateD3.target * 100).toFixed(0)}%`}
        met={gates.winRateD3.met}
        detail={d3Detail}
        progress={gates.winRateD3.resolved > 0
          ? { current: gates.winRateD3.resolved, target: gates.winRateD3.minSample }
          : undefined
        }
      />
      <GateRow
        label="Survived a loss event"
        met={gates.survivedLoss.met}
        detail={lossDetail}
      />
      <GateRow
        label="NE corridor correlation validated"
        met={gates.neCorridorValidated.met}
        detail={neDetail}
      />
      <GateRow
        label="Live Kalshi execution"
        met={gates.executionDryRun.met}
        detail="Auto-executing via Kalshi Trading API since 2026-04-01"
      />
    </div>
  )
}

// ============================================================================
// Signal Audit Table
// ============================================================================

function SignalTable({ signals }: { signals: SignalRow[] }) {
  if (signals.length === 0) {
    return <div className="text-center py-6 text-gray-500 text-sm">No signals yet</div>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-gray-500 border-b border-gray-700/50">
            <th className="text-left py-2 pr-2 font-medium">Date</th>
            <th className="text-left py-2 px-2 font-medium">City</th>
            <th className="text-center py-2 px-2 font-medium">Type</th>
            <th className="text-left py-2 px-2 font-medium">Bracket</th>
            <th className="text-right py-2 px-2 font-medium">\u00b1</th>
            <th className="text-right py-2 px-2 font-medium">Forecast</th>
            <th className="text-right py-2 px-2 font-medium">Actual</th>
            <th className="text-right py-2 px-2 font-medium">YES$</th>
            <th className="text-center py-2 px-2 font-medium">Result</th>
            <th className="text-right py-2 pl-2 font-medium">P&L</th>
          </tr>
        </thead>
        <tbody>
          {signals.map(s => (
            <tr
              key={s.id}
              className={`border-b border-gray-800/30 ${
                s.result === 'loss' ? 'bg-red-900/10' : ''
              }`}
            >
              <td className="py-2 pr-2 text-gray-400 whitespace-nowrap">
                {new Date(s.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </td>
              <td className="py-2 px-2 text-white font-medium">
                {s.cityCode}
                {s.isNECorridor && (
                  <span className="ml-1 text-[10px] text-blue-400">NE</span>
                )}
              </td>
              <td className="py-2 px-2 text-center">
                <span className={`font-semibold ${s.temperatureType === 'low' ? 'text-blue-400' : 'text-orange-400'}`}>
                  {s.temperatureType === 'low' ? 'L' : 'H'}
                </span>
              </td>
              <td className="py-2 px-2 text-gray-300">{s.bracket}</td>
              <td className="py-2 px-2 text-right text-gray-400">{s.bracketDistance}</td>
              <td className="py-2 px-2 text-right text-gray-300">
                {s.forecastF.toFixed(1)}&deg;
              </td>
              <td className="py-2 px-2 text-right text-gray-300">
                {s.actualF != null ? `${s.actualF.toFixed(1)}\u00b0` : '\u2014'}
              </td>
              <td className="py-2 px-2 text-right text-gray-300">
                {(s.yesPrice * 100).toFixed(0)}\u00a2
              </td>
              <td className="py-2 px-2 text-center">
                {s.result === 'win' ? (
                  <span className="text-green-400 font-medium">WIN</span>
                ) : s.result === 'loss' ? (
                  <span className="text-red-400 font-medium">LOSS</span>
                ) : (
                  <span className="text-amber-400">\u23f3</span>
                )}
              </td>
              <td className={`py-2 pl-2 text-right font-mono ${
                s.dollarPnl == null ? 'text-gray-600'
                  : s.dollarPnl >= 0 ? 'text-green-400' : 'text-red-400'
              }`}>
                {s.dollarPnl != null ? `${s.dollarPnl >= 0 ? '+' : ''}$${s.dollarPnl.toFixed(2)}` : '\u2014'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ============================================================================
// NE Corridor Correlation Table
// ============================================================================

function NECorrelationTable({ days }: { days: NECorrelationDay[] }) {
  if (days.length === 0) {
    return <div className="text-center py-6 text-gray-500 text-sm">No multi-city NE corridor days observed</div>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-gray-500 border-b border-gray-700/50">
            <th className="text-left py-2 pr-2 font-medium">Date</th>
            <th className="text-left py-2 px-2 font-medium">Cities</th>
            <th className="text-right py-2 px-2 font-medium">Signals</th>
            <th className="text-right py-2 px-2 font-medium">Wins</th>
            <th className="text-right py-2 px-2 font-medium">Losses</th>
            <th className="text-center py-2 px-2 font-medium">Correlated?</th>
            <th className="text-right py-2 pl-2 font-medium">P&L</th>
          </tr>
        </thead>
        <tbody>
          {days.map(d => (
            <tr key={d.date} className="border-b border-gray-800/30">
              <td className="py-2 pr-2 text-gray-400">{d.date}</td>
              <td className="py-2 px-2 text-white">{d.cities.join(', ')}</td>
              <td className="py-2 px-2 text-right text-gray-300">{d.signals}</td>
              <td className="py-2 px-2 text-right text-green-400">{d.wins}</td>
              <td className="py-2 px-2 text-right text-red-400">{d.losses}</td>
              <td className="py-2 px-2 text-center">
                {d.allSameOutcome === null ? (
                  <span className="text-gray-500">pending</span>
                ) : d.allSameOutcome ? (
                  <span className="text-amber-400">yes</span>
                ) : (
                  <span className="text-gray-400">mixed</span>
                )}
              </td>
              <td className={`py-2 pl-2 text-right font-mono ${
                d.pnl >= 0 ? 'text-green-400' : 'text-red-400'
              }`}>
                {d.resolved > 0 ? `${d.pnl >= 0 ? '+' : ''}$${d.pnl.toFixed(2)}` : '\u2014'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ============================================================================
// Sweet Spot Gates
// ============================================================================

function SweetSpotSection({ gates, status, allGatesMet }: {
  gates: SweetSpotGates
  status: string
  allGatesMet: boolean
}) {
  return (
    <div className="bg-black/40 border border-gray-700/50 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-gray-300 mb-2">Go-Live Gates</h3>
      <GateRow
        label="BSS > 0 in 20\u201340\u00a2 range"
        met={gates.bssAboveZero.met}
        detail={gates.bssAboveZero.trades > 0
          ? `BSS ${gates.bssAboveZero.current >= 0 ? '+' : ''}${gates.bssAboveZero.current.toFixed(3)} on ${gates.bssAboveZero.trades} trades (need 50+)`
          : 'No trades in 20\u201340\u00a2 range'
        }
      />
      <GateRow
        label="Positive EV after fees"
        met={gates.positiveEvAfterFees.met}
        detail={gates.positiveEvAfterFees.trades > 0
          ? `Net P&L: ${gates.positiveEvAfterFees.totalNetPnl >= 0 ? '+' : ''}$${gates.positiveEvAfterFees.totalNetPnl.toFixed(2)} (${gates.positiveEvAfterFees.trades} trades)`
          : 'No trades in range'
        }
      />
      <GateRow
        label="Active signal generation"
        met={gates.signalGeneration.met}
        detail={gates.signalGeneration.description}
      />
      <div className="mt-4 pt-3 border-t border-gray-700/50">
        <div className={`text-xs font-medium ${allGatesMet ? 'text-green-400' : 'text-gray-500'}`}>
          {status}
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Summary Card
// ============================================================================

function SummaryCard({ label, value, color }: {
  label: string
  value: string
  color?: 'green' | 'red' | 'amber' | 'default'
}) {
  const cls = color === 'green' ? 'text-green-400'
    : color === 'red' ? 'text-red-400'
    : color === 'amber' ? 'text-amber-400'
    : 'text-white'

  return (
    <div className="bg-black/40 border border-gray-700/50 rounded-xl p-4">
      <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">{label}</div>
      <div className={`text-xl font-bold ${cls}`}>{value}</div>
    </div>
  )
}

// ============================================================================
// Loading Skeleton
// ============================================================================

function Skeleton() {
  return (
    <div className="space-y-8 animate-pulse">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="bg-black/40 border border-gray-700/50 rounded-xl p-4">
            <div className="h-3 w-16 bg-gray-700 rounded mb-3" />
            <div className="h-6 w-12 bg-gray-700 rounded" />
          </div>
        ))}
      </div>
      <div className="bg-black/40 border border-gray-700/50 rounded-xl p-5">
        <div className="h-4 w-28 bg-gray-700 rounded mb-4" />
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 py-3">
            <div className="w-6 h-6 rounded-full bg-gray-700" />
            <div className="flex-1 h-4 bg-gray-700 rounded" />
          </div>
        ))}
      </div>
    </div>
  )
}

// ============================================================================
// Page
// ============================================================================

export default function TradingReadiness() {
  const { data, error, isLoading } = useTradingReadiness()
  const ts = data?.tailSells
  const ss = data?.sweetSpot

  const overallReady = ts?.allGatesMet && ss?.allGatesMet

  return (
    <Layout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-10">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Trading Readiness</h1>
            <p className="text-sm text-gray-500 mt-1">
              Are we ready to go live with real money?
            </p>
          </div>
          <div className="flex items-center gap-3">
            {ts && (
              <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                overallReady
                  ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                  : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
              }`}>
                {overallReady ? 'READY' : 'NOT READY'}
              </span>
            )}
            {data && (
              <span className="text-xs text-gray-500">
                Updated {new Date(data.timestamp).toLocaleTimeString()}
              </span>
            )}
          </div>
        </div>

        {error && (
          <div className="bg-red-900/20 border border-red-800/50 rounded-xl p-5 text-red-400 text-sm">
            Failed to load: {error.message}
          </div>
        )}

        {isLoading ? <Skeleton /> : ts && ss ? (
          <>
            {/* ============================================================ */}
            {/* SECTION 1: TAIL SELL STRATEGY */}
            {/* ============================================================ */}

            <div className="space-y-6">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-semibold text-white">Tail Sell Strategy</h2>
                <span className={`px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider ${
                  ts.allGatesMet
                    ? 'bg-green-500/20 text-green-400'
                    : 'bg-gray-700/30 text-gray-400'
                }`}>
                  {ts.allGatesMet ? 'Ready' : `${Object.values(ts.gates).filter(g => g.met).length}/${Object.keys(ts.gates).length} gates`}
                </span>
              </div>

              {/* Summary Cards */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <SummaryCard label="Total Signals" value={String(ts.summary.total)} />
                <SummaryCard label="Pending" value={String(ts.summary.pending)} color="amber" />
                <SummaryCard
                  label="Win Rate"
                  value={ts.summary.wins + ts.summary.losses > 0
                    ? `${((ts.summary.wins / (ts.summary.wins + ts.summary.losses)) * 100).toFixed(0)}%`
                    : '--'
                  }
                  color={ts.summary.wins + ts.summary.losses > 0 ? 'green' : 'default'}
                />
                <SummaryCard
                  label="W / L"
                  value={`${ts.summary.wins} / ${ts.summary.losses}`}
                  color={ts.summary.losses > 0 ? 'default' : 'green'}
                />
                <SummaryCard
                  label="P&L ($10/pos)"
                  value={`${ts.summary.totalPnl >= 0 ? '+' : ''}$${ts.summary.totalPnl.toFixed(2)}`}
                  color={ts.summary.totalPnl >= 0 ? 'green' : 'red'}
                />
              </div>

              {/* Rolling Win Rate */}
              {(ts.rollingWinRate.last20 !== null || ts.rollingWinRate.last50 !== null || ts.rollingWinRate.last100 !== null) && (
                <div className="flex gap-4">
                  {[
                    { label: 'Last 20', value: ts.rollingWinRate.last20 },
                    { label: 'Last 50', value: ts.rollingWinRate.last50 },
                    { label: 'Last 100', value: ts.rollingWinRate.last100 },
                  ].map(r => (
                    <div key={r.label} className="bg-black/40 border border-gray-700/50 rounded-lg px-4 py-2">
                      <span className="text-xs text-gray-500 mr-2">{r.label}</span>
                      <span className={`text-sm font-bold ${
                        r.value === null ? 'text-gray-600' : r.value >= 0.85 ? 'text-green-400' : 'text-amber-400'
                      }`}>
                        {r.value !== null ? `${(r.value * 100).toFixed(0)}%` : 'n/a'}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Go-Live Gates */}
              <TailSellGatesSection gates={ts.gates} />

              {/* Loss Events */}
              {ts.lossEvents.length > 0 && (
                <div className="bg-red-900/10 border border-red-800/30 rounded-xl p-5">
                  <h3 className="text-sm font-semibold text-red-400 mb-3">
                    Loss Events ({ts.lossEvents.length})
                  </h3>
                  <SignalTable signals={ts.lossEvents} />
                </div>
              )}

              {/* NE Corridor Correlation */}
              <div className="bg-black/40 border border-gray-700/50 rounded-xl p-5">
                <h3 className="text-sm font-semibold text-gray-300 mb-3">
                  NE Corridor Correlation
                  <span className="ml-2 text-xs font-normal text-gray-500">
                    BOS / NY / PHI / DC — same-day signals
                  </span>
                </h3>
                <NECorrelationTable days={ts.neCorrelation} />
              </div>

              {/* Signal Audit Trail */}
              <div className="bg-black/40 border border-gray-700/50 rounded-xl p-5">
                <h3 className="text-sm font-semibold text-gray-300 mb-3">
                  Signal Audit Trail
                  <span className="ml-2 text-xs font-normal text-gray-500">
                    {ts.signals.length} signals
                  </span>
                </h3>
                <SignalTable signals={ts.signals} />
              </div>
            </div>

            {/* ============================================================ */}
            {/* SECTION 2: SWEET SPOT STRATEGY */}
            {/* ============================================================ */}

            <div className="space-y-6">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-semibold text-white">Sweet Spot Strategy</h2>
                <span className="text-xs text-gray-500">20\u201340\u00a2 NO-only</span>
                <span className={`px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider ${
                  ss.allGatesMet
                    ? 'bg-green-500/20 text-green-400'
                    : 'bg-gray-700/30 text-gray-400'
                }`}>
                  {ss.allGatesMet ? 'Ready' : `${Object.values(ss.gates).filter(g => g.met).length}/${Object.keys(ss.gates).length} gates`}
                </span>
              </div>

              <SweetSpotSection gates={ss.gates} status={ss.status} allGatesMet={ss.allGatesMet} />
            </div>
          </>
        ) : null}
      </div>
    </Layout>
  )
}
