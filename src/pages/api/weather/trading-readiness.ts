// Trading Readiness API — computes go-live gates, signal audit trail,
// NE corridor correlation, and sweet spot metrics for the /trading-readiness page.

import type { NextApiRequest, NextApiResponse } from 'next'
import { getDb } from '@/lib/db/mongodb'
import { getPnLBreakdown } from '@/lib/models/performanceTracker'
import { rget, rset } from '@/lib/cache/redis'
import type { TailSellRecord } from '@/lib/models/tailSellTracker'

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
  const match = eventTicker.match(/-(\d{2})([A-Z]{3})(\d{2})$/)
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
    const CACHE_KEY = 'trading-readiness:v1'
    const cached = await rget<any>(CACHE_KEY)
    if (cached) {
      return res.status(200).json({ success: true, data: cached })
    }

    const db = getDb()
    const allSignals = await db.collection<TailSellRecord>('tail_sell_signals')
      .find({})
      .sort({ timestamp: -1 })
      .toArray()

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
        met: false, // manual gate — set true when API dry run is complete
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

    const signalRows = allSignals.map(s => ({
      id: s.id,
      cityCode: s.cityCode,
      bracket: s.bracketFloorF != null
        ? `${s.bracketFloorF}–${s.bracketCapF}°F`
        : `≤${s.bracketCapF}°F`,
      bracketDistance: s.bracketDistance,
      forecastF: s.forecastF,
      actualF: s.actualF,
      yesPrice: s.yesPrice,
      result: s.result,
      pnl: s.pnl,
      dollarPnl: s.pnl != null ? s.pnl * s.positionSize : null,
      confidence: s.confidence,
      timestamp: s.timestamp,
      resolvedAt: s.resolvedAt,
      isNECorridor: NE_CORRIDOR.has(s.cityCode),
      eventTicker: s.eventTicker,
    }))

    // Loss events with full context
    const lossEvents = signalRows.filter(s => s.result === 'loss')

    // ======================================================================
    // Sweet Spot Metrics (20–40¢ NO-only)
    // ======================================================================

    let sweetSpot
    try {
      const pnlData = await getPnLBreakdown(500)
      const sweetSpotTrades = pnlData.trades.filter(
        (t: any) => t.marketPrice >= 0.20 && t.marketPrice <= 0.40
      )
      const ssResolved = sweetSpotTrades.length
      const ssWins = sweetSpotTrades.filter((t: any) => t.outcome).length

      // BSS in the 20-40¢ range
      let ssBSS = 0
      if (ssResolved > 0) {
        const marketActual = (t: any): number => {
          const bettingYes = t.modelProbability > t.marketPrice
          return (bettingYes ? t.outcome : !t.outcome) ? 1 : 0
        }
        const modelBrier = sweetSpotTrades.reduce(
          (sum: number, t: any) => sum + (t.modelProbability - marketActual(t)) ** 2, 0
        ) / ssResolved
        const marketBrier = sweetSpotTrades.reduce(
          (sum: number, t: any) => sum + (t.marketPrice - marketActual(t)) ** 2, 0
        ) / ssResolved
        ssBSS = marketBrier > 0 ? 1 - (modelBrier / marketBrier) : 0
      }

      const ssNetPnl = sweetSpotTrades.reduce(
        (sum: number, t: any) => sum + (t.netProfit ?? 0), 0
      )

      sweetSpot = {
        gates: {
          bssAboveZero: {
            current: ssBSS,
            trades: ssResolved,
            met: ssResolved >= 50 && ssBSS > 0,
          },
          positiveEvAfterFees: {
            current: ssResolved > 0 ? ssNetPnl / ssResolved : 0,
            totalNetPnl: ssNetPnl,
            trades: ssResolved,
            met: ssResolved >= 50 && ssNetPnl > 0,
          },
          signalGeneration: {
            description: ssWins > 0
              ? `${ssWins}/${ssResolved} wins in 20-40¢ range`
              : 'Currently all HOLD — needs calibration improvement',
            met: false, // manual assessment needed
          },
        },
        allGatesMet: false,
        status: ssBSS > 0
          ? `Approaching — BSS +${ssBSS.toFixed(3)} on ${ssResolved} trades`
          : `Not ready — BSS ${ssBSS.toFixed(3)} on ${ssResolved} trades`,
      }
      sweetSpot.allGatesMet = Object.values(sweetSpot.gates).every((g: any) => g.met)
    } catch {
      sweetSpot = {
        gates: {
          bssAboveZero: { current: 0, trades: 0, met: false },
          positiveEvAfterFees: { current: 0, totalNetPnl: 0, trades: 0, met: false },
          signalGeneration: { description: 'Error loading data', met: false },
        },
        allGatesMet: false,
        status: 'Error loading sweet spot data',
      }
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
      sweetSpot,
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
