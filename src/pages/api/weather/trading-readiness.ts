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
    const CACHE_KEY = 'trading-readiness:v8'
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
    const totalPnl = resolved.reduce((sum, s) => sum + (s.pnl ?? 0) * s.positionSize, 0)

    // By distance
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
        const pnl = res.reduce((sum, s) => sum + (s.pnl ?? 0) * s.positionSize, 0)
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
        dollarPnl: s.pnl != null ? s.pnl * s.positionSize : null,
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
    // Paper Trades summary (warm-tail shadow)
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
      const netPnl = matchedResolved.reduce((sum, s) => sum + (s.pnl ?? 0) * s.positionSize, 0)
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
    const tailSellQuadrants = [
      buildQuadrant(
        'cold-side-high',
        'Cold-side high (live)',
        'live',
        true,
        s => (s.direction === 'cold' || s.direction == null)
          && (s.temperatureType === 'high' || s.temperatureType == null),
      ),
      buildQuadrant(
        'hot-side-high',
        'Hot-side high (paper)',
        getHotTailHighModeRaw(),
        false,
        s => s.direction === 'warm' && s.temperatureType === 'high',
      ),
      buildQuadrant(
        'warm-tail-low',
        'Warm-tail low (paper)',
        getWarmTailModeRaw(),
        false,
        s => s.direction === 'warm' && s.temperatureType === 'low',
      ),
      buildQuadrant(
        'cold-tail-low',
        'Cold-tail low (paper)',
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
          wins: wins.length,
          losses: losses.length,
          totalPnl,
          positionSize: POSITION_SIZE,
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
