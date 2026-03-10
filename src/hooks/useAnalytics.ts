// SWR hook for weather analytics dashboard data
// IMPORTANT: All types defined locally to avoid importing from server-side modules
// (performanceTracker.ts imports getDb/MongoDB which would contaminate the client bundle)

import useSWR from 'swr'
import type { BacktestResult } from '@/types/weather'

// Mirror of PerformanceSnapshot fields needed client-side
export interface AnalyticsSnapshot {
  windowSize: number
  totalSignals: number
  resolvedSignals: number
  winRate: number
  brierScore: number
  marketBrierScore: number
  brierSkillScore: number
  averageEdge: number
  avgReturn: number
  calibrationError: number
  modelDecay: boolean
  recommendedMinEdge: number
  timestamp: number
}

export interface ReliabilityBin {
  binCenter: number
  avgPredicted: number
  avgActual: number
  count: number
}

export interface PnLGroupSummary {
  key: string
  trades: number
  wins: number
  winRate: number
  grossProfit: number
  totalFees: number
  netProfit: number
  avgReturn: number
}

export interface AnalyticsData {
  snapshot: AnalyticsSnapshot
  reliabilityBins: ReliabilityBin[]
  reliabilitySampleSize: number
  pnlBreakdown: {
    byCity: PnLGroupSummary[]
    byMarketType: PnLGroupSummary[]
    byLeadBucket: PnLGroupSummary[]
    overall: PnLGroupSummary
  }
  trades: BacktestResult[]
}

const fetcher = (url: string) => fetch(url).then(r => r.json()).then(r => {
  if (!r.success) throw new Error(r.error || 'Failed to fetch analytics')
  return r.data as AnalyticsData
})

export function useAnalytics() {
  return useSWR<AnalyticsData>(
    '/api/weather/performance?view=analytics',
    fetcher,
    { refreshInterval: 5 * 60_000, revalidateOnFocus: false }
  )
}
