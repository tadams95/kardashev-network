import { describe, it, expect } from 'vitest'
import { erf, gaussianCDF, normalCDF } from '../distributions'

describe('gaussianCDF', () => {
  it('is 0.5 at the mean', () => {
    expect(gaussianCDF(0)).toBeCloseTo(0.5, 6)
  })

  it('is symmetric about 0', () => {
    expect(gaussianCDF(1) + gaussianCDF(-1)).toBeCloseTo(1, 6)
  })

  it('matches known z-scores', () => {
    expect(gaussianCDF(1)).toBeCloseTo(0.8413, 3)
    expect(gaussianCDF(-1.96)).toBeCloseTo(0.025, 3)
  })
})

describe('erf', () => {
  it('is 0 at 0 and odd', () => {
    expect(erf(0)).toBeCloseTo(0, 6)
    expect(erf(1) + erf(-1)).toBeCloseTo(0, 6)
  })
})

describe('normalCDF', () => {
  it('is 0.5 at the mean', () => {
    expect(normalCDF(20, 20, 2)).toBeCloseTo(0.5, 6)
  })

  it('respects the ±1σ band', () => {
    const p = normalCDF(22, 20, 2) - normalCDF(18, 20, 2)
    expect(p).toBeCloseTo(0.6827, 3)
  })

  it('degenerates to a step function when stdDev <= 0', () => {
    expect(normalCDF(21, 20, 0)).toBe(1)
    expect(normalCDF(19, 20, 0)).toBe(0)
  })
})
