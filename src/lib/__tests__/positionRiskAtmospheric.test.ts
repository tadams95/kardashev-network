import { describe, it, expect } from 'vitest'
import { classifyPositionRisk } from '../models/positionRiskTracker'

// Baseline inputs for a fresh emission (drift=0, spread unchanged, comfortable
// bracket distance). Atmospheric triggers are evaluated independently, so any
// non-OK riskLevel must come from the atmospheric inputs.
const COLD_HIGH_BASE = {
  direction: 'cold' as const,
  marketType: 'high' as const,
  bracketCapF: 80,
  bracketFloorF: null,           // open-ended threshold below
  signalForecastF: 86,
  signalSpreadF: 2.0,
  refreshedForecastF: 86,        // drift = 0
  refreshedSpreadF: 2.0,         // ratio = 1.0
}

const HOT_HIGH_BASE = {
  direction: 'warm' as const,
  marketType: 'high' as const,
  bracketCapF: 110,
  bracketFloorF: 92,
  signalForecastF: 86,
  signalSpreadF: 2.0,
  refreshedForecastF: 86,
  refreshedSpreadF: 2.0,
}

const WARM_LOW_BASE = {
  direction: 'warm' as const,
  marketType: 'low' as const,
  bracketCapF: 110,
  bracketFloorF: 65,
  signalForecastF: 58,
  signalSpreadF: 2.0,
  refreshedForecastF: 58,
  refreshedSpreadF: 2.0,
}

const COLD_LOW_BASE = {
  direction: 'cold' as const,
  marketType: 'low' as const,
  bracketCapF: 50,
  bracketFloorF: null,
  signalForecastF: 58,
  signalSpreadF: 2.0,
  refreshedForecastF: 58,
  refreshedSpreadF: 2.0,
}

describe('classifyPositionRisk — atmospheric inputs (Phase A)', () => {
  describe('backward compatibility', () => {
    it('without atmospheric input, fresh signal returns OK (cold-high)', () => {
      const out = classifyPositionRisk(COLD_HIGH_BASE)
      expect(out.riskLevel).toBe('OK')
      expect(out.triggers).toHaveLength(0)
    })

    it('without atmospheric input, fresh signal returns OK (hot-high)', () => {
      const out = classifyPositionRisk(HOT_HIGH_BASE)
      expect(out.riskLevel).toBe('OK')
    })

    it('atmospheric={} (all undefined) is identical to no atmospheric', () => {
      const without = classifyPositionRisk(COLD_HIGH_BASE)
      const withEmpty = classifyPositionRisk({ ...COLD_HIGH_BASE, atmospheric: {} })
      expect(withEmpty.riskLevel).toBe(without.riskLevel)
      expect(withEmpty.triggers).toEqual(without.triggers)
    })
  })

  describe('cold-side HIGH (live cold-tail) — cloudy/wet peak suppresses Tmax', () => {
    it('peak cloud > 70% fires WARN', () => {
      const out = classifyPositionRisk({
        ...COLD_HIGH_BASE,
        atmospheric: { peakCloudCoverMean: 92 },
      })
      expect(out.riskLevel).toBe('WARN')
      expect(out.triggers.some(t => t.includes('peak cloud 92%'))).toBe(true)
      expect(out.triggers.some(t => t.includes('cold-side HIGH suppressor'))).toBe(true)
    })

    it('peak cloud at 70% (boundary) does NOT fire (strict >)', () => {
      const out = classifyPositionRisk({
        ...COLD_HIGH_BASE,
        atmospheric: { peakCloudCoverMean: 70 },
      })
      expect(out.riskLevel).toBe('OK')
    })

    it('pre-peak precip > 0.25in fires WARN (evaporative cooling)', () => {
      const out = classifyPositionRisk({
        ...COLD_HIGH_BASE,
        atmospheric: { prePeakPrecip24hMean: 0.4 },
      })
      expect(out.riskLevel).toBe('WARN')
      expect(out.triggers.some(t => t.includes('evaporative cooling'))).toBe(true)
    })

    it('cloud > 70% AND precip > 0.25in promotes to CRITICAL via multi-WARN', () => {
      const out = classifyPositionRisk({
        ...COLD_HIGH_BASE,
        atmospheric: { peakCloudCoverMean: 100, prePeakPrecip24hMean: 0.4 },
      })
      expect(out.riskLevel).toBe('CRITICAL')
      expect(out.triggers[0]).toContain('multiple WARN conditions')
    })

    it('clear/dry peak (cloud=10, precip=0) does NOT fire (favorable for cold-side)', () => {
      const out = classifyPositionRisk({
        ...COLD_HIGH_BASE,
        atmospheric: { peakCloudCoverMean: 10, prePeakPrecip24hMean: 0 },
      })
      expect(out.riskLevel).toBe('OK')
    })
  })

  describe('hot-side HIGH (paper) — clear/dry peak amplifies Tmax', () => {
    it('peak cloud < 20% fires WARN', () => {
      const out = classifyPositionRisk({
        ...HOT_HIGH_BASE,
        atmospheric: { peakCloudCoverMean: 5 },
      })
      expect(out.riskLevel).toBe('WARN')
      expect(out.triggers.some(t => t.includes('hot-side HIGH amplifier'))).toBe(true)
    })

    it('cloud < 30% AND precip < 0.05in fires confirmatory dry-clear regime WARN', () => {
      // 25% cloud (does not fire primary <20% rule) + 0.01in precip → confirmatory only
      const out = classifyPositionRisk({
        ...HOT_HIGH_BASE,
        atmospheric: { peakCloudCoverMean: 25, prePeakPrecip24hMean: 0.01 },
      })
      expect(out.riskLevel).toBe('WARN')
      expect(out.triggers.some(t => t.includes('dry-clear regime'))).toBe(true)
    })

    it('cloud=10 AND precip=0 promotes to CRITICAL (primary + confirmatory both fire)', () => {
      const out = classifyPositionRisk({
        ...HOT_HIGH_BASE,
        atmospheric: { peakCloudCoverMean: 10, prePeakPrecip24hMean: 0 },
      })
      expect(out.riskLevel).toBe('CRITICAL')
      expect(out.triggers[0]).toContain('multiple WARN conditions')
    })

    it('overcast/wet peak (cloud=80, precip=0.5) does NOT fire (favorable for hot-side)', () => {
      const out = classifyPositionRisk({
        ...HOT_HIGH_BASE,
        atmospheric: { peakCloudCoverMean: 80, prePeakPrecip24hMean: 0.5 },
      })
      expect(out.riskLevel).toBe('OK')
    })
  })

  describe('warm-tail LOW (paper) — cloudy overnight lifts Tmin', () => {
    it('peak cloud > 70% fires WARN (warm-tail LOW lift)', () => {
      const out = classifyPositionRisk({
        ...WARM_LOW_BASE,
        atmospheric: { peakCloudCoverMean: 85 },
      })
      expect(out.riskLevel).toBe('WARN')
      expect(out.triggers.some(t => t.includes('warm-tail LOW lift'))).toBe(true)
    })

    it('clear overnight does NOT fire', () => {
      const out = classifyPositionRisk({
        ...WARM_LOW_BASE,
        atmospheric: { peakCloudCoverMean: 10 },
      })
      expect(out.riskLevel).toBe('OK')
    })
  })

  describe('cold-tail LOW (paper) — clear overnight depresses Tmin', () => {
    it('peak cloud < 20% fires WARN (radiative cooling)', () => {
      const out = classifyPositionRisk({
        ...COLD_LOW_BASE,
        atmospheric: { peakCloudCoverMean: 5 },
      })
      expect(out.riskLevel).toBe('WARN')
      expect(out.triggers.some(t => t.includes('radiative cooling'))).toBe(true)
    })

    it('cloudy overnight does NOT fire', () => {
      const out = classifyPositionRisk({
        ...COLD_LOW_BASE,
        atmospheric: { peakCloudCoverMean: 90 },
      })
      expect(out.riskLevel).toBe('OK')
    })
  })

  describe('drift bug fix (2026-05-04) — adverse drift magnitude is now positive', () => {
    it('cold-side adverse drift (forecast moves DOWN, into bracket) fires WARN at ≥2°F', () => {
      const out = classifyPositionRisk({
        ...COLD_HIGH_BASE,
        signalForecastF: 86,
        refreshedForecastF: 83.5,  // moved 2.5°F adverse for a cold-tail (bracket below)
      })
      expect(out.riskLevel).toBe('WARN')
      expect(out.triggers.some(t => t.includes('drift') && t.includes('adverse'))).toBe(true)
    })

    it('cold-side adverse drift ≥4°F fires CRITICAL', () => {
      const out = classifyPositionRisk({
        ...COLD_HIGH_BASE,
        signalForecastF: 86,
        refreshedForecastF: 81,  // 5°F adverse for cold-tail
        bracketCapF: 75,         // raise floor so we don't also trigger boundary
      })
      expect(out.riskLevel).toBe('CRITICAL')
      expect(out.triggers.some(t => t.startsWith('CRITICAL: drift'))).toBe(true)
    })

    it('cold-side FAVORABLE drift (forecast moves UP, away from bracket) does NOT fire', () => {
      const out = classifyPositionRisk({
        ...COLD_HIGH_BASE,
        signalForecastF: 86,
        refreshedForecastF: 90,  // moved away from cold-tail bracket
      })
      expect(out.riskLevel).toBe('OK')
    })

    it('hot-side adverse drift (forecast moves UP, into hot-tail bracket) fires WARN', () => {
      const out = classifyPositionRisk({
        ...HOT_HIGH_BASE,
        signalForecastF: 86,
        refreshedForecastF: 88.5,  // 2.5°F upward = adverse for warm-side
      })
      expect(out.riskLevel).toBe('WARN')
      expect(out.triggers.some(t => t.includes('drift'))).toBe(true)
    })
  })

  describe('atmospheric triggers do NOT fire on quadrants where they don\'t apply', () => {
    it('hot-side HIGH with cloudy peak (>70%) does NOT fire — cloudy is favorable for hot-tail', () => {
      const out = classifyPositionRisk({
        ...HOT_HIGH_BASE,
        atmospheric: { peakCloudCoverMean: 92 },
      })
      expect(out.riskLevel).toBe('OK')
    })

    it('cold-side HIGH with clear peak (<20%) does NOT fire — clear is favorable for cold-tail', () => {
      const out = classifyPositionRisk({
        ...COLD_HIGH_BASE,
        atmospheric: { peakCloudCoverMean: 5 },
      })
      expect(out.riskLevel).toBe('OK')
    })
  })
})
