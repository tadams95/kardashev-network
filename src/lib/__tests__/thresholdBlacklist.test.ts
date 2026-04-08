import { describe, it, expect } from 'vitest'
import { isThresholdSignalBlacklisted } from '../computeOpportunities'

describe('isThresholdSignalBlacklisted', () => {
  describe('bidirectional cities (PHI/PHIL/DC/SEA)', () => {
    it('blacklists PHI in both directions', () => {
      expect(isThresholdSignalBlacklisted('PHI', 'above')).toBe(true)
      expect(isThresholdSignalBlacklisted('PHI', 'below')).toBe(true)
    })

    it('blacklists PHIL alias in both directions', () => {
      expect(isThresholdSignalBlacklisted('PHIL', 'above')).toBe(true)
      expect(isThresholdSignalBlacklisted('PHIL', 'below')).toBe(true)
    })

    it('blacklists DC in both directions', () => {
      expect(isThresholdSignalBlacklisted('DC', 'above')).toBe(true)
      expect(isThresholdSignalBlacklisted('DC', 'below')).toBe(true)
    })

    it('blacklists SEA in both directions', () => {
      expect(isThresholdSignalBlacklisted('SEA', 'above')).toBe(true)
      expect(isThresholdSignalBlacklisted('SEA', 'below')).toBe(true)
    })
  })

  describe('directional city (DEN — below only)', () => {
    it('blacklists DEN for below direction (cold tail suppressed)', () => {
      expect(isThresholdSignalBlacklisted('DEN', 'below')).toBe(true)
    })

    it('does NOT blacklist DEN for above direction (warm tail tradeable)', () => {
      expect(isThresholdSignalBlacklisted('DEN', 'above')).toBe(false)
    })
  })

  describe('inner brackets always allowed', () => {
    it.each(['PHI', 'PHIL', 'DC', 'SEA', 'DEN'])(
      'does not blacklist %s between direction',
      (city) => {
        expect(isThresholdSignalBlacklisted(city, 'between')).toBe(false)
      },
    )
  })

  describe('non-blacklisted cities', () => {
    it.each(['NY', 'NYC', 'BOS', 'LA', 'LAX', 'SF', 'SFO', 'MIA', 'ATL', 'LV', 'HOU', 'DAL', 'PHX', 'CHI', 'AUS'])(
      'does not blacklist %s in any direction',
      (city) => {
        expect(isThresholdSignalBlacklisted(city, 'above')).toBe(false)
        expect(isThresholdSignalBlacklisted(city, 'below')).toBe(false)
        expect(isThresholdSignalBlacklisted(city, 'between')).toBe(false)
      },
    )
  })

  describe('edge cases', () => {
    it('returns false for undefined direction (precipitation markets)', () => {
      expect(isThresholdSignalBlacklisted('PHI', undefined)).toBe(false)
      expect(isThresholdSignalBlacklisted('DEN', undefined)).toBe(false)
    })

    it('returns false for unknown city codes', () => {
      expect(isThresholdSignalBlacklisted('', 'above')).toBe(false)
      expect(isThresholdSignalBlacklisted('XXX', 'below')).toBe(false)
    })
  })

  describe('watch list cities (not yet blacklisted)', () => {
    it('NY is on the watch list but not blacklisted — Item B5 regime gate will decide', () => {
      expect(isThresholdSignalBlacklisted('NY', 'above')).toBe(false)
      expect(isThresholdSignalBlacklisted('NY', 'below')).toBe(false)
    })

    it('BOS is on the watch list but not blacklisted — Item B5 regime gate will decide', () => {
      expect(isThresholdSignalBlacklisted('BOS', 'above')).toBe(false)
      expect(isThresholdSignalBlacklisted('BOS', 'below')).toBe(false)
    })
  })
})
