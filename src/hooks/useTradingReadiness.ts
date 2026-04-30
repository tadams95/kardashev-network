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

export interface SweetSpotBucketGate {
  trades: number
  recentTrades: number
  cumulativeBSS: number | null
  cumulativeWinRate: number | null
  cumulativeNetPnl: number
  rolling7dBSS: number | null
  rolling7dWinRate: number | null
  cumulativeMet: boolean
  rolling7dMet: boolean
  bothMet: boolean
}

export interface SweetSpotGates {
  bucket20to30: SweetSpotBucketGate
  bucket30to50: SweetSpotBucketGate
  activity: {
    activeBuckets: Array<'20-30' | '30-50'>
    description: string
  }
  viable: boolean
  bothViable: boolean
  anyActivelyLosing: boolean
  phase2DeployMs: number
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
  sweetSpot: {
    gates: SweetSpotGates
    allGatesMet: boolean
    status: string
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
