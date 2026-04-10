import { describe, it, expect } from 'vitest'
import { isLowTempSignalBlacklisted } from '../computeOpportunities'

describe('isLowTempSignalBlacklisted (global low-temp gate)', () => {
  it('returns true for any low-temp market (global disable)', () => {
    expect(isLowTempSignalBlacklisted('low')).toBe(true)
  })

  it('returns false for high-temp markets', () => {
    expect(isLowTempSignalBlacklisted('high')).toBe(false)
  })

  it('returns false when marketType is undefined (rain/snow/other)', () => {
    // Critical regression guard: rain/snow markets pass through this path
    // with temperatureType=undefined and must not be suppressed.
    expect(isLowTempSignalBlacklisted(undefined)).toBe(false)
  })

  it('locks in that low-temp suppression is not dependent on any city allowlist', () => {
    // Regression guard against a future refactor that reintroduces a
    // per-city check and accidentally lets some cities through. The global
    // disable must suppress 'low' for every possible caller until the
    // coordinated Item B deployment ships and re-enables staged rollout.
    // LV has the best low-temp accuracy in Phase A data; if the gate is
    // ever relaxed accidentally, LV is the most likely city to slip through.
    // This test exists to fail loudly if that ever happens.
    expect(isLowTempSignalBlacklisted('low')).toBe(true)
  })
})
