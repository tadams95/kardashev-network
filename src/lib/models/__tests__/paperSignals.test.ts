import { describe, it, expect } from 'vitest'
import {
  qualifiesAsPaperInnerBracket,
  PAPER_LEAD_MIN_HOURS,
  PAPER_LEAD_MAX_HOURS,
  PAPER_PRICE_MIN,
  PAPER_PRICE_MAX,
  PAPER_MIN_EDGE,
  type PaperQualifyInput,
} from '../paperSignals'

const baseInput: PaperQualifyInput = {
  correctedProbability: 0.18,
  marketPrice: 0.30,
  hoursToResolution: 30,
  marketType: 'high',
  bracketRegime: 'inner',
}

describe('qualifiesAsPaperInnerBracket', () => {
  describe('happy path', () => {
    it('qualifies with default inputs (NO bet, 30h, 30¢ market, 12pp edge)', () => {
      const r = qualifiesAsPaperInnerBracket(baseInput)
      expect(r.qualifies).toBe(true)
      if (r.qualifies) {
        expect(r.edge).toBeCloseTo(0.12, 5)
        expect(r.leadBucket).toBe('24to36h')
      }
    })

    it('qualifies for high temperature markets', () => {
      const r = qualifiesAsPaperInnerBracket({ ...baseInput, marketType: 'high' })
      expect(r.qualifies).toBe(true)
    })

    it('qualifies for low temperature markets', () => {
      const r = qualifiesAsPaperInnerBracket({ ...baseInput, marketType: 'low' })
      expect(r.qualifies).toBe(true)
    })
  })

  describe('lead-time boundaries', () => {
    it('rejects just below the min lead', () => {
      const r = qualifiesAsPaperInnerBracket({ ...baseInput, hoursToResolution: PAPER_LEAD_MIN_HOURS - 0.01 })
      expect(r).toEqual({ qualifies: false, reason: 'lead_too_short' })
    })

    it('accepts at the exact min lead', () => {
      const r = qualifiesAsPaperInnerBracket({ ...baseInput, hoursToResolution: PAPER_LEAD_MIN_HOURS })
      expect(r.qualifies).toBe(true)
      if (r.qualifies) expect(r.leadBucket).toBe('12to24h')
    })

    it('accepts just below the max lead', () => {
      const r = qualifiesAsPaperInnerBracket({ ...baseInput, hoursToResolution: PAPER_LEAD_MAX_HOURS - 0.01 })
      expect(r.qualifies).toBe(true)
      if (r.qualifies) expect(r.leadBucket).toBe('36to48h')
    })

    it('rejects at the exact max lead (exclusive)', () => {
      const r = qualifiesAsPaperInnerBracket({ ...baseInput, hoursToResolution: PAPER_LEAD_MAX_HOURS })
      expect(r).toEqual({ qualifies: false, reason: 'lead_too_long' })
    })

    it('rejects far-out leads', () => {
      const r = qualifiesAsPaperInnerBracket({ ...baseInput, hoursToResolution: 96 })
      expect(r).toEqual({ qualifies: false, reason: 'lead_too_long' })
    })

    it('assigns 12to24h for 23.99h', () => {
      const r = qualifiesAsPaperInnerBracket({ ...baseInput, hoursToResolution: 23.99 })
      expect(r.qualifies).toBe(true)
      if (r.qualifies) expect(r.leadBucket).toBe('12to24h')
    })

    it('assigns 24to36h for exactly 24h', () => {
      const r = qualifiesAsPaperInnerBracket({ ...baseInput, hoursToResolution: 24 })
      expect(r.qualifies).toBe(true)
      if (r.qualifies) expect(r.leadBucket).toBe('24to36h')
    })

    it('assigns 24to36h for 35.99h', () => {
      const r = qualifiesAsPaperInnerBracket({ ...baseInput, hoursToResolution: 35.99 })
      expect(r.qualifies).toBe(true)
      if (r.qualifies) expect(r.leadBucket).toBe('24to36h')
    })

    it('assigns 36to48h for exactly 36h', () => {
      const r = qualifiesAsPaperInnerBracket({ ...baseInput, hoursToResolution: 36 })
      expect(r.qualifies).toBe(true)
      if (r.qualifies) expect(r.leadBucket).toBe('36to48h')
    })
  })

  describe('price boundaries', () => {
    it('rejects price just below the min', () => {
      const r = qualifiesAsPaperInnerBracket({ ...baseInput, marketPrice: PAPER_PRICE_MIN - 0.001, correctedProbability: 0.10 })
      expect(r).toEqual({ qualifies: false, reason: 'price_below_band' })
    })

    it('accepts price at the exact min', () => {
      const r = qualifiesAsPaperInnerBracket({ ...baseInput, marketPrice: PAPER_PRICE_MIN, correctedProbability: 0.10 })
      expect(r.qualifies).toBe(true)
    })

    it('accepts price just below the max', () => {
      const r = qualifiesAsPaperInnerBracket({ ...baseInput, marketPrice: PAPER_PRICE_MAX - 0.001, correctedProbability: 0.20 })
      expect(r.qualifies).toBe(true)
    })

    it('rejects price at the exact max (exclusive)', () => {
      const r = qualifiesAsPaperInnerBracket({ ...baseInput, marketPrice: PAPER_PRICE_MAX, correctedProbability: 0.30 })
      expect(r).toEqual({ qualifies: false, reason: 'price_above_band' })
    })

    it('rejects 50¢ markets', () => {
      const r = qualifiesAsPaperInnerBracket({ ...baseInput, marketPrice: 0.50, correctedProbability: 0.30 })
      expect(r).toEqual({ qualifies: false, reason: 'price_above_band' })
    })

    it('rejects 10¢ markets', () => {
      const r = qualifiesAsPaperInnerBracket({ ...baseInput, marketPrice: 0.10, correctedProbability: 0.05 })
      expect(r).toEqual({ qualifies: false, reason: 'price_below_band' })
    })
  })

  describe('direction (NO-only)', () => {
    it('rejects YES bets (corrected > market)', () => {
      const r = qualifiesAsPaperInnerBracket({ ...baseInput, correctedProbability: 0.40, marketPrice: 0.30 })
      expect(r).toEqual({ qualifies: false, reason: 'wrong_direction' })
    })

    it('rejects when corrected exactly equals market', () => {
      const r = qualifiesAsPaperInnerBracket({ ...baseInput, correctedProbability: 0.30, marketPrice: 0.30 })
      expect(r).toEqual({ qualifies: false, reason: 'wrong_direction' })
    })
  })

  describe('edge magnitude', () => {
    it('rejects edge just below 5pp', () => {
      const r = qualifiesAsPaperInnerBracket({ ...baseInput, marketPrice: 0.30, correctedProbability: 0.25 + 0.001 })
      expect(r).toEqual({ qualifies: false, reason: 'edge_too_small' })
    })

    it('accepts edge at exactly 5pp', () => {
      const r = qualifiesAsPaperInnerBracket({ ...baseInput, marketPrice: 0.30, correctedProbability: 0.25 })
      expect(r.qualifies).toBe(true)
      if (r.qualifies) expect(r.edge).toBeCloseTo(PAPER_MIN_EDGE, 5)
    })

    it('reports the edge precisely on qualification', () => {
      const r = qualifiesAsPaperInnerBracket({ ...baseInput, marketPrice: 0.35, correctedProbability: 0.20 })
      expect(r.qualifies).toBe(true)
      if (r.qualifies) expect(r.edge).toBeCloseTo(0.15, 5)
    })
  })

  describe('bracket regime', () => {
    it('rejects threshold-regime brackets even if other criteria pass', () => {
      const r = qualifiesAsPaperInnerBracket({ ...baseInput, bracketRegime: 'threshold' })
      expect(r).toEqual({ qualifies: false, reason: 'threshold_bracket' })
    })

    it('rejects threshold regime FIRST, before other checks', () => {
      // input fails several criteria but threshold check should fire first
      const r = qualifiesAsPaperInnerBracket({
        ...baseInput,
        bracketRegime: 'threshold',
        hoursToResolution: 100,
        marketPrice: 0.05,
      })
      expect(r).toEqual({ qualifies: false, reason: 'threshold_bracket' })
    })
  })

  describe('rejection priority order', () => {
    // Ensures the rejection-reason histogram is interpretable:
    // 1) threshold_bracket > 2) lead > 3) price > 4) direction > 5) edge
    it('lead_too_short fires before price checks', () => {
      const r = qualifiesAsPaperInnerBracket({
        ...baseInput,
        hoursToResolution: 5,
        marketPrice: 0.10,
      })
      expect(r).toEqual({ qualifies: false, reason: 'lead_too_short' })
    })

    it('price_above_band fires before direction check', () => {
      const r = qualifiesAsPaperInnerBracket({
        ...baseInput,
        marketPrice: 0.50,
        correctedProbability: 0.60, // would also be wrong_direction
      })
      expect(r).toEqual({ qualifies: false, reason: 'price_above_band' })
    })

    it('wrong_direction fires before edge check', () => {
      const r = qualifiesAsPaperInnerBracket({
        ...baseInput,
        marketPrice: 0.30,
        correctedProbability: 0.31, // wrong direction by 1pp
      })
      expect(r).toEqual({ qualifies: false, reason: 'wrong_direction' })
    })
  })
})
