import { describe, it, expect } from 'vitest'
import { realizedPnlDollars } from '../tailSellTracker'

/**
 * realizedPnlDollars is the single source of truth for tail-sell P&L in real
 * dollars (pnl × filledCount), used by both getTailSellSummary and the daily-loss
 * circuit breaker. These cases lock the fill-aware semantics so the phantom-P&L
 * bug class (booking full premium off positionSize for orders that never filled)
 * cannot silently return.
 */
describe('realizedPnlDollars', () => {
  it('fully filled win → premium × filled contracts', () => {
    // sold YES @ 9¢, fee-netted per-contract win, 20 contracts filled
    expect(realizedPnlDollars({ pnl: 0.081, filledCount: 20 })).toBeCloseTo(1.62, 6)
  })

  it('fully filled loss → per-contract loss × filled contracts', () => {
    expect(realizedPnlDollars({ pnl: -0.9, filledCount: 20 })).toBeCloseTo(-18, 6)
  })

  it('partial fill is weighted by actual filledCount, not the ordered count', () => {
    // ordered 20 but only 5 filled → dollars must reflect 5, not 20
    expect(realizedPnlDollars({ pnl: -0.9, filledCount: 5 })).toBeCloseTo(-4.5, 6)
  })

  it('unfilled order (filledCount 0) contributes $0', () => {
    expect(realizedPnlDollars({ pnl: -0.9, filledCount: 0 })).toBe(0)
    expect(realizedPnlDollars({ pnl: 0.12, filledCount: 0 })).toBe(0)
  })

  it('resolved-before-reconciled row (filledCount undefined) contributes $0, NOT full premium', () => {
    // This is the phantom-P&L bug class: pnl was booked at resolution before
    // reconcileFills set filledCount. It must NOT book the premium.
    expect(realizedPnlDollars({ pnl: -0.9, filledCount: undefined })).toBe(0)
    expect(realizedPnlDollars({ pnl: 0.12 })).toBe(0)
  })

  it('null pnl is treated as $0', () => {
    expect(realizedPnlDollars({ pnl: null, filledCount: 20 })).toBe(0)
  })
})
