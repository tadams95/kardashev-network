import { describe, it, expect } from 'vitest'
import { isCrossCityStale } from '../useWeatherOpportunities'

describe('isCrossCityStale', () => {
  it('returns false when all cities match', () => {
    expect(isCrossCityStale('NY', 'New York', 'New York')).toBe(false)
  })

  it('returns true when forecast city mismatches', () => {
    expect(isCrossCityStale('NY', 'Chicago', 'New York')).toBe(true)
  })

  it('returns true when market city mismatches', () => {
    expect(isCrossCityStale('NY', 'New York', 'Chicago')).toBe(true)
  })

  it('returns true when both cities mismatch', () => {
    expect(isCrossCityStale('NY', 'Chicago', 'Boston')).toBe(true)
  })

  it('returns false when forecast city is undefined (loading)', () => {
    expect(isCrossCityStale('NY', undefined, 'New York')).toBe(false)
  })

  it('returns false when market city is undefined (loading)', () => {
    expect(isCrossCityStale('NY', 'New York', undefined)).toBe(false)
  })

  it('returns false when both undefined (initial load)', () => {
    expect(isCrossCityStale('NY', undefined, undefined)).toBe(false)
  })

  it('handles city aliases (NY/NYC share same name)', () => {
    expect(isCrossCityStale('NYC', 'New York', 'New York')).toBe(false)
    expect(isCrossCityStale('NY', 'New York', 'New York')).toBe(false)
  })

  it('handles LA/LAX alias', () => {
    expect(isCrossCityStale('LAX', 'Los Angeles', 'Los Angeles')).toBe(false)
  })

  it('returns false for unknown city code', () => {
    expect(isCrossCityStale('UNKNOWN', 'New York', 'New York')).toBe(false)
  })

  it('returns false (fail-open) when city coordinates unavailable — documents intentional behavior', () => {
    // If getCityCoordinates returns null, the guard is disabled for that city.
    // This is intentional: fail-open prevents blocking all signals when coordinates
    // are missing, at the cost of losing cross-city protection for that city code.
    expect(isCrossCityStale('UNKNOWN_CITY', 'New York', 'Boston')).toBe(false)
  })
})
