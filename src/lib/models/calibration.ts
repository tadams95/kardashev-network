// Probability calibration using isotonic regression
// Maps raw model probabilities to calibrated ones using historical (predicted, actual) pairs
// Isotonic regression is preferred for weather (non-sigmoid relationship)

// ============================================================================
// Types
// ============================================================================

export interface CalibrationPoint {
  predicted: number  // Raw model probability (0-1)
  actual: number     // Binary outcome (0 or 1)
}

export interface CalibrationModel {
  // Isotonic regression breakpoints: sorted list of (x, y) pairs
  // x = raw probability, y = calibrated probability
  breakpoints: Array<{ x: number; y: number }>
  // Metadata
  trainedAt: number
  sampleSize: number
  // Calibration quality metrics
  calibrationError: number  // Mean absolute calibration error
  brierBefore: number       // Brier score before calibration
  brierAfter: number        // Brier score after calibration
}

export type CalibrationMarketType = 'temperature-high' | 'temperature-low' | 'precipitation'
export type CalibrationLeadBucket = 'lt12h' | '12to24h' | '24to48h' | '48to72h' | 'gt72h'

export interface CalibrationModelBundle {
  kind: 'segmented-v1'
  global: CalibrationModel
  byType: Partial<Record<CalibrationMarketType, CalibrationModel>>
  bySegment: Record<string, CalibrationModel>
  minSamplesPerType: number
  minSamplesPerSegment: number
  trainedAt: number
  sampleSize: number
  version?: string    // e.g., "cal_1742860800000"
  dataEpoch?: number  // earliest training data timestamp
}

export interface CalibrationRouteInput {
  marketType?: CalibrationMarketType
  leadBucket?: CalibrationLeadBucket
}

export interface CalibrationRouteResult {
  model: CalibrationModel | null
  route: 'segment' | 'type' | 'global' | 'legacy' | 'none'
  modelId: string
}

export interface CalibrationConfig {
  minSamples: number        // Minimum samples needed before calibration is applied (default: 50)
  numBins: number           // Number of bins for reliability diagram (default: 10)
  smoothingWeight: number   // Blend weight with identity function (0=full calibration, 1=no calibration)
}

const DEFAULT_CONFIG: CalibrationConfig = {
  minSamples: 50,
  numBins: 10,
  smoothingWeight: 0.1, // 10% identity smoothing to prevent overfitting
}

export const DEFAULT_SEGMENT_MIN_SAMPLES = 200
export const DEFAULT_TYPE_MIN_SAMPLES = 200

export function toCalibrationLeadBucket(hoursToResolution: number): CalibrationLeadBucket {
  if (!isFinite(hoursToResolution)) return 'gt72h'
  if (hoursToResolution < 12) return 'lt12h'
  if (hoursToResolution < 24) return '12to24h'
  if (hoursToResolution < 48) return '24to48h'
  if (hoursToResolution < 72) return '48to72h'
  return 'gt72h'
}

export function buildCalibrationSegmentKey(
  marketType: CalibrationMarketType,
  leadBucket: CalibrationLeadBucket
): string {
  return `${marketType}:${leadBucket}`
}

export function isCalibrationModelBundle(value: unknown): value is CalibrationModelBundle {
  if (!value || typeof value !== 'object') return false
  const obj = value as Partial<CalibrationModelBundle>
  return obj.kind === 'segmented-v1' && !!obj.global && typeof obj.global === 'object'
}

export function selectCalibrationModel(
  modelOrBundle: CalibrationModel | CalibrationModelBundle | null,
  input: CalibrationRouteInput
): CalibrationRouteResult {
  if (!modelOrBundle) {
    return { model: null, route: 'none', modelId: 'none' }
  }

  if (!isCalibrationModelBundle(modelOrBundle)) {
    return { model: modelOrBundle, route: 'legacy', modelId: 'legacy:global' }
  }

  const bundle = modelOrBundle
  const marketType = input.marketType
  const leadBucket = input.leadBucket

  if (marketType && leadBucket) {
    const segmentKey = buildCalibrationSegmentKey(marketType, leadBucket)
    const segment = bundle.bySegment?.[segmentKey]
    if (segment && segment.sampleSize >= bundle.minSamplesPerSegment) {
      return { model: segment, route: 'segment', modelId: `segment:${segmentKey}` }
    }
  }

  if (marketType) {
    const byType = bundle.byType?.[marketType]
    if (byType && byType.sampleSize >= bundle.minSamplesPerType) {
      return { model: byType, route: 'type', modelId: `type:${marketType}` }
    }
  }

  if (bundle.global) {
    return { model: bundle.global, route: 'global', modelId: 'global' }
  }

  return { model: null, route: 'none', modelId: 'none' }
}

// ============================================================================
// Isotonic Regression (Pool Adjacent Violators Algorithm)
// ============================================================================

/**
 * Fit isotonic regression using the Pool Adjacent Violators (PAV) algorithm.
 * Guarantees monotonically non-decreasing output.
 *
 * @param points - Array of (predicted, actual) pairs
 * @returns Monotonic breakpoints for interpolation
 */
export function fitIsotonicRegression(
  points: CalibrationPoint[]
): Array<{ x: number; y: number }> {
  if (points.length === 0) return []

  // Sort by predicted probability
  const sorted = [...points].sort((a, b) => a.predicted - b.predicted)

  // PAV algorithm: pool adjacent violators
  // Start with each point as its own block
  const blocks: Array<{ sumX: number; sumY: number; count: number }> = sorted.map(p => ({
    sumX: p.predicted,
    sumY: p.actual,
    count: 1,
  }))

  // Iterate until no adjacent violators remain
  let changed = true
  while (changed) {
    changed = false
    let i = 0
    while (i < blocks.length - 1) {
      const avgCurrent = blocks[i].sumY / blocks[i].count
      const avgNext = blocks[i + 1].sumY / blocks[i + 1].count

      if (avgCurrent > avgNext) {
        // Violation: merge blocks
        blocks[i] = {
          sumX: blocks[i].sumX + blocks[i + 1].sumX,
          sumY: blocks[i].sumY + blocks[i + 1].sumY,
          count: blocks[i].count + blocks[i + 1].count,
        }
        blocks.splice(i + 1, 1)
        changed = true
      } else {
        i++
      }
    }
  }

  // Convert blocks to breakpoints
  const breakpoints: Array<{ x: number; y: number }> = blocks.map(b => ({
    x: b.sumX / b.count,
    y: b.sumY / b.count,
  }))

  return breakpoints
}

// ============================================================================
// Calibration Application
// ============================================================================

/**
 * Apply isotonic calibration to a raw probability.
 * Uses linear interpolation between breakpoints.
 *
 * @param rawProbability - Raw model probability (0-1)
 * @param model - Fitted calibration model
 * @param config - Calibration configuration
 * @returns Calibrated probability (0-1)
 */
export function calibrateProbability(
  rawProbability: number,
  model: CalibrationModel | null,
  config: CalibrationConfig = DEFAULT_CONFIG
): number {
  // If no model or insufficient samples, return raw probability
  if (!model || model.sampleSize < config.minSamples) {
    return rawProbability
  }

  const { breakpoints } = model

  if (breakpoints.length === 0) return rawProbability
  if (breakpoints.length === 1) return rawProbability

  // Find surrounding breakpoints for interpolation
  let calibrated: number

  if (rawProbability <= breakpoints[0].x) {
    // Extrapolate below first breakpoint
    calibrated = breakpoints[0].y
  } else if (rawProbability >= breakpoints[breakpoints.length - 1].x) {
    // Extrapolate above last breakpoint
    calibrated = breakpoints[breakpoints.length - 1].y
  } else {
    // Linear interpolation between breakpoints
    let i = 0
    while (i < breakpoints.length - 1 && breakpoints[i + 1].x < rawProbability) {
      i++
    }

    const x0 = breakpoints[i].x
    const y0 = breakpoints[i].y
    const x1 = breakpoints[i + 1].x
    const y1 = breakpoints[i + 1].y

    if (x1 === x0) {
      calibrated = (y0 + y1) / 2
    } else {
      const t = (rawProbability - x0) / (x1 - x0)
      calibrated = y0 + t * (y1 - y0)
    }
  }

  // Blend with identity function to prevent overfitting
  const blended = (1 - config.smoothingWeight) * calibrated + config.smoothingWeight * rawProbability

  // Clamp to valid range
  return Math.max(0.02, Math.min(0.95, blended))
}

// ============================================================================
// Model Training
// ============================================================================

/**
 * Train a calibration model from historical (predicted, actual) pairs.
 *
 * @param data - Historical predictions and outcomes
 * @param config - Calibration configuration
 * @returns Fitted calibration model
 */
export function trainCalibrationModel(
  data: CalibrationPoint[],
  config: CalibrationConfig = DEFAULT_CONFIG
): CalibrationModel {
  if (data.length === 0) {
    return {
      breakpoints: [],
      trainedAt: Date.now(),
      sampleSize: 0,
      calibrationError: 0,
      brierBefore: 0,
      brierAfter: 0,
    }
  }

  // Fit isotonic regression
  const breakpoints = fitIsotonicRegression(data)

  // Calculate Brier score before calibration
  const brierBefore = data.reduce(
    (sum, p) => sum + (p.predicted - p.actual) ** 2, 0
  ) / data.length

  // Calculate Brier score after calibration
  const tempModel: CalibrationModel = {
    breakpoints,
    trainedAt: Date.now(),
    sampleSize: data.length,
    calibrationError: 0,
    brierBefore: 0,
    brierAfter: 0,
  }

  const calibratedPredictions = data.map(p => ({
    predicted: calibrateProbability(p.predicted, tempModel, { ...config, minSamples: 0 }),
    actual: p.actual,
  }))

  const brierAfter = calibratedPredictions.reduce(
    (sum, p) => sum + (p.predicted - p.actual) ** 2, 0
  ) / data.length

  // Calculate calibration error (mean absolute error per bin)
  const calibrationError = calculateCalibrationError(data, config.numBins)

  return {
    breakpoints,
    trainedAt: Date.now(),
    sampleSize: data.length,
    calibrationError,
    brierBefore,
    brierAfter,
  }
}

// ============================================================================
// Reliability Diagram / Calibration Error
// ============================================================================

/**
 * Calculate mean absolute calibration error across bins.
 * Used for reliability diagram analysis.
 *
 * @param data - Historical predictions and outcomes
 * @param numBins - Number of probability bins
 * @returns Mean absolute calibration error (0 = perfect, 1 = worst)
 */
export function calculateCalibrationError(
  data: CalibrationPoint[],
  numBins: number = 10
): number {
  if (data.length === 0) return 0

  const binWidth = 1.0 / numBins
  let totalError = 0
  let activeBins = 0

  for (let i = 0; i < numBins; i++) {
    const binLow = i * binWidth
    const binHigh = (i + 1) * binWidth
    const binData = data.filter(p => p.predicted >= binLow && p.predicted < binHigh)

    if (binData.length === 0) continue

    const avgPredicted = binData.reduce((s, p) => s + p.predicted, 0) / binData.length
    const avgActual = binData.reduce((s, p) => s + p.actual, 0) / binData.length

    totalError += Math.abs(avgPredicted - avgActual)
    activeBins++
  }

  return activeBins > 0 ? totalError / activeBins : 0
}

/**
 * Generate reliability diagram data for visualization.
 *
 * @param data - Historical predictions and outcomes
 * @param numBins - Number of probability bins
 * @returns Array of bin data for plotting
 */
export function generateReliabilityDiagram(
  data: CalibrationPoint[],
  numBins: number = 10
): Array<{
  binCenter: number
  avgPredicted: number
  avgActual: number
  count: number
}> {
  const binWidth = 1.0 / numBins
  const result: Array<{
    binCenter: number
    avgPredicted: number
    avgActual: number
    count: number
  }> = []

  for (let i = 0; i < numBins; i++) {
    const binLow = i * binWidth
    const binHigh = (i + 1) * binWidth
    const binCenter = (binLow + binHigh) / 2
    const binData = data.filter(p => p.predicted >= binLow && p.predicted < binHigh)

    if (binData.length === 0) {
      result.push({ binCenter, avgPredicted: binCenter, avgActual: 0, count: 0 })
      continue
    }

    result.push({
      binCenter,
      avgPredicted: binData.reduce((s, p) => s + p.predicted, 0) / binData.length,
      avgActual: binData.reduce((s, p) => s + p.actual, 0) / binData.length,
      count: binData.length,
    })
  }

  return result
}

// ============================================================================
// Cross-Validation
// ============================================================================

export interface CrossValidationResult {
  avgBrierBefore: number
  avgBrierAfter: number
  brierImprovement: number
  folds: Array<{
    fold: number
    trainSize: number
    testSize: number
    brierBefore: number
    brierAfter: number
    improvement: number
  }>
  reliabilityBins: Array<{
    binCenter: number
    avgPredicted: number
    avgActual: number
    count: number
  }>
}

/**
 * K-fold cross-validation for calibration.
 * Sorted split (index % folds) for reproducibility — each fold covers full probability range.
 */
export function crossValidateCalibration(
  points: CalibrationPoint[],
  folds: number = 5,
  config: CalibrationConfig = DEFAULT_CONFIG
): CrossValidationResult {
  // Sort by predicted for stratified folds
  const sorted = [...points].sort((a, b) => a.predicted - b.predicted)

  const foldResults: CrossValidationResult['folds'] = []
  let totalBrierBefore = 0
  let totalBrierAfter = 0

  for (let f = 0; f < folds; f++) {
    const testSet: CalibrationPoint[] = []
    const trainSet: CalibrationPoint[] = []

    for (let i = 0; i < sorted.length; i++) {
      if (i % folds === f) {
        testSet.push(sorted[i])
      } else {
        trainSet.push(sorted[i])
      }
    }

    if (trainSet.length < config.minSamples || testSet.length === 0) continue

    const model = trainCalibrationModel(trainSet, config)

    const brierBefore = testSet.reduce(
      (sum, p) => sum + (p.predicted - p.actual) ** 2, 0
    ) / testSet.length

    const brierAfter = testSet.reduce(
      (sum, p) => sum + (calibrateProbability(p.predicted, model, { ...config, minSamples: 0 }) - p.actual) ** 2, 0
    ) / testSet.length

    foldResults.push({
      fold: f,
      trainSize: trainSet.length,
      testSize: testSet.length,
      brierBefore,
      brierAfter,
      improvement: brierBefore - brierAfter,
    })

    totalBrierBefore += brierBefore
    totalBrierAfter += brierAfter
  }

  const activeFolds = foldResults.length || 1
  const avgBrierBefore = totalBrierBefore / activeFolds
  const avgBrierAfter = totalBrierAfter / activeFolds

  // Generate reliability diagram from full dataset for context
  const reliabilityBins = generateReliabilityDiagram(points, config.numBins)

  return {
    avgBrierBefore,
    avgBrierAfter,
    brierImprovement: avgBrierBefore - avgBrierAfter,
    folds: foldResults,
    reliabilityBins,
  }
}

/**
 * Calculate calibration confidence score (0-1).
 * Higher values indicate the model is well-calibrated and has enough data.
 * Used to scale Kelly fraction in dynamic position sizing.
 */
export function getCalibrationConfidence(model: CalibrationModel | null): number {
  if (!model || model.sampleSize < 30) return 0.5 // Low confidence without data

  // Factor 1: Sample size (more data = more confidence)
  const sampleFactor = Math.min(1.0, model.sampleSize / 200) // Maxes out at 200 samples

  // Factor 2: Calibration quality (lower error = higher confidence)
  const errorFactor = Math.max(0, 1 - model.calibrationError * 5) // 0 error = 1.0, 0.2 error = 0

  // Factor 3: Improvement from calibration
  const improvementFactor = model.brierBefore > 0
    ? Math.min(1.0, (model.brierBefore - model.brierAfter) / model.brierBefore + 0.5)
    : 0.5

  return Math.min(1.0, sampleFactor * 0.4 + errorFactor * 0.4 + improvementFactor * 0.2)
}
