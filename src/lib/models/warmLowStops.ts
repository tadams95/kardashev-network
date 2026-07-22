/**
 * Warm-tail-LOW live stop thresholds (agreed in the 2026-07-22 A/B review; values are
 * decided, not re-derived here). Two independent stops — either triggers a revert-to-
 * paper DECISION (the job only alerts; a human flips the env):
 *   1. Drawdown:  cumulative realized warm-low P&L (filled-contract dollars) <= -$35.
 *   2. Win-rate:  Wilson 95% CI UPPER bound on cumulative live-filled win rate < 92%
 *                 (92% is ~break-even at the 8-9c live entry; if we can't be confident
 *                 the true win rate clears break-even, the edge is gone).
 */
export const WARMLOW_PNL_STOP = -35
export const WARMLOW_WINRATE_STOP = 0.92
export const WILSON_Z = 1.96 // 95%

/**
 * Wilson score interval UPPER bound for a binomial proportion. Wilson (not the normal
 * approximation) because it stays valid at small n and near p=1, exactly the regime a
 * high-win-rate tail-sell lives in. n=0 → 1 (no data ⇒ no breach).
 */
export function wilsonUpperBound(wins: number, n: number, z: number = WILSON_Z): number {
  if (n <= 0) return 1
  const p = wins / n
  const z2 = z * z
  const denom = 1 + z2 / n
  const center = p + z2 / (2 * n)
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)
  return (center + margin) / denom
}

export interface WarmLowStopStatus {
  realizedPnl: number
  nFilled: number
  wins: number
  winRate: number | null
  wilsonUpper: number
  pnlBreached: boolean
  winRateBreached: boolean
  alert: boolean
}

/** Evaluate both stops. Pure — the daily job supplies realizedPnl / wins / nFilled
 *  from the ledger and this decides whether to alert. */
export function evaluateWarmLowStops(
  realizedPnl: number,
  wins: number,
  nFilled: number,
): WarmLowStopStatus {
  const wilsonUpper = wilsonUpperBound(wins, nFilled)
  const pnlBreached = realizedPnl <= WARMLOW_PNL_STOP
  // n>0 guard makes the "no data ⇒ no breach" case explicit (wilsonUpper is 1 at n=0).
  const winRateBreached = nFilled > 0 && wilsonUpper < WARMLOW_WINRATE_STOP
  return {
    realizedPnl,
    nFilled,
    wins,
    winRate: nFilled > 0 ? wins / nFilled : null,
    wilsonUpper,
    pnlBreached,
    winRateBreached,
    alert: pnlBreached || winRateBreached,
  }
}
