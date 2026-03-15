# Probability Model Redesign Spec: BMA Migration

**Status:** Active — implementation ready
**Date:** 2026-03-14
**Last updated:** 2026-03-14 (post-audit revision)
**Context:** Three independent AI reviews (GPT 5.4, Gemini 3, Grok) unanimously identified BMA as the correct architectural path. Post-fix audit (Mar 14) confirmed KDE compression is the root cause of -1.09 BSS / 0/56 STRONG_YES wins. Phase 1 (dynamic bandwidth via KDE) is skipped — go directly to Phase 2 (BMA).

---

## Audit Summary (Mar 14 2026) — Why We're Here

Three operational fixes were deployed (weight TTL alignment, tail guard, calibration retrain). BSS did not move: -1.209 → -1.09. The post-fix audit identified the root cause:

| Finding | Detail |
|---------|--------|
| KDE compression | When model predicts 55%, actual YES rate is 3.6%. Inverted above 40%. |
| STRONG_YES | 0 wins out of 56 signals. Signal path killed (YES_SIGNALS_ENABLED = false). |
| Tail guard | Tightened to 20–50¢ only. That is the only competitive range (BSS ~-0.35, ~52% win rate). |
| Weight prior | Near-uniform (Tier 1 ~48%, Tier 2 ~52%) despite 2x MAE gap. Bayesian shrinkage toward wrong prior. |
| Calibration | Currently a no-op (≤1 breakpoint). Will be retrained after BMA is stable. |

**Pre-BMA baseline:** NO-only, 20–50¢, ~47% win rate on 123 signals. This is the number BMA must beat.

---

## What We Dropped From the Original Spec

**Phase 1 (dynamic bandwidth via KDE) is skipped entirely.**

Rationale: Phase 1 replaced the fixed stdDev floor with a data-driven σ_aleatoric while keeping the KDE engine. The KDE engine itself is the problem — not just the floor values. The calibration inversion table (predicted 55% → actual 3.6%) is structural KDE compression, not a floor calibration issue. Phase 1 would take a week to validate and produce marginal improvement at best before being replaced by Phase 2 anyway.

The σ_aleatoric lookup table originally scoped for Phase 1 is still needed — it becomes the per-source σ_i floor in BMA Phase 2. Compute it once as a prerequisite, use it directly in BMA.

**`calculateDynamicStdDevFloor()` is kept as a fallback** during the BMA transition. It is not deleted.

---

## Current Scope: Three Tasks in Order

### Task 1 — Compute σ_aleatoric from source_accuracy (Prerequisite)
### Task 2 — BMA Implementation (Phase 2)
### Task 3 — Fix Dynamic Weight Prior (Part of Task 2)

Calibration retraining (originally Phase 3) is deferred until BMA is stable with 50+ resolved predictions.

---

## Task 1: Compute σ_aleatoric from source_accuracy

### What It Is

σ_aleatoric is the irreducible forecast error — the RMSE of the ensemble mean after accounting for source correlation. It replaces the fixed stdDev floors in `calculateDynamicStdDevFloor()` and becomes the per-source σ_i floor in BMA.

### Data Available

| Metric | Value (as of Mar 14 2026) |
|--------|--------------------------|
| Total clean records | 1,943 |
| Date range | Mar 5–14 (9 days) |
| Records per Tier 1 source | ~398 |
| BMA lead bucket readiness | All 4 buckets ready (123 / 495 / 526 / 799) |

Per-source MAE (clean data):

| Source | MAE (°F) | MAE (°C) | Tier |
|--------|----------|----------|------|
| NWS | 1.97 | 1.09 | 1 |
| AccuWeather | 2.18 | 1.21 | 1 |
| Open-Meteo | 3.82 | 2.12 | 2 |
| Google-Weather | 3.82 | 2.12 | 3 |
| Tomorrow.io | 3.85 | 2.14 | 3 |

Note: Tomorrow.io has 357 records vs 398 for other sources (~10% dropout). σ_i for Tomorrow.io will be slightly less stable — acceptable for initial BMA.

### Computation Script

Run against production MongoDB before implementing BMA:

```javascript
// Compute ensemble-mean RMSE by lead time bucket
// Output: σ_aleatoric table for BMA initialization
db.source_accuracy.aggregate([
  // Group by (marketId, source) to get per-event per-source records
  { $group: {
    _id: { marketId: "$marketId", source: "$source" },
    forecastTemp: { $first: "$forecastTemp" },
    actualTemp: { $first: "$actualTemp" },
    leadHours: { $first: "$leadHours" }
  }},
  // Compute ensemble mean per event
  { $group: {
    _id: "$_id.marketId",
    meanForecast: { $avg: "$forecastTemp" },
    actual: { $first: "$actualTemp" },
    leadHours: { $first: "$leadHours" }
  }},
  // Squared error of ensemble mean + lead bucket label
  { $addFields: {
    squaredError: { $pow: [{ $subtract: ["$meanForecast", "$actual"] }, 2] },
    leadBucket: {
      $switch: {
        branches: [
          { case: { $lte: ["$leadHours", 18] }, then: "lt18h" },
          { case: { $lte: ["$leadHours", 30] }, then: "lt30h" },
          { case: { $lte: ["$leadHours", 42] }, then: "lt42h" }
        ],
        default: "gt42h"
      }
    }
  }},
  // RMSE by lead bucket
  { $group: {
    _id: "$leadBucket",
    rmse_f: { $avg: "$squaredError" },
    count: { $sum: 1 }
  }},
  { $addFields: {
    rmse_f: { $sqrt: "$rmse_f" },
    rmse_c: { $divide: [{ $sqrt: "$rmse_f" }, 1.8] }
  }},
  { $sort: { _id: 1 } }
])
```

Also run per-source RMSE (needed for BMA per-source σ_i):

```javascript
// Per-source RMSE by lead bucket
db.source_accuracy.aggregate([
  { $addFields: {
    squaredError: { $pow: ["$error", 2] },
    leadBucket: {
      $switch: {
        branches: [
          { case: { $lte: ["$leadHours", 18] }, then: "lt18h" },
          { case: { $lte: ["$leadHours", 30] }, then: "lt30h" },
          { case: { $lte: ["$leadHours", 42] }, then: "lt42h" }
        ],
        default: "gt42h"
      }
    }
  }},
  { $group: {
    _id: { source: "$source", leadBucket: "$leadBucket" },
    rmse_f: { $avg: "$squaredError" },
    count: { $sum: 1 }
  }},
  { $addFields: { rmse_f: { $sqrt: "$rmse_f" }, rmse_c: { $divide: [{ $sqrt: "$rmse_f" }, 1.8] } }},
  { $sort: { "_id.source": 1, "_id.leadBucket": 1 } }
])
```

**Rule:** If any lead bucket has <30 events for a given source, use the global per-source RMSE (pooled across lead times) as the σ_i for that bucket. Do not fall back to the fixed floor — fall back to pooled.

### Expected Output

Populate these tables before BMA implementation:

```typescript
// σ_aleatoric by lead bucket (ensemble mean RMSE, °C)
// Populated from script output — replace estimates with actuals
const SIGMA_ALEATORIC_TABLE: Record<string, number> = {
  'lt18h':  0.0,  // Replace with script output
  'lt30h':  0.0,  // Replace with script output
  'lt42h':  0.0,  // Replace with script output
  'gt42h':  0.0,  // Replace with script output
}

// Per-source σ_i by lead bucket (°C)
// Populated from per-source script output
const SIGMA_SOURCE_TABLE: Record<string, Record<string, number>> = {
  'NWS':           { lt18h: 0.0, lt30h: 0.0, lt42h: 0.0, gt42h: 0.0 },
  'AccuWeather':   { lt18h: 0.0, lt30h: 0.0, lt42h: 0.0, gt42h: 0.0 },
  'Open-Meteo':    { lt18h: 0.0, lt30h: 0.0, lt42h: 0.0, gt42h: 0.0 },
  'Google-Weather':{ lt18h: 0.0, lt30h: 0.0, lt42h: 0.0, gt42h: 0.0 },
  'Tomorrow.io':   { lt18h: 0.0, lt30h: 0.0, lt42h: 0.0, gt42h: 0.0 },
}
```

**Hard floor:** Regardless of script output, apply a hard floor of 0.4°C to all σ values (thermometer precision + representativity error).

---

## Task 2: BMA Implementation

### 2.1 BMA Formula

Bayesian Model Averaging replaces the single-bandwidth KDE with a weighted Gaussian mixture — one component per source, each with its own uncertainty:

```
P(T ∈ bracket) = Σ_i  w_i × [Φ((cap - μ_i) / σ_i) - Φ((floor - μ_i) / σ_i)]
```

Where:
- `w_i` = source weight from `getForecastWeights()` — already computed, no change
- `μ_i` = `correctedTemps[i]` — bias-corrected source forecast, already computed
- `σ_i` = per-source predictive uncertainty (NEW — from SIGMA_SOURCE_TABLE)

### 2.2 Per-Source σ_i Construction

Each source's σ_i combines aleatoric (irreducible) and epistemic (inter-source disagreement) components:

```typescript
function getPerSourceSigma(
  source: string,
  hoursToResolution: number,
  correctedTemps: number[],
  forecastWeights: number[],
  sourceNames: string[]
): number {
  // Aleatoric: historical RMSE for this source at this lead time
  const leadBucket = getLeadBucket(hoursToResolution)
  const sigmaAleatoric = SIGMA_SOURCE_TABLE[source]?.[leadBucket]
    ?? SIGMA_ALEATORIC_TABLE[leadBucket]  // fallback to ensemble average

  // Epistemic: this source's deviation from the weighted ensemble mean
  const ensembleMean = correctedTemps.reduce((s, t, i) => s + t * forecastWeights[i], 0)
  const sourceIdx = sourceNames.indexOf(source)
  const deviation = sourceIdx >= 0 ? Math.abs(correctedTemps[sourceIdx] - ensembleMean) : 0

  // λ_correlation inflates epistemic term to account for correlated NWP inputs
  const LAMBDA_CORRELATION = 1.5
  const sigmaEpistemic = deviation * LAMBDA_CORRELATION

  // Quadrature combination
  const sigmaTotal = Math.sqrt(sigmaAleatoric ** 2 + sigmaEpistemic ** 2)

  // Hard floor
  return Math.max(sigmaTotal, 0.4)
}
```

**On λ_correlation = 1.5:** Sources share NWP inputs (NWS/AccuWeather share GFS, Open-Meteo uses ECMWF). When correlated sources agree, inter-source spread understates true epistemic uncertainty. λ = 1.5 inflates the observed deviation to account for ~40% effective independence. Tune via A/B (λ ∈ {1.0, 1.25, 1.5, 2.0}) after initial deploy.

### 2.3 New Functions in distributions.ts

```typescript
// BMA bracket probability: weighted Gaussian mixture
export function bmaBracketProbability(
  correctedTemps: number[],
  forecastWeights: number[],
  floorStrike: number,
  capStrike: number,
  perSourceSigma: number[]
): number {
  let probability = 0
  for (let i = 0; i < correctedTemps.length; i++) {
    const pBracket = normalCDF(capStrike, correctedTemps[i], perSourceSigma[i])
                   - normalCDF(floorStrike, correctedTemps[i], perSourceSigma[i])
    probability += forecastWeights[i] * pBracket
  }
  return Math.min(Math.max(probability, 0), 1)
}

// BMA threshold probability (above/below)
export function bmaThresholdProbability(
  correctedTemps: number[],
  forecastWeights: number[],
  threshold: number,
  direction: 'above' | 'below',
  perSourceSigma: number[]
): number {
  let probability = 0
  for (let i = 0; i < correctedTemps.length; i++) {
    const p = direction === 'above'
      ? 1 - normalCDF(threshold, correctedTemps[i], perSourceSigma[i])
      : normalCDF(threshold, correctedTemps[i], perSourceSigma[i])
    probability += forecastWeights[i] * p
  }
  return Math.min(Math.max(probability, 0), 1)
}
```

`normalCDF()` already exists in distributions.ts — reuse it directly.

### 2.4 Changes to weatherProbability.ts

**In `calculateTemperatureProbability()` (lines 484–494):**

Replace:
```typescript
const hoursToRes = ensemble.hoursToResolution ?? 36
const MIN_STD_DEV = calculateDynamicStdDevFloor(maxTemps.length, ensemble.consensus.modelAgreement, hoursToRes)
const stdDev = Math.max(rawStdDev, MIN_STD_DEV)
// ...
probability = kdeTemperatureProbability(correctedTemps, threshold, direction, undefined, forecastWeights, MIN_STD_DEV)
```

With:
```typescript
const hoursToRes = ensemble.hoursToResolution ?? 36
const perSourceSigma = sourceNames.map(s =>
  getPerSourceSigma(s, hoursToRes, correctedTemps, forecastWeights, sourceNames)
)
// ...
probability = bmaThresholdProbability(correctedTemps, forecastWeights, threshold, direction, perSourceSigma)
```

**In `calculateBracketProbability()` (lines 588–597):** Same pattern — replace `kdeBracketProbability()` call with `bmaBracketProbability()`.

**`calculateDynamicStdDevFloor()` is NOT deleted.** Keep as fallback behind BMA_ENABLED flag.

### 2.5 API Surface Preservation

No changes to function signatures:

```typescript
// Unchanged:
export function calculateTemperatureProbability(
  ensemble: WeatherEnsemble,
  threshold: number,
  direction: 'above' | 'below',
  temperatureType: 'high' | 'low' = 'high',
  biasCorrection = 0,
  weightsOverride?: EnsembleWeights
): WeatherProbability

// Unchanged:
export function calculateBracketProbability(...): WeatherProbability
```

The `reasoning` string in the return object will reflect BMA internals (per-source σ_i, mixture weights) — informational only.

### 2.6 Base-Rate Blending Adjustment

The current blending weights (0.92 KDE / 0.08 uniform for brackets) were designed to compensate for KDE overconfidence. BMA already encodes uncertainty per source — reduce the uniform blend:

```typescript
// Current (compensating for KDE):
// 0.92 × KDE + 0.08 × uniform

// BMA (uncertainty already in σ_i):
// 0.97 × BMA + 0.03 × uniform
```

Agreement shrinkage (for low-agreement regimes) stays unchanged.

### 2.7 Feature Flag

```typescript
// Environment variable: BMA_ENABLED (default: true)
// If false, falls back to calculateDynamicStdDevFloor() + KDE path
const BMA_ENABLED = process.env.BMA_ENABLED !== 'false'
```

Rollback = single env var flip + PM2 reload. No schema changes, no API changes.

### 2.8 Source Name Threading

`getPerSourceSigma()` needs a `sourceNames` array parallel to `correctedTemps` and `forecastWeights`. Trace where these arrays are constructed in `calculateBracketProbability()` and `calculateTemperatureProbability()` to confirm source identity is available at the point of the KDE call. If source names are not currently preserved in the arrays, thread them through from the forecast extraction step (weatherProbability.ts:468–475 / :574–580).

---

## Task 3: Fix Dynamic Weight Prior (Part of Task 2)

### The Problem

The dynamic weight prior is uniform, causing Bayesian shrinkage to suppress the real MAE separation between tiers:

| Source | Dynamic Weight | MAE (°F) | Expected Weight |
|--------|---------------|----------|-----------------|
| NWS | 24.7% | 1.97 | ~35% |
| AccuWeather | 23.4% | 2.18 | ~35% |
| Open-Meteo | 16.8% | 3.82 | ~10% |
| Google-Weather | 17.8% | 3.82 | ~10% |
| Tomorrow.io | 17.3% | 3.85 | ~10% |

Tier 1 combined: 48% actual vs 70% expected. The 2x MAE gap is real but not reflected in weights.

### The Fix

In `sourceAccuracy.ts`, `computeWeights()` applies Bayesian shrinkage toward a uniform prior. Update the prior to match `DEFAULT_WEIGHTS` (70/30 Tier 1/Tier 2 split):

```typescript
// Current: prior pulls toward uniform (20% each)
// Fix: prior pulls toward DEFAULT_WEIGHTS

// In computeWeights() — locate the prior initialization
// Replace uniform prior with DEFAULT_WEIGHTS-informed prior:
const WEIGHT_PRIOR = {
  'NWS':            0.35,  // Tier 1: 70% split between NWS and AccuWeather
  'AccuWeather':    0.35,
  'Open-Meteo':     0.10,  // Tier 2/3: 30% split among three
  'Google-Weather': 0.10,
  'Tomorrow.io':    0.10,
}
```

**Why this matters for BMA:** BMA weights (`forecastWeights`) flow from `getForecastWeights()` which draws from the dynamic weights in Redis. If dynamic weights are near-uniform, BMA mixture weights are near-uniform — the per-source σ_i differentiation is correct but the mixture composition is wrong. Fix the prior before deploying BMA.

**Shrinkage parameter k:** Current k=25 is the effective sample size at which the prior has equal weight to observed data. With 398 records per Tier 1 source, the prior has minimal influence — but it's still suppressing the MAE gap. Update k or the prior; updating the prior is lower risk.

---

## Unit Tests (Required Before Deploy)

| Test | Expected Result |
|------|----------------|
| `bmaBracketProbability` with identical sources at bracket center | High probability (>70%) — no compression |
| `bmaBracketProbability` with sources at identical temp, σ_i = 0.5°C | Higher probability than KDE with MIN_STD_DEV = 0.7°C |
| `bmaBracketProbability` with sources spread across multiple brackets | Probability distributed across brackets proportional to source weights |
| `bmaThresholdProbability` direction='above', all sources above threshold | Probability near 1.0 |
| `getPerSourceSigma` with rawStdDev=0 | Returns σ_aleatoric (irreducible floor, no compression to zero) |
| `getPerSourceSigma` with large source deviation | Returns value > σ_aleatoric |
| Missing source in SIGMA_SOURCE_TABLE | Falls back to SIGMA_ALEATORIC_TABLE, not fixed floor |
| BMA_ENABLED = false | Falls back to KDE path, produces same output as before |
| Bracket probabilities sum check | Sum within normalization tolerance (~1.0 ± 0.02) |
| Edge case: single source | σ_epistemic = 0, σ_total = σ_aleatoric |

---

## Metrics to Monitor (48h Post-Deploy)

| Metric | Direction | Alert Threshold |
|--------|-----------|-----------------|
| Peak bracket probability (across all events) | Increase: target >50% from current ~20% | <30% = regression |
| Brier Skill Score | Improve from -1.09 | Drop >0.05 from baseline |
| NO signal win rate (20–50¢) | Improve from 47% baseline | Drop below 40% over 50+ signals |
| Signal count per day | Moderate increase expected | >3× increase = possible overconfidence |
| Tier 1 weight share | Move toward 70% | Still near 48% = prior fix didn't apply |
| YES signals | Must stay 0 (YES_SIGNALS_ENABLED = false) | Any YES signal = flag |

---

## Calibration Retrain (Deferred)

Do not retrain calibration until:
1. BMA is deployed and stable
2. 50+ resolved predictions exist on BMA output probabilities
3. The calibration table shows the inversion is gone (predicted 50% → actual ~50%)

When those conditions are met, retrain with Option A (calibrate distribution parameters, not bracket probabilities independently). The `source_accuracy` collection already stores (predicted_temp, actual_temp) pairs — the right training data format for Option A.

---

## Implementation Sequence

```
Step 1 (now):     Run σ_aleatoric and per-source σ_i computation scripts
                  Populate SIGMA_ALEATORIC_TABLE and SIGMA_SOURCE_TABLE with actuals

Step 2:           Implement BMA (Task 2) + weight prior fix (Task 3) behind BMA_ENABLED flag
                  Write all unit tests from the test table above

Step 3:           Shadow mode — log BMA probabilities, use KDE for signals
                  Run for 48h, compare shadow BSS vs production BSS

Step 4:           If shadow neutral or positive: flip BMA_ENABLED to live
                  If shadow negative: investigate per-source σ_i values, check source name threading

Step 5 (after 50+ resolved predictions on BMA):
                  Retrain calibration on BMA output probabilities
                  Re-enable YES signals only after calibration validates non-inverted confidence
```

---

## What Stays Unchanged

| Component | Status |
|-----------|--------|
| `getForecastWeights()` | Unchanged — weights still needed for BMA mixture |
| `buildConsensus()` | Unchanged — agreement score used for shrinkage and UI |
| Agreement shrinkage logic | Unchanged — still needed for low-agreement regimes |
| `normalCDF()` in distributions.ts | Unchanged — reused by BMA Gaussian evaluation |
| `extractMarketType()` in tickerParsing.ts | Unchanged — canonical market type resolver, do not touch |
| METAR exclusion | Unchanged — METAR never used as ground truth or in weights |
| Sanity guard (absError >25°F rejection) | Unchanged |
| YES_SIGNALS_ENABLED = false | Unchanged until post-BMA calibration validates |
| Tail guard 20–50¢ | Unchanged until post-BMA BSS warrants revisiting |