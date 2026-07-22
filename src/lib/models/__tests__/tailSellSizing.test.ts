import { describe, it, expect } from 'vitest'
import { resolvePositionSize, positionSizeSource } from '../tailSellTracker'

/**
 * Per-city HIGH sizing (2026-07-22 cross-check). LOW must stay byte-identical at $5;
 * cold/high uses the per-city map (KEEP $20 / TRIM lower); unlisted → $15 default;
 * warm/high (hot-tail) untouched at $20. No mapped size may exceed the prior flat $20.
 */
describe('resolvePositionSize', () => {
  it('KEEP city (cold/high) sizes to $20', () => {
    for (const c of ['CHI', 'HOU', 'SF', 'NY', 'LV']) {
      expect(resolvePositionSize('cold', 'high', c)).toBe(20)
    }
  })

  it('TRIM city (cold/high) sizes to its mapped value', () => {
    expect(resolvePositionSize('cold', 'high', 'AUS')).toBe(15)
    expect(resolvePositionSize('cold', 'high', 'PHX')).toBe(15)
    expect(resolvePositionSize('cold', 'high', 'LA')).toBe(10)
    expect(resolvePositionSize('cold', 'high', 'MIA')).toBe(10)
  })

  it('unlisted city (cold/high) falls back to the $15 default', () => {
    expect(resolvePositionSize('cold', 'high', 'SEA')).toBe(15)
    expect(resolvePositionSize('cold', 'high', 'ZZZ')).toBe(15)
  })

  it('LOW quadrant stays $5 regardless of city or direction (byte-identical)', () => {
    expect(resolvePositionSize('warm', 'low', 'LA')).toBe(5)
    expect(resolvePositionSize('cold', 'low', 'CHI')).toBe(5)
    expect(resolvePositionSize('warm', 'low', 'ZZZ')).toBe(5)
  })

  it('warm/high (hot-tail) stays $20, not governed by the cold/high map', () => {
    expect(resolvePositionSize('warm', 'high', 'LA')).toBe(20)
    expect(resolvePositionSize('warm', 'high', 'CHI')).toBe(20)
  })

  it('no cold/high size ever exceeds the prior flat $20 (map only reduces)', () => {
    for (const c of ['CHI', 'HOU', 'SF', 'NY', 'LV', 'AUS', 'DAL', 'PHX', 'ATL', 'DEN', 'LA', 'BOS', 'DC', 'MIA', 'SEA']) {
      expect(resolvePositionSize('cold', 'high', c)).toBeLessThanOrEqual(20)
    }
  })
})

describe('positionSizeSource', () => {
  it('labels the sizing rule for placement logging', () => {
    expect(positionSizeSource('cold', 'high', 'CHI')).toBe('cold-high-map')
    expect(positionSizeSource('cold', 'high', 'SEA')).toBe('cold-high-default')
    expect(positionSizeSource('warm', 'low', 'NY')).toBe('low')
    expect(positionSizeSource('warm', 'high', 'LA')).toBe('warm-high')
  })
})
