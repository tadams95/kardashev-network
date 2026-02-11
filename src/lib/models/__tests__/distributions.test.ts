import { describe, it, expect } from 'vitest'
import {
  buildKDE,
  kdeTemperatureProbability,
  kdeBracketProbability,
} from '../distributions'

describe('buildKDE', () => {
  it('throws on empty samples', () => {
    expect(() => buildKDE([])).toThrow('Cannot build KDE from empty samples')
  })

  it('returns valid KDE result with single sample', () => {
    const kde = buildKDE([20])
    expect(kde.mean).toBe(20)
    expect(kde.sampleSize).toBe(1)
    expect(kde.bandwidth).toBeGreaterThanOrEqual(1.0) // minimum bandwidth floor
    expect(kde.density(20)).toBeGreaterThan(0)
  })

  it('respects minimum bandwidth floor of 1.0', () => {
    // All same values -> raw stdDev = 0, should use floor
    const kde = buildKDE([25, 25, 25, 25])
    expect(kde.bandwidth).toBeGreaterThanOrEqual(1.0)
  })

  it('handles bimodal data reasonably', () => {
    // Two clusters: around 10 and around 30
    const samples = [9, 10, 11, 10, 29, 30, 31, 30]
    const kde = buildKDE(samples)

    // Density should be positive at both cluster centers
    expect(kde.density(10)).toBeGreaterThan(0)
    expect(kde.density(30)).toBeGreaterThan(0)

    // Density at midpoint between clusters should be lower than at either peak
    const midDensity = kde.density(20)
    expect(midDensity).toBeLessThan(kde.density(10))
    expect(midDensity).toBeLessThan(kde.density(30))
  })
})

describe('exceedanceProbability', () => {
  it('returns approximately 0.5 at the mean for symmetric data', () => {
    const samples = [18, 19, 20, 21, 22]
    const kde = buildKDE(samples)

    // P(X > mean) should be close to 0.5 for symmetric distribution
    const prob = kde.exceedanceProbability(20)
    expect(prob).toBeGreaterThan(0.3)
    expect(prob).toBeLessThan(0.7)
  })

  it('returns high probability for threshold well below the data', () => {
    const samples = [25, 26, 27, 28, 29]
    const kde = buildKDE(samples)

    const prob = kde.exceedanceProbability(15)
    expect(prob).toBeGreaterThan(0.9)
  })

  it('returns low probability for threshold well above the data', () => {
    const samples = [25, 26, 27, 28, 29]
    const kde = buildKDE(samples)

    const prob = kde.exceedanceProbability(40)
    expect(prob).toBeLessThan(0.1)
  })
})

describe('intervalProbability', () => {
  it('returns high probability for a bracket centered on the mean', () => {
    const samples = [18, 19, 20, 21, 22]
    const kde = buildKDE(samples)

    // Wide bracket around mean should capture most density
    const prob = kde.intervalProbability(15, 25)
    expect(prob).toBeGreaterThan(0.8)
  })

  it('returns near-zero for bracket far from data', () => {
    const samples = [20, 21, 22, 23, 24]
    const kde = buildKDE(samples)

    const prob = kde.intervalProbability(50, 60)
    expect(prob).toBeLessThan(0.05)
  })
})

describe('kdeTemperatureProbability', () => {
  it('returns 0.5 for empty temperatures', () => {
    expect(kdeTemperatureProbability([], 20, 'above')).toBe(0.5)
  })

  it('returns above probability for threshold below data', () => {
    const temps = [30, 31, 32, 33, 34]
    const prob = kdeTemperatureProbability(temps, 20, 'above')
    expect(prob).toBeGreaterThan(0.9)
  })

  it('returns below probability for threshold above data', () => {
    const temps = [20, 21, 22, 23, 24]
    const prob = kdeTemperatureProbability(temps, 35, 'below')
    expect(prob).toBeGreaterThan(0.9)
  })
})

describe('kdeBracketProbability', () => {
  it('returns 0.1 for empty temperatures', () => {
    expect(kdeBracketProbability([], 20, 30)).toBe(0.1)
  })

  it('returns high probability when data is within bracket', () => {
    const temps = [24, 25, 26, 27, 28]
    const prob = kdeBracketProbability(temps, 20, 32)
    expect(prob).toBeGreaterThan(0.8)
  })
})
