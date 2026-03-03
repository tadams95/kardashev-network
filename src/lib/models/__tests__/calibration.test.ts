import { describe, it, expect } from 'vitest'
import {
  fitIsotonicRegression,
  calibrateProbability,
  trainCalibrationModel,
  getCalibrationConfidence,
  selectCalibrationModel,
  toCalibrationLeadBucket,
  buildCalibrationSegmentKey,
} from '../calibration'
import type { CalibrationModel, CalibrationPoint, CalibrationModelBundle } from '../calibration'

describe('fitIsotonicRegression', () => {
  it('returns empty array for empty input', () => {
    expect(fitIsotonicRegression([])).toEqual([])
  })

  it('produces monotonically non-decreasing breakpoints', () => {
    const points: CalibrationPoint[] = [
      { predicted: 0.1, actual: 0 },
      { predicted: 0.2, actual: 1 },
      { predicted: 0.3, actual: 0 },
      { predicted: 0.4, actual: 1 },
      { predicted: 0.5, actual: 1 },
      { predicted: 0.6, actual: 0 },
      { predicted: 0.7, actual: 1 },
      { predicted: 0.8, actual: 1 },
      { predicted: 0.9, actual: 1 },
    ]

    const breakpoints = fitIsotonicRegression(points)

    // Check monotonicity
    for (let i = 1; i < breakpoints.length; i++) {
      expect(breakpoints[i].y).toBeGreaterThanOrEqual(breakpoints[i - 1].y)
    }
  })

  it('preserves already monotonic data', () => {
    const points: CalibrationPoint[] = [
      { predicted: 0.2, actual: 0 },
      { predicted: 0.4, actual: 0 },
      { predicted: 0.6, actual: 1 },
      { predicted: 0.8, actual: 1 },
    ]

    const breakpoints = fitIsotonicRegression(points)
    expect(breakpoints.length).toBeGreaterThanOrEqual(2)

    for (let i = 1; i < breakpoints.length; i++) {
      expect(breakpoints[i].y).toBeGreaterThanOrEqual(breakpoints[i - 1].y)
    }
  })
})

describe('calibrateProbability', () => {
  it('returns raw value when no model is loaded', () => {
    const result = calibrateProbability(0.7, null)
    expect(result).toBe(0.7)
  })

  it('returns raw value when model has insufficient samples', () => {
    const model: CalibrationModel = {
      breakpoints: [{ x: 0.3, y: 0.4 }, { x: 0.7, y: 0.8 }],
      trainedAt: Date.now(),
      sampleSize: 10, // Below default minSamples of 50
      calibrationError: 0.05,
      brierBefore: 0.2,
      brierAfter: 0.15,
    }
    expect(calibrateProbability(0.5, model)).toBe(0.5)
  })

  it('interpolates correctly with a known model', () => {
    const model: CalibrationModel = {
      breakpoints: [
        { x: 0.2, y: 0.1 },
        { x: 0.5, y: 0.5 },
        { x: 0.8, y: 0.9 },
      ],
      trainedAt: Date.now(),
      sampleSize: 100,
      calibrationError: 0.05,
      brierBefore: 0.2,
      brierAfter: 0.15,
    }

    // Midpoint between breakpoints (0.2, 0.1) and (0.5, 0.5)
    // Raw = 0.35, t = (0.35 - 0.2) / (0.5 - 0.2) = 0.5
    // Calibrated = 0.1 + 0.5 * (0.5 - 0.1) = 0.3
    // After 10% identity smoothing: 0.9 * 0.3 + 0.1 * 0.35 = 0.305
    const result = calibrateProbability(0.35, model)
    expect(result).toBeCloseTo(0.305, 2)
  })
})

describe('trainCalibrationModel', () => {
  it('returns empty model for empty data', () => {
    const model = trainCalibrationModel([])
    expect(model.sampleSize).toBe(0)
    expect(model.breakpoints).toEqual([])
  })

  it('produces valid Brier scores', () => {
    // Generate some calibration data
    const data: CalibrationPoint[] = []
    for (let i = 0; i < 100; i++) {
      const predicted = Math.random()
      const actual = Math.random() < predicted ? 1 : 0
      data.push({ predicted, actual })
    }

    const model = trainCalibrationModel(data)

    expect(model.sampleSize).toBe(100)
    expect(model.brierBefore).toBeGreaterThanOrEqual(0)
    expect(model.brierBefore).toBeLessThanOrEqual(1)
    expect(model.brierAfter).toBeGreaterThanOrEqual(0)
    expect(model.brierAfter).toBeLessThanOrEqual(1)
    expect(model.breakpoints.length).toBeGreaterThan(0)
  })
})

describe('getCalibrationConfidence', () => {
  it('returns 0.5 with no model', () => {
    expect(getCalibrationConfidence(null)).toBe(0.5)
  })

  it('returns 0.5 with too few samples', () => {
    const model: CalibrationModel = {
      breakpoints: [],
      trainedAt: Date.now(),
      sampleSize: 10,
      calibrationError: 0,
      brierBefore: 0.2,
      brierAfter: 0.15,
    }
    expect(getCalibrationConfidence(model)).toBe(0.5)
  })

  it('returns higher confidence with good data', () => {
    const model: CalibrationModel = {
      breakpoints: [{ x: 0.5, y: 0.5 }],
      trainedAt: Date.now(),
      sampleSize: 200,
      calibrationError: 0.02,
      brierBefore: 0.25,
      brierAfter: 0.15,
    }
    const confidence = getCalibrationConfidence(model)
    expect(confidence).toBeGreaterThan(0.5)
    expect(confidence).toBeLessThanOrEqual(1.0)
  })
})

describe('selectCalibrationModel', () => {
  const makeModel = (sampleSize: number): CalibrationModel => ({
    breakpoints: [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.8 }],
    trainedAt: Date.now(),
    sampleSize,
    calibrationError: 0.05,
    brierBefore: 0.2,
    brierAfter: 0.18,
  })

  it('chooses segment model when sample threshold is met', () => {
    const key = buildCalibrationSegmentKey('temperature-high', '24to48h')
    const bundle: CalibrationModelBundle = {
      kind: 'segmented-v1',
      global: makeModel(500),
      byType: { 'temperature-high': makeModel(350) },
      bySegment: { [key]: makeModel(300) },
      minSamplesPerType: 200,
      minSamplesPerSegment: 200,
      trainedAt: Date.now(),
      sampleSize: 500,
    }

    const selected = selectCalibrationModel(bundle, {
      marketType: 'temperature-high',
      leadBucket: '24to48h',
    })

    expect(selected.route).toBe('segment')
    expect(selected.modelId).toBe(`segment:${key}`)
    expect(selected.model?.sampleSize).toBe(300)
  })

  it('falls back to type then global when segment is unavailable', () => {
    const bundle: CalibrationModelBundle = {
      kind: 'segmented-v1',
      global: makeModel(450),
      byType: { 'temperature-low': makeModel(240) },
      bySegment: {},
      minSamplesPerType: 200,
      minSamplesPerSegment: 200,
      trainedAt: Date.now(),
      sampleSize: 450,
    }

    const byType = selectCalibrationModel(bundle, {
      marketType: 'temperature-low',
      leadBucket: '12to24h',
    })
    expect(byType.route).toBe('type')

    const byGlobal = selectCalibrationModel(bundle, {
      marketType: 'precipitation',
      leadBucket: '12to24h',
    })
    expect(byGlobal.route).toBe('global')
  })
})

describe('toCalibrationLeadBucket', () => {
  it('maps lead hours to expected buckets', () => {
    expect(toCalibrationLeadBucket(6)).toBe('lt12h')
    expect(toCalibrationLeadBucket(18)).toBe('12to24h')
    expect(toCalibrationLeadBucket(36)).toBe('24to48h')
    expect(toCalibrationLeadBucket(60)).toBe('48to72h')
    expect(toCalibrationLeadBucket(90)).toBe('gt72h')
  })
})
