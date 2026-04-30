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

// Sweet Spot gate thresholds (see docs/work/sweet-spot-gates-refresh-spec.md)
const PHASE_2_DEPLOY_MS = Date.UTC(2026, 3, 21, 0, 0, 0)  // 2026-04-21 00:00 UTC
// Module-load assert: catch silent epoch drift from typos
if (new Date(PHASE_2_DEPLOY_MS).toISOString() !== '2026-04-21T00:00:00.000Z') {
  throw new Error(
    `[trading-readiness] PHASE_2_DEPLOY_MS resolves to ${new Date(PHASE_2_DEPLOY_MS).toISOString()}, expected 2026-04-21T00:00:00.000Z`
  )
}
const MIN_CUMULATIVE = 30          // post-Phase-2 trades required for cumulative gate
const MIN_ROLLING_7D = 20          // last-7d trades required for rolling gate
const ACTIVELY_LOSING_THRESHOLD = -0.05  // BSS floor below which a non-cleared bucket vetoes `viable`

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
    const CACHE_KEY = 'trading-readiness:v2'
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

    const signalRows = allSignals.map(s => ({
      id: s.id,
      cityCode: s.cityCode,
      bracket: s.bracketFloorF != null
        ? `${s.bracketFloorF}–${s.bracketCapF}°F`
        : `≤${s.bracketCapF}°F`,
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
      temperatureType: s.temperatureType ?? 'high',
      direction: s.direction ?? 'cold',
    }))

    // Loss events with full context
    const lossEvents = signalRows.filter(s => s.result === 'loss')

    // ======================================================================
    // Sweet Spot Metrics — per-bucket post-Phase-2 NO-only gates
    // See docs/work/sweet-spot-gates-refresh-spec.md
    // ======================================================================

    let sweetSpot
    try {
      const pnlData = await getPnLBreakdown(500)
      const phase2NoTrades = pnlData.trades.filter(
        t => t.timestamp >= PHASE_2_DEPLOY_MS && t.direction === 'NO'
      )
      const sevenDaysAgo = Date.now() - 7 * 86400000

      const b20to30 = phase2NoTrades.filter(t => t.marketPrice >= 0.20 && t.marketPrice < 0.30)
      // 30-50¢ filter retained for working-checklist consistency; the >40¢ hard
      // gate (computeOpportunities.ts:698) means post-Phase-2 trades all land in
      // [0.30, 0.40] in practice. See spec Bucket boundaries section.
      const b30to50 = phase2NoTrades.filter(t => t.marketPrice >= 0.30 && t.marketPrice <= 0.50)
      const b20to30Recent = b20to30.filter(t => t.timestamp >= sevenDaysAgo)
      const b30to50Recent = b30to50.filter(t => t.timestamp >= sevenDaysAgo)

      // Reconstruct YES-side event indicator from (direction, outcome).
      // For NO trade: outcome=true (won) means bracket resolved false → 0.
      //               outcome=false (lost) means bracket resolved true → 1.
      type Trade = (typeof phase2NoTrades)[number]
      const eventIndicator = (t: Trade): number =>
        (t.direction === 'YES' ? t.outcome : !t.outcome) ? 1 : 0

      function computeBSS(trades: Trade[]): number | null {
        if (trades.length === 0) return null
        const n = trades.length
        const modelBrier = trades.reduce((s, t) => s + (t.modelProbability - eventIndicator(t)) ** 2, 0) / n
        const marketBrier = trades.reduce((s, t) => s + (t.marketPrice - eventIndicator(t)) ** 2, 0) / n
        return marketBrier > 0 ? 1 - (modelBrier / marketBrier) : 0
      }

      function buildBucketGate(all: Trade[], recent: Trade[]) {
        const trades = all.length
        const recentTrades = recent.length
        const cumulativeBSS = trades >= MIN_CUMULATIVE ? computeBSS(all) : null
        const rolling7dBSS = recentTrades >= MIN_ROLLING_7D ? computeBSS(recent) : null
        const cumulativeWinRate = trades > 0 ? all.filter(t => t.outcome).length / trades : null
        const rolling7dWinRate = recentTrades > 0 ? recent.filter(t => t.outcome).length / recentTrades : null
        const cumulativeNetPnl = all.reduce((s, t) => s + t.netProfit, 0)
        const cumulativeMet = trades >= MIN_CUMULATIVE && cumulativeBSS !== null && cumulativeBSS > 0
        const rolling7dMet = recentTrades >= MIN_ROLLING_7D && rolling7dBSS !== null && rolling7dBSS > 0
        return {
          trades,
          recentTrades,
          cumulativeBSS,
          cumulativeWinRate,
          cumulativeNetPnl,
          rolling7dBSS,
          rolling7dWinRate,
          cumulativeMet,
          rolling7dMet,
          bothMet: cumulativeMet && rolling7dMet,
        }
      }

      const bucket20to30 = buildBucketGate(b20to30, b20to30Recent)
      const bucket30to50 = buildBucketGate(b30to50, b30to50Recent)

      // Composite verdicts
      const isActivelyLosing = (g: ReturnType<typeof buildBucketGate>): boolean =>
        g.trades >= MIN_CUMULATIVE && g.cumulativeBSS !== null && g.cumulativeBSS < ACTIVELY_LOSING_THRESHOLD
      const anyActivelyLosing = isActivelyLosing(bucket20to30) || isActivelyLosing(bucket30to50)
      const eitherCleared = bucket20to30.bothMet || bucket30to50.bothMet
      const viable = eitherCleared && !anyActivelyLosing
      const bothViable = bucket20to30.bothMet && bucket30to50.bothMet

      // Activity / regime status
      const activeBuckets: Array<'20-30' | '30-50'> = []
      if (bucket20to30.trades > 0) activeBuckets.push('20-30')
      if (bucket30to50.trades > 0) activeBuckets.push('30-50')

      let activityDescription: string
      if (activeBuckets.length === 2) {
        activityDescription = 'Both buckets producing trades.'
      } else if (activeBuckets.length === 1) {
        const present = activeBuckets[0]
        const absent = present === '20-30' ? '30-50' : '20-30'
        activityDescription = `Only ${present}¢ active (${absent}¢ regime absent).`
      } else {
        activityDescription = 'No post-Phase-2 NO trades yet — gate window opens after first signal.'
      }

      // Status string — see spec Status string table
      function statusString(): string {
        const fmt = (v: number | null) => (v === null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(3))

        // Row 8: zero post-Phase-2 NO trades
        if (phase2NoTrades.length === 0) {
          return 'No post-Phase-2 NO trades yet — gate window opens after first signal'
        }

        // Row 1: bothViable
        if (bothViable) {
          return 'Inner-bracket automation viable in 20-30¢ AND 30-50¢ NO'
        }

        // Row 2: one cleared, other actively losing — NOT VIABLE
        if (eitherCleared && anyActivelyLosing) {
          const cleared = bucket20to30.bothMet ? '20-30' : '30-50'
          const losing = bucket20to30.bothMet ? bucket30to50 : bucket20to30
          const losingLabel = bucket20to30.bothMet ? '30-50' : '20-30'
          return `Not viable — ${cleared}¢ cleared but ${losingLabel}¢ actively losing (BSS ${fmt(losing.cumulativeBSS)} on ${losing.trades} trades)`
        }

        // Row 3: one viable, other underperforming but not actively losing
        if (eitherCleared) {
          const cleared = bucket20to30.bothMet ? '20-30' : '30-50'
          const other = bucket20to30.bothMet ? bucket30to50 : bucket20to30
          const otherLabel = bucket20to30.bothMet ? '30-50' : '20-30'
          // Row 4: one viable, other sample-insufficient
          if (other.trades < MIN_CUMULATIVE) {
            return `Viable in ${cleared}¢ NO; ${otherLabel}¢ sample-insufficient (${other.trades}/${MIN_CUMULATIVE})`
          }
          return `Viable in ${cleared}¢ NO; ${otherLabel}¢ underperforming (BSS ${fmt(other.cumulativeBSS)} on ${other.trades} trades)`
        }

        // Row 6: only one bucket active
        if (activeBuckets.length === 1) {
          const presentKey = activeBuckets[0]
          const presentBucket = presentKey === '20-30' ? bucket20to30 : bucket30to50
          const absentLabel = presentKey === '20-30' ? '30-50' : '20-30'
          const presentStatus = presentBucket.cumulativeBSS !== null
            ? `BSS ${fmt(presentBucket.cumulativeBSS)} on ${presentBucket.trades} trades`
            : `${presentBucket.trades}/${MIN_CUMULATIVE} trades`
          return `Only ${presentKey}¢ active (${presentStatus}); ${absentLabel}¢ regime absent`
        }

        // Row 5: both buckets active, neither viable
        if (bucket20to30.trades >= MIN_CUMULATIVE && bucket30to50.trades >= MIN_CUMULATIVE) {
          return `Both buckets underperforming — 20-30¢ BSS ${fmt(bucket20to30.cumulativeBSS)}, 30-50¢ BSS ${fmt(bucket30to50.cumulativeBSS)}`
        }

        // Row 7: both buckets sample-insufficient
        return `Need ${MIN_CUMULATIVE}+ post-Phase-2 NO trades per bucket — ${bucket20to30.trades}/${bucket30to50.trades} so far`
      }

      sweetSpot = {
        gates: {
          bucket20to30,
          bucket30to50,
          activity: {
            activeBuckets,
            description: activityDescription,
          },
          viable,
          bothViable,
          anyActivelyLosing,
          phase2DeployMs: PHASE_2_DEPLOY_MS,
        },
        allGatesMet: viable,
        status: statusString(),
      }
    } catch (err) {
      console.warn('[trading-readiness] sweet-spot computation failed:', err)
      const emptyBucket = {
        trades: 0,
        recentTrades: 0,
        cumulativeBSS: null,
        cumulativeWinRate: null,
        cumulativeNetPnl: 0,
        rolling7dBSS: null,
        rolling7dWinRate: null,
        cumulativeMet: false,
        rolling7dMet: false,
        bothMet: false,
      }
      sweetSpot = {
        gates: {
          bucket20to30: emptyBucket,
          bucket30to50: emptyBucket,
          activity: { activeBuckets: [] as Array<'20-30' | '30-50'>, description: 'Error loading data' },
          viable: false,
          bothViable: false,
          anyActivelyLosing: false,
          phase2DeployMs: PHASE_2_DEPLOY_MS,
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
