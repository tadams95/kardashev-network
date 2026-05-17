// Trading Readiness Dashboard
// Answers: "Are we ready to go live with real money?"
// Two strategies tracked independently: Tail Sells (first automation candidate) and Sweet Spot (20-40¢ NO)

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import Layout from '@/components/Layout'
import { useTradingReadiness } from '@/hooks/useTradingReadiness'
import type {
  TailSellGates,
  SignalRow,
  NECorrelationDay,
  TailSellQuadrantRow,
  OpenPositionRiskRow,
} from '@/hooks/useTradingReadiness'

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
// Daily P&L Calendar (last N days)
// ============================================================================

interface DailyBucket {
  date: string                // YYYY-MM-DD (market resolution date)
  total: number               // signals targeting this date
  pending: number
  wins: number
  losses: number
  pnl: number                 // sum of dollarPnl across resolved signals
}

function buildDailyBuckets(signals: CalendarSignal[], days: number): DailyBucket[] {
  // Build a date axis: today and the previous (days-1) days, in order
  // (oldest → newest, left → right). Use UTC to align with marketDate which
  // is parsed from event tickers.
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const dateAxis: string[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setUTCDate(today.getUTCDate() - i)
    dateAxis.push(d.toISOString().slice(0, 10))
  }

  const byDate = new Map<string, DailyBucket>()
  for (const date of dateAxis) {
    byDate.set(date, { date, total: 0, pending: 0, wins: 0, losses: 0, pnl: 0 })
  }

  for (const s of signals) {
    if (!s.marketDate) continue
    const bucket = byDate.get(s.marketDate)
    if (!bucket) continue   // outside the visible window
    bucket.total++
    if (s.result === 'win') {
      bucket.wins++
      if (s.dollarPnl != null) bucket.pnl += s.dollarPnl
    } else if (s.result === 'loss') {
      bucket.losses++
      if (s.dollarPnl != null) bucket.pnl += s.dollarPnl
    } else {
      bucket.pending++
    }
  }

  return dateAxis.map(d => byDate.get(d)!)
}

function formatShortDate(dateStr: string): { mon: string; day: string } {
  // 2026-04-28 → { mon: 'APR', day: '28' }
  const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC']
  const [, m, d] = dateStr.split('-')
  return { mon: months[parseInt(m, 10) - 1] ?? '???', day: d }
}

/** Format YYYY-MM-DD → "Apr 28" — matches the audit-table column style. */
function formatMarketDateShort(dateStr: string): string {
  const { mon, day } = formatShortDate(dateStr)
  return `${mon[0] + mon.slice(1).toLowerCase()} ${parseInt(day, 10)}`
}

/** Calendar input — minimal shape that SignalRow can satisfy via inline mapping.
 *  The calendar only needs marketDate, result, and (optionally) dollarPnl in 'pnl' mode. */
type CalendarSignal = {
  marketDate?: string | null
  result?: 'win' | 'loss' | 'pending' | null
  dollarPnl?: number | null
}

function DailyPnLCalendar({
  signals,
  selectedDate,
  onSelect,
  days = 14,
  valueMode = 'pnl',
}: {
  signals: CalendarSignal[]
  selectedDate: string | null
  onSelect: (date: string | null) => void
  days?: number
  /** 'pnl' = bottom row shows colored dollar P&L (default; tail-sell sections).
   *  'winrate' = bottom row shows win-rate percentage (probability-model section
   *  where dollarPnl isn't applicable). */
  valueMode?: 'pnl' | 'winrate'
}) {
  const buckets = useMemo(() => buildDailyBuckets(signals, days), [signals, days])

  return (
    <div className="bg-black/40 border border-gray-700/50 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
          Last {days} Days
        </div>
        {selectedDate && (
          <button
            onClick={() => onSelect(null)}
            className="text-[10px] font-medium text-amber-400 hover:text-amber-300 uppercase tracking-wider"
          >
            \u00d7 Clear filter
          </button>
        )}
      </div>
      <div className="grid grid-flow-col auto-cols-fr gap-1.5">
        {buckets.map(b => {
          const isSelected = selectedDate === b.date
          const isEmpty = b.total === 0
          const { mon, day } = formatShortDate(b.date)

          // Bottom-row value: dollar P&L (default) or win-rate percentage
          const resolved = b.wins + b.losses
          let valueStr: string
          let valueColor: string
          if (b.total === 0) {
            valueStr = '\u2014'
            valueColor = 'text-gray-500'
          } else if (valueMode === 'winrate') {
            if (resolved === 0) {
              valueStr = '\u2014'
              valueColor = 'text-gray-500'
            } else {
              const winPct = b.wins / resolved
              valueStr = `${(winPct * 100).toFixed(0)}%`
              valueColor = winPct >= 0.5 ? 'text-green-400'
                : winPct >= 0.3 ? 'text-amber-400'
                : 'text-red-400'
            }
          } else {
            valueStr = `${b.pnl >= 0 ? '+' : ''}$${b.pnl.toFixed(2)}`
            valueColor = b.pnl > 0 ? 'text-green-400'
              : b.pnl < 0 ? 'text-red-400'
              : 'text-gray-500'
          }

          return (
            <button
              key={b.date}
              onClick={() => onSelect(isSelected ? null : b.date)}
              disabled={isEmpty}
              className={`
                rounded-md p-2 text-left transition-all
                ${isSelected ? 'bg-amber-500/20 border border-amber-500/50' :
                  isEmpty ? 'bg-gray-900/40 border border-gray-800/40 cursor-default' :
                  'bg-gray-800/40 border border-gray-700/40 hover:border-gray-600/60 hover:bg-gray-800/60'}
              `}
            >
              <div className={`text-[9px] font-semibold uppercase tracking-wider ${isEmpty ? 'text-gray-600' : 'text-gray-500'}`}>
                {mon}
              </div>
              <div className={`text-base font-bold ${isEmpty ? 'text-gray-600' : 'text-gray-200'} leading-tight`}>
                {day}
              </div>
              <div className={`text-[10px] mt-1 ${isEmpty ? 'text-gray-600' : 'text-gray-400'}`}>
                {b.total === 0 ? '\u2014' : `${b.total} sig`}
              </div>
              <div className={`text-[10px] ${isEmpty ? 'text-gray-600' : 'text-gray-400'}`}>
                {b.total === 0 ? '\u00a0' : `${b.wins}W \u00b7 ${b.losses}L${b.pending > 0 ? ` \u00b7 ${b.pending}P` : ''}`}
              </div>
              <div className={`text-[11px] font-semibold mt-0.5 ${valueColor}`}>
                {valueStr}
              </div>
            </button>
          )
        })}
      </div>
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
            <th className="text-left py-2 pr-2 font-medium">Event</th>
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
                {s.marketDate
                  ? formatMarketDateShort(s.marketDate)
                  : new Date(s.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
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
                {s.actualF == null
                  ? '\u2014'
                  : s.actualFKind === 'le' ? `\u2264${s.actualF.toFixed(0)}\u00b0`
                  : s.actualFKind === 'ge' ? `\u2265${s.actualF.toFixed(0)}\u00b0`
                  : `${s.actualF.toFixed(1)}\u00b0`}
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
// Paginated Signal Table — render-prop wrapper
// ============================================================================

function PaginatedSignalTable<T>({
  signals,
  renderTable,
  pageSize = 25,
}: {
  signals: T[]
  renderTable: (subset: T[]) => ReactNode
  pageSize?: number
}) {
  const [visibleCount, setVisibleCount] = useState(pageSize)
  // Reset when underlying signals array identity changes (e.g., calendar filter changes)
  useEffect(() => { setVisibleCount(pageSize) }, [signals, pageSize])
  const visible = signals.slice(0, visibleCount)
  const remaining = signals.length - visibleCount

  return (
    <>
      {renderTable(visible)}
      {remaining > 0 && (
        <div className="flex items-center justify-between py-3 px-1 text-xs text-gray-500">
          <span>Showing {visibleCount} of {signals.length}</span>
          <div className="flex gap-3">
            <button
              onClick={() => setVisibleCount(c => c + pageSize)}
              className="text-amber-400 hover:text-amber-300"
            >
              Show {Math.min(pageSize, remaining)} more
            </button>
            <button
              onClick={() => setVisibleCount(signals.length)}
              className="text-gray-400 hover:text-gray-300"
            >
              Show all
            </button>
          </div>
        </div>
      )}
    </>
  )
}

// ============================================================================
// Four-Quadrant Tail-Sell Status Table (2026-05-04)
// ============================================================================

function ModeBadge({ mode }: { mode: 'live' | 'paper' | 'off' }) {
  if (mode === 'live') {
    return <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-900/40 text-green-300 border border-green-700/50">LIVE</span>
  }
  if (mode === 'paper') {
    return <span className="px-2 py-0.5 rounded text-xs font-medium bg-amber-900/30 text-amber-300 border border-amber-700/50 border-dashed">PAPER</span>
  }
  return <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-800/40 text-gray-500 border border-gray-700/50">OFF</span>
}

function FourQuadrantTable({ quadrants }: { quadrants: TailSellQuadrantRow[] }) {
  if (!quadrants || quadrants.length === 0) {
    return <div className="text-center py-6 text-gray-500 text-sm">Quadrant status unavailable</div>
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-gray-500 border-b border-gray-700/50">
            <th className="text-left py-2 pr-2 font-medium">Quadrant</th>
            <th className="text-center py-2 px-2 font-medium">Mode</th>
            <th className="text-right py-2 px-2 font-medium">Today</th>
            <th className="text-right py-2 px-2 font-medium">Open</th>
            <th className="text-right py-2 px-2 font-medium">Resolved</th>
            <th className="text-right py-2 px-2 font-medium">Win Rate</th>
            <th className="text-right py-2 pl-2 font-medium">Net P&L {/* dollar */}</th>
          </tr>
        </thead>
        <tbody>
          {quadrants.map(q => {
            const winPct = q.winRate != null ? `${(q.winRate * 100).toFixed(1)}%` : '—'
            const pnlClass = q.netPnl > 0 ? 'text-green-400' : q.netPnl < 0 ? 'text-red-400' : 'text-gray-500'
            const pnlPrefix = q.isReal ? '$' : '~$'
            return (
              <tr key={q.key} className="border-b border-gray-800/30">
                <td className="py-2 pr-2 text-white font-medium">{q.label}</td>
                <td className="py-2 px-2 text-center"><ModeBadge mode={q.mode} /></td>
                <td className="py-2 px-2 text-right text-gray-300">{q.signalsToday}</td>
                <td className="py-2 px-2 text-right text-gray-300">{q.openPositions}</td>
                <td className="py-2 px-2 text-right text-gray-300">{q.resolvedTotal}</td>
                <td className="py-2 px-2 text-right text-gray-300">{winPct}</td>
                <td className={`py-2 pl-2 text-right font-mono ${pnlClass}`}>
                  {q.resolvedTotal > 0
                    ? `${q.netPnl >= 0 ? '+' : ''}${pnlPrefix}${Math.abs(q.netPnl).toFixed(2)}`
                    : '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="mt-2 text-xs text-gray-500 leading-relaxed">
        Cold-side high is the live earning strategy; the other three are paper-mode for forward data
        gathering. Paper P&L (prefixed <code className="text-gray-400">~$</code>) represents
        hypothetical performance had we traded; only cold-side high reflects real money.
        Win-rate is over resolved trades only — empty quadrants show <code>—</code>.
      </div>
    </div>
  )
}

// ============================================================================
// Open Position Risk Table (Phase C — 2026-05-04)
// ============================================================================

function RiskBadge({ level }: { level: 'OK' | 'WARN' | 'CRITICAL' }) {
  if (level === 'CRITICAL') {
    return <span className="px-2 py-0.5 rounded text-xs font-semibold bg-red-900/40 text-red-300 border border-red-700/60">CRITICAL</span>
  }
  if (level === 'WARN') {
    return <span className="px-2 py-0.5 rounded text-xs font-semibold bg-amber-900/30 text-amber-300 border border-amber-700/50">WARN</span>
  }
  return <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-900/30 text-green-400 border border-green-700/40">OK</span>
}

function quadrantShort(direction: 'cold' | 'warm', marketType: 'high' | 'low'): string {
  if (direction === 'cold' && marketType === 'high') return 'cold-H'
  if (direction === 'warm' && marketType === 'high') return 'hot-H'
  if (direction === 'warm' && marketType === 'low') return 'warm-L'
  return 'cold-L'
}

function OpenPositionRiskTable({ rows }: { rows: OpenPositionRiskRow[] }) {
  if (!rows || rows.length === 0) {
    return <div className="text-center py-6 text-gray-500 text-sm">No open positions or risk monitor has not run yet</div>
  }
  // Sort: CRITICAL → WARN → OK; within level, most recently-updated first
  const order = { CRITICAL: 0, WARN: 1, OK: 2 } as const
  const sorted = [...rows].sort((a, b) => {
    const oa = order[a.riskLevel]
    const ob = order[b.riskLevel]
    if (oa !== ob) return oa - ob
    return b.refreshedTimestamp - a.refreshedTimestamp
  })

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-gray-500 border-b border-gray-700/50">
            <th className="text-center py-2 pr-2 font-medium">Risk</th>
            <th className="text-left py-2 px-2 font-medium">Ticker</th>
            <th className="text-left py-2 px-2 font-medium">City</th>
            <th className="text-left py-2 px-2 font-medium">Quadrant</th>
            <th className="text-center py-2 px-2 font-medium">Mode</th>
            <th className="text-right py-2 px-2 font-medium">Signal °F</th>
            <th className="text-right py-2 px-2 font-medium">Refreshed °F</th>
            <th className="text-right py-2 px-2 font-medium">Drift</th>
            <th className="text-right py-2 px-2 font-medium">Buffer</th>
            <th className="text-right py-2 px-2 font-medium">Cloud</th>
            <th className="text-right py-2 pl-2 font-medium">Obs</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(r => {
            const driftSigned = r.forecastDriftF >= 0 ? `+${r.forecastDriftF.toFixed(1)}` : r.forecastDriftF.toFixed(1)
            const bufClass = r.bracketDistanceCurrentF <= 0 ? 'text-red-400' : r.bracketDistanceCurrentF < 1 ? 'text-amber-400' : 'text-gray-300'
            const driftClass = (r.direction === 'cold' && r.forecastDriftF < -1) || (r.direction === 'warm' && r.forecastDriftF > 1)
              ? 'text-red-400' : 'text-gray-300'
            return (
              <tr key={r.signalId} className={`border-b border-gray-800/30 ${r.riskLevel === 'CRITICAL' ? 'bg-red-900/10' : r.riskLevel === 'WARN' ? 'bg-amber-900/10' : ''}`}>
                <td className="py-2 pr-2 text-center"><RiskBadge level={r.riskLevel} /></td>
                <td className="py-2 px-2 text-gray-300 font-mono whitespace-nowrap">{r.ticker}</td>
                <td className="py-2 px-2 text-white font-medium">{r.cityCode}</td>
                <td className="py-2 px-2 text-gray-400">{quadrantShort(r.direction, r.marketType)}</td>
                <td className="py-2 px-2 text-center text-gray-400 text-[10px]">{r.mode ?? 'live'}</td>
                <td className="py-2 px-2 text-right text-gray-300">{r.signalForecastF.toFixed(1)}°</td>
                <td className="py-2 px-2 text-right text-gray-300">{r.refreshedForecastF.toFixed(1)}°</td>
                <td className={`py-2 px-2 text-right font-mono ${driftClass}`}>{driftSigned}°</td>
                <td className={`py-2 px-2 text-right font-mono ${bufClass}`}>{r.bracketDistanceCurrentF.toFixed(1)}°</td>
                <td className="py-2 px-2 text-right text-gray-400">{r.peakCloudCover != null ? `${r.peakCloudCover.toFixed(0)}%` : '—'}</td>
                <td className="py-2 pl-2 text-right text-gray-300">{r.observedExtremeSoFarF != null ? `${r.observedExtremeSoFarF.toFixed(1)}°` : '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="mt-2 text-xs text-gray-500 leading-relaxed">
        Updated by <code className="text-gray-400">kardashev-position-monitor</code> cron every 2h. Drift = refreshed − signal forecast (signed).
        Buffer = °F to nearest adverse bracket boundary; <span className="text-red-400">negative</span> = forecast crossed boundary into losing region.
        Cloud cover at peak window is informational; forecast drift already absorbs atmospheric revisions.
        Telegram alerts fire on level transitions (OK→WARN/CRITICAL, WARN→CRITICAL), throttled to 1/signal/6h.
      </div>
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
  const ps = data?.paperSells
  const quadrants = data?.tailSellQuadrants
  const openPositionRisks = data?.openPositionRisks ?? []

  // Daily-calendar filters: independent state for live vs paper.
  const [liveDateFilter, setLiveDateFilter] = useState<string | null>(null)
  const [paperDateFilter, setPaperDateFilter] = useState<string | null>(null)

  // Filtered signal arrays — null filter = show all (no filtering)
  const filteredLiveSignals = useMemo(
    () => liveDateFilter == null
      ? ts?.signals ?? []
      : (ts?.signals ?? []).filter(s => s.marketDate === liveDateFilter),
    [ts?.signals, liveDateFilter]
  )
  const filteredPaperSignals = useMemo(
    () => paperDateFilter == null
      ? ps?.signals ?? []
      : (ps?.signals ?? []).filter(s => s.marketDate === paperDateFilter),
    [ps?.signals, paperDateFilter]
  )

  const overallReady = ts?.allGatesMet ?? false

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

        {isLoading ? <Skeleton /> : ts ? (
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

              {/* Daily P&L Calendar — click a day to filter the audit trail */}
              <DailyPnLCalendar
                signals={ts.signals}
                selectedDate={liveDateFilter}
                onSelect={setLiveDateFilter}
              />

              {/* Signal Audit Trail */}
              <div className="bg-black/40 border border-gray-700/50 rounded-xl p-5">
                <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center justify-between">
                  <span>
                    Signal Audit Trail
                    <span className="ml-2 text-xs font-normal text-gray-500">
                      {liveDateFilter
                        ? `${filteredLiveSignals.length} on ${liveDateFilter} (of ${ts.signals.length} total)`
                        : `${ts.signals.length} signals`}
                    </span>
                  </span>
                  {liveDateFilter && (
                    <button
                      onClick={() => setLiveDateFilter(null)}
                      className="text-[10px] font-medium text-amber-400 hover:text-amber-300 uppercase tracking-wider"
                    >
                      \u00d7 Show all
                    </button>
                  )}
                </h3>
                <PaginatedSignalTable
                  signals={filteredLiveSignals}
                  renderTable={(rows) => <SignalTable signals={rows} />}
                />
              </div>
            </div>

            {/* ============================================================ */}
            {/* SECTION 1.5: PAPER TRADES — ALL PAPER-MODE QUADRANTS */}
            {/* ============================================================ */}

            {ps && (
              <div className="space-y-6">
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-semibold text-white">Paper Trades</h2>
                  <span className="text-xs text-gray-500">All paper-mode tail-sell quadrants (no real execution)</span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider bg-amber-500/20 text-amber-400">
                    {ps.summary.total} paper signals
                  </span>
                </div>

                {ps.summary.total === 0 ? (
                  <div className="bg-black/40 border border-gray-700/50 rounded-xl p-5">
                    <div className="text-sm text-gray-400 mb-2">No paper trades yet.</div>
                    <div className="text-xs text-gray-500">
                      Set one or more of{' '}
                      <code className="text-amber-400">HOT_TAIL_HIGH_MODE=paper</code>,{' '}
                      <code className="text-amber-400">LOW_TEMP_WARM_TAIL_MODE=paper</code>, or{' '}
                      <code className="text-amber-400">LOW_TEMP_COLD_TAIL_MODE=paper</code> on the
                      droplet (.env.local + <code>pm2 reload kardashev-web --update-env</code>) to start
                      capturing shadow signals. Signals resolve naturally with computed P&L; no Kalshi
                      orders are placed.
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                      <SummaryCard label="Total" value={String(ps.summary.total)} />
                      <SummaryCard label="Pending" value={String(ps.summary.pending)} />
                      <SummaryCard label="Wins" value={String(ps.summary.wins)} color="green" />
                      <SummaryCard label="Losses" value={String(ps.summary.losses)} color="red" />
                      <SummaryCard
                        label="Hypothetical P&L"
                        value={`${ps.summary.totalPnl >= 0 ? '+' : ''}$${ps.summary.totalPnl.toFixed(2)}`}
                        color={ps.summary.totalPnl >= 0 ? 'green' : 'red'}
                      />
                    </div>

                    <DailyPnLCalendar
                      signals={ps.signals}
                      selectedDate={paperDateFilter}
                      onSelect={setPaperDateFilter}
                    />

                    <div className="bg-black/40 border border-amber-700/30 rounded-xl p-5">
                      <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center justify-between">
                        <span>
                          Paper Signal Audit Trail
                          <span className="ml-2 text-xs font-normal text-amber-400/80">
                            {paperDateFilter
                              ? `${filteredPaperSignals.length} on ${paperDateFilter} (of ${ps.signals.length} total)`
                              : 'PAPER — no real-money execution'}
                          </span>
                        </span>
                        {paperDateFilter && (
                          <button
                            onClick={() => setPaperDateFilter(null)}
                            className="text-[10px] font-medium text-amber-400 hover:text-amber-300 uppercase tracking-wider"
                          >
                            \u00d7 Show all
                          </button>
                        )}
                      </h3>
                      <PaginatedSignalTable
                        signals={filteredPaperSignals}
                        renderTable={(rows) => <SignalTable signals={rows} />}
                      />
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ============================================================ */}
            {/* SECTION 1.75: FOUR-QUADRANT TAIL-SELL STATUS (2026-05-04) */}
            {/* ============================================================ */}

            {quadrants && quadrants.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-semibold text-white">Tail-Sell Strategy Status</h2>
                  <span className="px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider bg-blue-500/20 text-blue-300">
                    four quadrants
                  </span>
                </div>
                <div className="bg-black/40 border border-gray-700/50 rounded-xl p-5">
                  <FourQuadrantTable quadrants={quadrants} />
                </div>
              </div>
            )}

            {/* ============================================================ */}
            {/* SECTION 1.85: OPEN POSITION RISK MONITOR (Phase C — 2026-05-04) */}
            {/* ============================================================ */}

            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-semibold text-white">Open Position Risk</h2>
                <span className="px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider bg-amber-500/20 text-amber-300">
                  monitor
                </span>
              </div>
              <div className="bg-black/40 border border-gray-700/50 rounded-xl p-5">
                <OpenPositionRiskTable rows={openPositionRisks} />
              </div>
            </div>

          </>
        ) : null}
      </div>
    </Layout>
  )
}
