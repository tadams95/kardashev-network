// Trading Readiness API — computes go-live gates, signal audit trail,
// NE corridor correlation, and probability-model audit metrics for the
// /trading-readiness page.

import type { NextApiRequest, NextApiResponse } from 'next'
import { getDb } from '@/lib/db/mongodb'
import { getSignalHistory } from '@/lib/models/performanceTracker'
import type { SignalRecord } from '@/lib/models/performanceTracker'
import { rget, rset } from '@/lib/cache/redis'
import type { TailSellRecord } from '@/lib/models/tailSellTracker'
import { DEFAULT_FEE_RATE } from '@/lib/models/weatherProbability'

// ============================================================================
// Constants
// ============================================================================

const NE_CORRIDOR = new Set(['BOS', 'NY', 'NYC', 'PHI', 'PHIL', 'DC'])
const POSITION_SIZE = 10
const POSITION_SIZE_PROBABILITY_MODEL = 10

const MONTHS: Record<string, string> = {
  JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
  JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12',
}

/**
 * Parse the bracket label from a probability-model `marketId`.
 * Verified format from May 2 plan-mode investigation: `signals` collection
 * is overwhelmingly threshold-direction markets with `-B<value>` (≤) or
 * `-T<value>` (≥) suffixes. Inner brackets (multi-strike) are rare; if
 * encountered, fall back to the marketId tail.
 *
 *   KXHIGHNY-26MAY02-B62.5 → "≤62.5°F"
 *   KXHIGHNY-26MAR12-T64   → "≥64°F"
 */
function parseBracketLabel(marketId: string): string {
  const m = marketId.match(/-([BT])(\d+(?:\.\d+)?)$/)
  if (!m) return marketId.split('-').slice(-1)[0] ?? marketId
  const [, kind, strike] = m
  return kind === 'B' ? `≤${strike}°F` : `≥${strike}°F`
}

/** Hypothetical P&L per $1 of contract face value for an advisory probability-model
 *  signal. Generalizes the tail-sell formula at `tailSellTracker.ts:411-419` to both
 *  YES and NO directions:
 *    - YES bet: pay marketPrice; pays $1 if outcome=true.
 *    - NO bet:  pay (1 - marketPrice); pays $1 if outcome=false.
 *  Fee applies to the win side only (matches tail-sell convention). Returns null
 *  when outcome is unresolved. These signals are NEVER executed; the number is
 *  evaluation-only ("would we have made money trading these?"). */
function hypotheticalPnlPerContract(
  direction: 'YES' | 'NO',
  marketPrice: number,
  outcome: boolean | null
): number | null {
  if (outcome == null) return null
  const cost = direction === 'YES' ? marketPrice : (1 - marketPrice)
  const won = direction === 'YES' ? outcome === true : outcome === false
  return won ? (1 - cost) * (1 - DEFAULT_FEE_RATE) : -cost
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
    const CACHE_KEY = 'trading-readiness:v6'
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

    // Probability-model row mapper. Win: YES bets win when outcome===true; NO bets
    // win when outcome===false. P&L is hypothetical — these signals are advisory and
    // never executed; the dollarPnl field shows "would we have made money trading
    // these at $POSITION_SIZE_PROBABILITY_MODEL/contract?" for evaluation purposes.
    function toProbabilityModelRow(s: SignalRecord) {
      const direction: 'YES' | 'NO' = s.direction ?? (s.modelProbability > s.marketPrice ? 'YES' : 'NO')
      const outcome = s.outcome ?? null
      const win = outcome == null ? null : (direction === 'YES' ? outcome === true : outcome === false)
      const pnl = hypotheticalPnlPerContract(direction, s.marketPrice, outcome)
      const dollarPnl = pnl != null ? pnl * POSITION_SIZE_PROBABILITY_MODEL : null
      return {
        id: s.id,
        cityCode: s.cityCode ?? '?',
        marketId: s.marketId,
        bracket: parseBracketLabel(s.marketId),
        direction,
        signal: s.signal,
        modelProbability: s.modelProbability,
        marketPrice: s.marketPrice,
        edge: s.edge,
        forecastTemp: s.forecastTemp ?? null,
        hoursToResolution: s.hoursToResolution ?? null,
        temperatureType: s.temperatureType ?? null,
        outcome,
        win,
        pnl,
        dollarPnl,
        marketDate: extractMarketDate(s.marketId),
        timestamp: s.timestamp,
        resolvedAt: s.resolvedAt ?? null,
      }
    }

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
    // Probability-Model Signals (data capture for inner-bracket exploration)
    // ======================================================================
    // Pulls from `signals` collection (separate from tail_sell_signals).
    // Filters out HOLD rows — only actionable signals (YES/STRONG_YES/NO/STRONG_NO)
    // are surfaced. The YES moratorium re-enable lifecycle is gated by
    // YES_SIGNALS_ENABLED (env), not this section — this section only displays
    // what's already been logged to the signals collection.

    const probabilityModelRaw = await getSignalHistory(200)
    const probabilityModelRows = probabilityModelRaw
      .filter(s => s.signal && s.signal !== 'HOLD')
      .map(toProbabilityModelRow)

    const pmResolved = probabilityModelRows.filter(r => r.outcome != null)
    const pmWins = pmResolved.filter(r => r.win === true)
    const pmLosses = pmResolved.filter(r => r.win === false)
    const pmYes = probabilityModelRows.filter(r => r.direction === 'YES')
    const pmNo = probabilityModelRows.filter(r => r.direction === 'NO')
    const pmYesResolved = pmYes.filter(r => r.outcome != null)
    const pmYesWins = pmYesResolved.filter(r => r.win === true).length
    const pmNoResolved = pmNo.filter(r => r.outcome != null)
    const pmNoWins = pmNoResolved.filter(r => r.win === true).length

    // Hypothetical P&L sums — only resolved rows contribute (pending rows have
    // dollarPnl=null which is filtered out).
    const sumDollarPnl = (rows: typeof probabilityModelRows) =>
      rows.reduce((sum, r) => sum + (r.dollarPnl ?? 0), 0)
    const pmTotalPnl = sumDollarPnl(pmResolved)
    const pmYesPnl = sumDollarPnl(pmYesResolved)
    const pmNoPnl = sumDollarPnl(pmNoResolved)

    const probabilityModel = {
      signals: probabilityModelRows,
      summary: {
        total: probabilityModelRows.length,
        pending: probabilityModelRows.filter(r => r.outcome == null).length,
        wins: pmWins.length,
        losses: pmLosses.length,
        yesCount: pmYes.length,
        noCount: pmNo.length,
        yesWinRate: pmYesResolved.length > 0 ? pmYesWins / pmYesResolved.length : null,
        noWinRate: pmNoResolved.length > 0 ? pmNoWins / pmNoResolved.length : null,
        totalPnl: pmTotalPnl,
        yesPnl: pmYesPnl,
        noPnl: pmNoPnl,
        positionSize: POSITION_SIZE_PROBABILITY_MODEL,
      },
    }

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
      probabilityModel,
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
