import { describe, it, expect } from 'vitest'
import {
  wilsonUpperBound,
  evaluateWarmLowStops,
  WARMLOW_PNL_STOP,
  WARMLOW_WINRATE_STOP,
} from '../warmLowStops'

describe('wilsonUpperBound', () => {
  it('returns 1 with no data (no breach possible)', () => {
    expect(wilsonUpperBound(0, 0)).toBe(1)
  })
  it('is ~1 when every trade won', () => {
    expect(wilsonUpperBound(46, 46)).toBeGreaterThan(0.99)
  })
  it('is well below 92% for a genuinely low win rate', () => {
    expect(wilsonUpperBound(70, 100)).toBeLessThan(WARMLOW_WINRATE_STOP)
  })
  it('clears 92% for a high win rate', () => {
    expect(wilsonUpperBound(95, 100)).toBeGreaterThan(WARMLOW_WINRATE_STOP)
  })
})

describe('evaluateWarmLowStops', () => {
  it('DRAWDOWN stop: alerts when realized P&L reaches the threshold', () => {
    const s = evaluateWarmLowStops(WARMLOW_PNL_STOP, 40, 46) // exactly -$35
    expect(s.pnlBreached).toBe(true)
    expect(s.alert).toBe(true)
  })
  it('DRAWDOWN stop: does NOT alert just inside the threshold', () => {
    const s = evaluateWarmLowStops(-34.99, 40, 46) // winrate healthy at 40/46
    expect(s.pnlBreached).toBe(false)
    expect(s.winRateBreached).toBe(false)
    expect(s.alert).toBe(false)
  })
  it('WIN-RATE stop: alerts when Wilson upper bound falls below 92%', () => {
    const s = evaluateWarmLowStops(0, 70, 100)
    expect(s.winRateBreached).toBe(true)
    expect(s.wilsonUpper).toBeLessThan(WARMLOW_WINRATE_STOP)
    expect(s.alert).toBe(true)
  })
  it('WIN-RATE stop: does NOT alert when the upper bound clears 92%', () => {
    const s = evaluateWarmLowStops(0, 95, 100)
    expect(s.winRateBreached).toBe(false)
    expect(s.alert).toBe(false)
  })
  it('no data: no alert (wilsonUpper defaults to 1, P&L 0)', () => {
    const s = evaluateWarmLowStops(0, 0, 0)
    expect(s.alert).toBe(false)
    expect(s.winRate).toBeNull()
  })
})
