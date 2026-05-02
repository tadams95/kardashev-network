// SWR hook for /trading-readiness page
// Types defined locally to avoid importing server-side modules

import useSWR from 'swr'

// ============================================================================
// Types
// ============================================================================

export interface TailSellGates {
  resolvedCount: { current: number; target: number; met: boolean }
  winRateD2: { current: number | null; resolved: number; target: number; minSample: number; met: boolean }
  winRateD3: { current: number | null; resolved: number; target: number; minSample: number; met: boolean }
  survivedLoss: { hasLoss: boolean; cumulativePnlPositive: boolean; met: boolean }
  neCorridorValidated: { multiCityDays: number; resolvedDays: number; met: boolean }
  executionDryRun: { met: boolean }
}

export interface SignalRow {
  id: string
  cityCode: string
  bracket: string
  bracketDistance: number
  forecastF: number
  actualF: number | null
  /** Qualifier for actualF — see TailSellRecord.actualFKind. UI uses to render
   * ≤/≥ prefix. undefined/null on legacy records (treated as 'exact' if actualF set). */
  actualFKind?: 'exact' | 'le' | 'ge' | null
  yesPrice: number
  result: 'pending' | 'win' | 'loss' | null
  pnl: number | null
  dollarPnl: number | null
  confidence: 'high' | 'medium'
  timestamp: number
  resolvedAt: number | null
  isNECorridor: boolean
  eventTicker: string
  /** Market resolution date parsed from eventTicker (YYYY-MM-DD). Null when
   *  ticker doesn't match the expected `KXHIGH...-26APR28` format. */
  marketDate?: string | null
  temperatureType: 'high' | 'low'
  direction: 'cold' | 'warm'
  /** Execution mode — 'live' for real-money signals (default; legacy records),
   *  'paper' for warm-tail shadow signals. */
  mode?: 'live' | 'paper'
}

export interface NECorrelationDay {
  date: string
  cities: string[]
  signals: number
  resolved: number
  wins: number
  losses: number
  allSameOutcome: boolean | null
  pnl: number
}

/** Row shape for the "Probability-Model Signals" section on /trading-readiness.
 *  Sourced from the `signals` collection (separate from tail_sell_signals).
 *  Contains both YES and NO actionable signals (HOLDs are filtered out at the API). */
export interface ProbabilityModelRow {
  id: string
  cityCode: string
  marketId: string
  bracket: string                 // human-readable, parsed from marketId
  direction: 'YES' | 'NO'
  signal: string                  // STRONG_YES | YES | NO | STRONG_NO
  modelProbability: number
  marketPrice: number
  edge: number
  forecastTemp: number | null
  hoursToResolution: number | null
  temperatureType: 'high' | 'low' | null
  outcome: boolean | null         // null = pending; true = bracket resolved YES; false = NO
  win: boolean | null             // derived: did the bet pay off? Null when pending.
  /** Hypothetical P&L per $1 of contract face value. Null when pending.
   *  Probability-model signals are NOT executed (live or paper) — these are
   *  "what if we had traded this at $POSITION_SIZE_PROBABILITY_MODEL/contract"
   *  numbers for evaluation only. */
  pnl: number | null
  /** Hypothetical dollar P&L at the position size declared in summary.positionSize. */
  dollarPnl: number | null
  marketDate: string | null       // YYYY-MM-DD parsed from eventTicker
  timestamp: number
  resolvedAt: number | null
}

export interface TradingReadinessData {
  tailSells: {
    gates: TailSellGates
    allGatesMet: boolean
    signals: SignalRow[]
    neCorrelation: NECorrelationDay[]
    rollingWinRate: { last20: number | null; last50: number | null; last100: number | null }
    lossEvents: SignalRow[]
    summary: {
      total: number
      pending: number
      wins: number
      losses: number
      totalPnl: number
      positionSize: number
    }
  }
  paperSells: {
    signals: SignalRow[]
    summary: {
      total: number
      pending: number
      wins: number
      losses: number
      totalPnl: number
      winRate: number | null
      positionSize: number
    }
  }
  probabilityModel: {
    signals: ProbabilityModelRow[]
    summary: {
      total: number
      pending: number
      wins: number
      losses: number
      yesCount: number
      noCount: number
      yesWinRate: number | null
      noWinRate: number | null
      /** Hypothetical $ P&L summed across resolved rows at summary.positionSize. */
      totalPnl: number
      yesPnl: number
      noPnl: number
      positionSize: number
    }
  }
  timestamp: number
}

// ============================================================================
// Hook
// ============================================================================

const fetcher = (url: string) =>
  fetch(url)
    .then(r => r.json())
    .then(r => {
      if (!r.success) throw new Error(r.error || 'Failed to fetch trading readiness')
      return r.data as TradingReadinessData
    })

export function useTradingReadiness() {
  return useSWR<TradingReadinessData>(
    '/api/weather/trading-readiness',
    fetcher,
    { refreshInterval: 5 * 60_000, revalidateOnFocus: false }
  )
}
