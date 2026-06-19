// Trading Readiness API — computes go-live gates, signal audit trail,
// NE corridor correlation, and probability-model audit metrics for the
// /trading-readiness page.

import type { NextApiRequest, NextApiResponse } from 'next'
import { getDb } from '@/lib/db/mongodb'
import { rget, rset } from '@/lib/cache/redis'
import type { TailSellRecord } from '@/lib/models/tailSellTracker'
import {
  getWarmTailModeRaw,
  getHotTailHighModeRaw,
  getLowColdTailModeRaw,
} from '@/lib/computeOpportunities'
import { getOpenPositionRisks } from '@/lib/models/positionRiskTracker'

// ============================================================================
// Constants
// ============================================================================

const NE_CORRIDOR = new Set(['BOS', 'NY', 'NYC', 'PHI', 'PHIL', 'DC'])
const POSITION_SIZE = 10

// ----------------------------------------------------------------------------
// Realized dollar P&L helpers
// ----------------------------------------------------------------------------
// LIVE tail-sell orders are MAKER limit orders — most rest and never fill
// (audit 2026-06-19: ~31% never fill; ~53% of previously-booked live P&L was
// phantom premium on unfilled orders). Realized dollars MUST multiply the
// corrected per-contract pnl by the contracts ACTUALLY filled (filledCount),
// NOT by positionSize (which is the $ budget, not a contract count). Unfilled
// orders → filledCount 0 → $0 (pnl is also already 0 on unfilled records).
//
// PAPER signals place no real orders, so their pnl assumes a 100% hypothetical
// fill at full positionSize. These are NOT comparable to live realized dollars
// and are flagged `fillAssumed: true` in the response.

/** A live order counts as a realized trade only if it actually filled. */
function isFilledLive(s: TailSellRecord): boolean {
  return (s.mode ?? 'live') !== 'paper' && (s.filledCount ?? 0) > 0
}

/** Realized dollar P&L for ONE signal.
 *  - live  → corrected per-contract pnl × contracts actually filled
 *  - paper → hypothetical pnl × positionSize (fill-assumed; NOT real money) */
function dollarPnlFor(s: TailSellRecord): number {
  if ((s.mode ?? 'live') === 'paper') {
    return (s.pnl ?? 0) * s.positionSize
  }
  return (s.pnl ?? 0) * (s.filledCount ?? 0)
}

const MONTHS: Record<string, string> = {
  JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
  JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12',
}

function extractMarketDate(eventTicker: string): string | null {
  // Tail-sell eventTickers end with the date (KXHIGHDAL-26APR28).
  // Probability-model marketIds carry a trailing bracket suffix
  // (KXHIGHTSFO-26APR12-B59.5), so the date can also appear mid-string
  // followed by `-`. Match both shapes.
  const match = eventTicker.match(/-(\d{2})([A-Z]{3})(\d{2})(?:-|$)/)
  if (!match) return null
  const [, yy, mmm, dd] = match
  const mm = MONTHS[mmm]
  if (!mm) return null
  return `20${yy}-${mm}-${dd}`
}

// Normalize city codes for grouping (NYC→NY, PHIL→PHI)
function normalizeCity(code: string): string {
  if (code === 'NYC') return 'NY'
  if (code === 'PHIL') return 'PHI'
  return code
}

// ============================================================================
// Handler
// ============================================================================

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }

  try {
    const CACHE_KEY = 'trading-readiness:v10'
    const cached = await rget<any>(CACHE_KEY)
    if (cached) {
      return res.status(200).json({ success: true, data: cached })
    }

    const db = getDb()
    const allSignalsRaw = await db.collection<TailSellRecord>('tail_sell_signals')
      .find({})
      .sort({ timestamp: -1 })
      .toArray()

    // Split live vs paper. Pre-paper-mode records have no `mode` field —
    // treat them as 'live' (preserves existing cold-tail behavior). Paper
    // records are surfaced separately on the page and do NOT count toward
    // Trading Readiness gates / NE-corridor analysis / rolling win rates.
    const allSignals = allSignalsRaw.filter(s => (s as any).mode !== 'paper')
    const paperSignalsRaw = allSignalsRaw.filter(s => (s as any).mode === 'paper')

    // ======================================================================
    // Tail Sell Gates
    // ======================================================================

    const resolved = allSignals.filter(s => s.result === 'win' || s.result === 'loss')
    const wins = resolved.filter(s => s.result === 'win')
    const losses = resolved.filter(s => s.result === 'loss')
    const pending = allSignals.filter(s => s.result === 'pending')
    // REALIZED live dollars = corrected per-contract pnl × contracts filled.
    // Unfilled orders contribute $0 automatically (filledCount 0). This replaces
    // the old `pnl * positionSize` which booked full premium even on unfilled
    // maker orders (phantom P&L).
    const totalPnl = resolved.reduce((sum, s) => sum + dollarPnlFor(s), 0)

    // REALIZED win rate is computed among FILLED resolved live only — an order
    // that never filled is not a realized trade and must not count as a win.
    const resolvedFilled = resolved.filter(isFilledLive)
    const filledWins = resolvedFilled.filter(s => s.result === 'win')
    const filledLosses = resolvedFilled.filter(s => s.result === 'loss')

    // By distance (signal-level, all-resolved — gate semantics = bracket-prediction
    // accuracy, independent of whether the maker order happened to fill).
    const d2Resolved = resolved.filter(s => s.bracketDistance === 2)
    const d2Wins = d2Resolved.filter(s => s.result === 'win')
    const d3Resolved = resolved.filter(s => s.bracketDistance === 3)
    const d3Wins = d3Resolved.filter(s => s.result === 'win')

    // ======================================================================
    // NE Corridor Correlation
    // ======================================================================

    const neSignals = allSignals.filter(s => NE_CORRIDOR.has(s.cityCode))
    const byDate = new Map<string, TailSellRecord[]>()
    for (const s of neSignals) {
      const date = extractMarketDate(s.eventTicker)
      if (!date) continue
      const group = byDate.get(date) || []
      group.push(s)
      byDate.set(date, group)
    }

    const neCorrelation = Array.from(byDate.entries())
      .map(([date, signals]) => {
        const cities = [...new Set(signals.map(s => normalizeCity(s.cityCode)))]
        const res = signals.filter(s => s.result === 'win' || s.result === 'loss')
        const w = res.filter(s => s.result === 'win').length
        const l = res.filter(s => s.result === 'loss').length
        const pnl = res.reduce((sum, s) => sum + dollarPnlFor(s), 0)
        const allResolved = res.length === signals.length && signals.length > 0
        return {
          date,
          cities,
          signals: signals.length,
          resolved: res.length,
          wins: w,
          losses: l,
          allSameOutcome: allResolved ? (w === 0 || l === 0) : null,
          pnl,
        }
      })
      .filter(d => d.cities.length >= 2)
      .sort((a, b) => b.date.localeCompare(a.date))

    const resolvedMultiCityDays = neCorrelation.filter(d => d.resolved === d.signals && d.signals > 0)

    // ======================================================================
    // Gates Object
    // ======================================================================

    const gates = {
      resolvedCount: {
        current: resolved.length,
        target: 100,
        met: resolved.length >= 100,
      },
      winRateD2: {
        current: d2Resolved.length > 0 ? d2Wins.length / d2Resolved.length : null,
        resolved: d2Resolved.length,
        target: 0.85,
        minSample: 20,
        met: d2Resolved.length >= 20 && (d2Wins.length / d2Resolved.length) >= 0.85,
      },
      winRateD3: {
        current: d3Resolved.length > 0 ? d3Wins.length / d3Resolved.length : null,
        resolved: d3Resolved.length,
        target: 0.90,
        minSample: 20,
        met: d3Resolved.length >= 20 && (d3Wins.length / d3Resolved.length) >= 0.90,
      },
      survivedLoss: {
        hasLoss: losses.length > 0,
        cumulativePnlPositive: totalPnl > 0,
        met: losses.length > 0 && totalPnl > 0,
      },
      neCorridorValidated: {
        multiCityDays: neCorrelation.length,
        resolvedDays: resolvedMultiCityDays.length,
        met: resolvedMultiCityDays.length > 0,
      },
      executionDryRun: {
        met: true, // satisfied by live Kalshi auto-execution since 2026-04-01
      },
    }

    const tailGatesMet = Object.values(gates).every(g => g.met)

    // ======================================================================
    // Rolling Win Rates
    // ======================================================================

    const resolvedByTime = [...resolved].sort((a, b) =>
      (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0)
    )
    const calcRolling = (n: number) => {
      const slice = resolvedByTime.slice(0, n)
      if (slice.length < n) return null
      return slice.filter(s => s.result === 'win').length / n
    }

    const rollingWinRate = {
      last20: calcRolling(20),
      last50: calcRolling(50),
      last100: calcRolling(100),
    }

    // ======================================================================
    // Signal Rows (audit trail)
    // ======================================================================

    function toSignalRow(s: TailSellRecord) {
      // For threshold-direction warm brackets, bracketFloorF and bracketCapF
      // both equal the threshold (per the warm-tail generator). Render as
      // "≥X°F" using the direction qualifier.
      const isWarmThreshold = s.direction === 'warm' && s.bracketFloorF === s.bracketCapF
      const bracket = isWarmThreshold
        ? `≥${s.bracketFloorF}°F`
        : (s.bracketFloorF != null
            ? `${s.bracketFloorF}–${s.bracketCapF}°F`
            : `≤${s.bracketCapF}°F`)
      return {
        id: s.id,
        cityCode: s.cityCode,
        bracket,
        bracketDistance: s.bracketDistance,
        forecastF: s.forecastF,
        actualF: s.actualF,
        actualFKind: s.actualFKind ?? null,
        yesPrice: s.yesPrice,
        result: s.result,
        pnl: s.pnl,
        // Realized dollars: live → pnl × filledCount (unfilled = $0); paper →
        // pnl × positionSize (fill-assumed hypothetical). null until resolved.
        dollarPnl: s.pnl != null ? dollarPnlFor(s) : null,
        // For live rows: contracts actually filled (0 = order never filled) and
        // whether it filled at all. Lets the UI distinguish a real realized trade
        // from a resting/expired maker order. undefined on paper / un-reconciled.
        filledCount: (s.mode ?? 'live') === 'paper' ? null : (s.filledCount ?? null),
        filled: (s.mode ?? 'live') === 'paper' ? null : (s.filled ?? null),
        confidence: s.confidence,
        timestamp: s.timestamp,
        resolvedAt: s.resolvedAt,
        isNECorridor: NE_CORRIDOR.has(s.cityCode),
        eventTicker: s.eventTicker,
        // Market resolution date parsed from eventTicker (e.g., "KXHIGHDAL-26APR28"
        // → "2026-04-28"). Used by the audit-trail Daily P&L Calendar to bucket
        // signals. Null when the ticker doesn't match the expected format.
        marketDate: extractMarketDate(s.eventTicker),
        temperatureType: s.temperatureType ?? 'high',
        direction: s.direction ?? 'cold',
        mode: (s.mode ?? 'live') as 'live' | 'paper',
      }
    }

    const signalRows = allSignals.map(toSignalRow)
    const paperSignalRows = paperSignalsRaw.map(toSignalRow)

    // Loss events with full context
    const lossEvents = signalRows.filter(s => s.result === 'loss')

    // ======================================================================
    // Paper Trades summary (all paper-mode quadrants: hot-side-high + warm-tail-low + cold-tail-low)
    // ======================================================================

    const paperResolved = paperSignalsRaw.filter(s => s.result === 'win' || s.result === 'loss')
    const paperWins = paperResolved.filter(s => s.result === 'win')
    const paperLosses = paperResolved.filter(s => s.result === 'loss')
    const paperPending = paperSignalsRaw.filter(s => s.result === 'pending')
    const paperTotalPnl = paperResolved.reduce(
      (sum, s) => sum + (s.pnl ?? 0) * s.positionSize, 0
    )
    const paperWinRate = paperResolved.length > 0
      ? paperWins.length / paperResolved.length
      : null
    const paperPositionSize = paperSignalsRaw.length > 0
      ? paperSignalsRaw[0].positionSize
      : 5  // POSITION_SIZE_LOW default for empty state

    // ======================================================================
    // Four-Quadrant Tail-Sell Status (2026-05-04)
    // ======================================================================
    // Always returns 4 entries even when n=0 — UI must handle empty quadrants
    // gracefully. Mode reflects current env-flag state; counts come from all
    // signals (live + paper combined) filtered by (direction, temperatureType).

    const ONE_DAY_MS = 24 * 60 * 60 * 1000
    const now = Date.now()

    type QuadrantKey = 'cold-side-high' | 'hot-side-high' | 'warm-tail-low' | 'cold-tail-low'

    function buildQuadrant(
      key: QuadrantKey,
      label: string,
      mode: 'live' | 'paper' | 'off',
      isReal: boolean,
      filter: (s: TailSellRecord) => boolean,
    ) {
      const matched = allSignalsRaw.filter(filter)
      const matchedResolved = matched.filter(s => s.result === 'win' || s.result === 'loss')
      const matchedWins = matchedResolved.filter(s => s.result === 'win')
      const open = matched.filter(s => s.result === 'pending').length
      const today = matched.filter(s => now - s.timestamp <= ONE_DAY_MS).length
      // netPnl: live signals → realized (pnl × filledCount); paper signals →
      // fill-assumed hypothetical (pnl × positionSize). dollarPnlFor branches
      // per-signal so a mixed quadrant nets the right dollars.
      const netPnl = matchedResolved.reduce((sum, s) => sum + dollarPnlFor(s), 0)
      const winRate = matchedResolved.length > 0 ? matchedWins.length / matchedResolved.length : null
      return {
        key,
        label,
        mode,
        isReal,
        signalsToday: today,
        openPositions: open,
        resolvedTotal: matchedResolved.length,
        winRate,
        netPnl,
      }
    }

    // ======================================================================
    // Open Position Risks (Phase C — 2026-05-04)
    // ======================================================================
    // Latest snapshot per pending position from `position_risk_snapshots`.
    // Cron `kardashev-position-monitor` writes; this just reads the latest.
    // Sorted CRITICAL → WARN → OK at consumer (UI) for display.
    const pendingSignalIds = pending.concat(paperPending).map(s => s.id)
    const openPositionRisksRaw = await getOpenPositionRisks(pendingSignalIds)
    const openPositionRisks = openPositionRisksRaw.map(r => ({
      signalId: r.signalId,
      ticker: r.ticker,
      cityCode: r.cityCode,
      marketType: r.marketType,
      direction: r.direction,
      mode: r.mode,
      bracketCapF: r.bracketCapF,
      bracketFloorF: r.bracketFloorF,
      signalForecastF: r.signalForecastF,
      refreshedForecastF: r.refreshedForecastF,
      forecastDriftF: r.forecastDriftF,
      bracketDistanceCurrentF: r.bracketDistanceCurrentF,
      peakCloudCover: r.peakCloudCover,
      peakHumidity: r.peakHumidity,
      observedExtremeSoFarF: r.observedExtremeSoFarF,
      hoursIntoPeakWindow: r.hoursIntoPeakWindow,
      riskLevel: r.riskLevel,
      riskTriggers: r.riskTriggers,
      refreshedTimestamp: r.refreshedTimestamp,
    }))

    // Cold-side HIGH (LIVE — earning): direction='cold' AND temperatureType='high'.
    // Pre-paper-mode legacy records have no mode field but were always cold-side HIGH live.
    // Labels intentionally omit the (live)/(paper) suffix — the Mode column's
    // ModeBadge is the canonical source of mode info; baking it into the label
    // string caused a "(paper)(paper)" double-tag when paired with the
    // !q.isReal "(paper)" annotation in FourQuadrantTable.
    const tailSellQuadrants = [
      buildQuadrant(
        'cold-side-high',
        'Cold-side high',
        'live',
        true,
        s => (s.direction === 'cold' || s.direction == null)
          && (s.temperatureType === 'high' || s.temperatureType == null),
      ),
      buildQuadrant(
        'hot-side-high',
        'Hot-side high',
        getHotTailHighModeRaw(),
        false,
        s => s.direction === 'warm' && s.temperatureType === 'high',
      ),
      buildQuadrant(
        'warm-tail-low',
        'Warm-tail low',
        getWarmTailModeRaw(),
        false,
        s => s.direction === 'warm' && s.temperatureType === 'low',
      ),
      buildQuadrant(
        'cold-tail-low',
        'Cold-tail low',
        getLowColdTailModeRaw(),
        false,
        s => s.direction === 'cold' && s.temperatureType === 'low',
      ),
    ]

    // ======================================================================
    // Response
    // ======================================================================

    const data = {
      tailSells: {
        gates,
        allGatesMet: tailGatesMet,
        signals: signalRows,
        neCorrelation,
        rollingWinRate,
        lossEvents,
        summary: {
          total: allSignals.length,
          pending: pending.length,
          // HEADLINE = realized: wins/losses/winRate counted among FILLED
          // resolved live only. An unfilled maker order is not a realized trade.
          wins: filledWins.length,
          losses: filledLosses.length,
          winRate: resolvedFilled.length > 0
            ? filledWins.length / resolvedFilled.length
            : null,
          // totalPnl is realized dollars (pnl × filledCount across resolved live).
          totalPnl,
          positionSize: POSITION_SIZE,
          // Realized vs. all-resolved breakdown so the inflation is visible and
          // consumers that want the signal-level (bracket-prediction) rate still
          // have it — distinctly labelled so it can't be mistaken for realized.
          filledResolved: resolvedFilled.length,
          unfilledResolved: resolved.length - resolvedFilled.length,
          allResolved: resolved.length,
          allResolvedWins: wins.length,
          allResolvedLosses: losses.length,
          // True only after fill reconciliation has populated filledCount — when
          // false, realized figures may understate (rare; reconcile runs each cycle).
          fillAssumed: false,
        },
      },
      paperSells: {
        signals: paperSignalRows,
        summary: {
          total: paperSignalsRaw.length,
          pending: paperPending.length,
          wins: paperWins.length,
          losses: paperLosses.length,
          totalPnl: paperTotalPnl,
          winRate: paperWinRate,
          positionSize: paperPositionSize,
          // Paper places NO real orders — pnl assumes a 100% fill at full
          // positionSize. NOT comparable to live realized dollars.
          fillAssumed: true,
        },
      },
      tailSellQuadrants,
      openPositionRisks,
      timestamp: Date.now(),
    }

    await rset(CACHE_KEY, data, 300)
    return res.status(200).json({ success: true, data })
  } catch (error) {
    console.error('[trading-readiness] Error:', error)
    return res.status(500).json({
      success: false,
      error: 'Failed to compute trading readiness',
    })
  }
}
