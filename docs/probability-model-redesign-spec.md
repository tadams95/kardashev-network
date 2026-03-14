# Probability Model Redesign Spec: Dynamic Bandwidth + BMA Migration

**Status:** Draft — for review before implementation
**Date:** 2026-03-11
**Context:** Three independent AI reviews (GPT 5.4, Gemini 3, Grok) unanimously identified the same architectural path to fix the probability compression problem.

---

## Section 1: Current Pipeline Map

### 1.1 Every location where bandwidth/stdDev is set, used, or constrained

| # | File | Line(s) | Current Value/Formula | Downstream Effect |
|---|------|---------|----------------------|-------------------|
| 1 | `src/lib/models/weatherProbability.ts` | 414–440 | `calculateDynamicStdDevFloor()` — lead-time floors: ≤18h→1.0°C, ≤30h→1.4°C, ≤42h→1.8°C, >42h→2.2°C; multiplied by source count (0.85–1.3) and agreement (0.75–1.4); hard clamp [0.7, 3.0]°C | Sets `MIN_STD_DEV`, the minimum bandwidth for all KDE and CDF computations |
| 2 | `src/lib/models/weatherProbability.ts` | 485–487 | `MIN_STD_DEV = calculateDynamicStdDevFloor(...)` then `stdDev = Math.max(rawStdDev, MIN_STD_DEV)` in `calculateTemperatureProbability()` | Determines effective σ for threshold probability; `MIN_STD_DEV` also passed to KDE as `minBandwidth` |
| 3 | `src/lib/models/weatherProbability.ts` | 494 | `kdeTemperatureProbability(correctedTemps, threshold, direction, undefined, forecastWeights, MIN_STD_DEV)` | `MIN_STD_DEV` becomes the KDE bandwidth floor via `minBandwidth` parameter |
| 4 | `src/lib/models/weatherProbability.ts` | 588–591 | Same `MIN_STD_DEV` pattern in `calculateBracketProbability()` | Same effect for bracket probabilities |
| 5 | `src/lib/models/weatherProbability.ts` | 597 | `kdeBracketProbability(correctedTemps, floorStrike, capStrike, undefined, forecastWeights, MIN_STD_DEV)` | Same KDE floor for bracket |
| 6 | `src/lib/models/distributions.ts` | 75–100 | `silvermanBandwidth()`: Silverman's rule `h = 0.9 × min(σ, IQR/1.34) × n^(-0.2)`, then `Math.max(h, minBandwidth ?? 0.3)` | The actual bandwidth used by every KDE kernel; floor is dominated by `minBandwidth` in practice |
| 7 | `src/lib/models/distributions.ts` | 136 | `buildKDE()` calls `silvermanBandwidth(samples, minBandwidth)` | Bandwidth flows into `kdeDensity()` and `kdeCDF()` via the `h` variable |

### 1.2 Full bracket probability computation path

```
Raw Source Forecasts (°C, per source)
    │
    ├─ [1] Extract temperatures: filter to FORECAST_SOURCES, select min/max by temperatureType
    │      weatherProbability.ts:468–475 (threshold) / :574–580 (bracket)
    │
    ├─ [2] Bias correction: correctedTemps = temps.map(t => t + biasCorrection)
    │      weatherProbability.ts:478 / :583
    │
    ├─ [3] Weighted mean + rawStdDev: weighted inter-source standard deviation
    │      weatherProbability.ts:481–482 / :585–586
    │
    ├─ [4] Dynamic stdDev floor: MIN_STD_DEV = calculateDynamicStdDevFloor(count, agreement, leadTime)
    │      weatherProbability.ts:485–487 / :588–591
    │      *** PRIMARY COMPRESSION SOURCE: MIN_STD_DEV almost always > rawStdDev ***
    │      Example: 5 sources at 71°F → rawStdDev ≈ 0, MIN_STD_DEV = 0.7°C (best case)
    │
    ├─ [5] KDE probability: kdeTemperatureProbability() / kdeBracketProbability()
    │      distributions.ts:200–217 / :228–240
    │      bandwidth = max(silvermanRule, MIN_STD_DEV) — MIN_STD_DEV dominates
    │      *** SECOND COMPRESSION: bandwidth too wide → probability spread across brackets ***
    │
    ├─ [6] Base-rate blending:
    │      Threshold: 0.95 × KDE + 0.05 × 0.50     weatherProbability.ts:506–508
    │      Bracket:   0.92 × KDE + 0.08 × uniform   weatherProbability.ts:607–609
    │      *** THIRD COMPRESSION: pulls toward center/uniform ***
    │
    ├─ [7] Agreement shrinkage (only when agreement < 60%):
    │      Threshold: regress toward 0.50            weatherProbability.ts:511–517
    │      Bracket:   regress toward uniformPrior     weatherProbability.ts:611–618
    │      (Not active when sources agree)
    │
    ├─ [8] Isotonic calibration: applyCalibration()
    │      weatherProbability.ts:520–523 / :622–625
    │      Currently NO-OP: model has ≤1 breakpoint → returns raw probability unchanged
    │      calibration.ts:212–213
    │
    ├─ [9] Safety clamp: clamp(probability, 0.02, 0.95)
    │      weatherProbability.ts:530 / :628
    │
    └─ [10] Bracket normalization: divide all brackets by their sum
           useWeatherOpportunities.ts:583–611
           Recalculates edge, direction, signal after normalization
```

### 1.3 Compression analysis

The dominant compression source is **Step 4** — the fixed stdDev floor. When 5 sources agree tightly:

- `rawStdDev` ≈ 0°C (sources at same temperature)
- `MIN_STD_DEV` = 0.7°C (best case: ≤18h, 5 sources, 100% agreement)
- The KDE uses bandwidth = 0.7°C regardless of how confident the sources are
- For a 3°F (1.67°C) bracket centered on the mean with bandwidth 0.7°C:
  - KDE P(bracket) ≈ 73% → after 8% base-rate blending ≈ 68%
  - For a 5°F (2.78°C) bracket: KDE P ≈ 95% → after blending ≈ 88%
- Markets can price the peak bracket at 70%+ when forecasts converge

The floor cannot be simply lowered — it protects against a real failure mode (correlated NWP sources overstating agreement). The fix is to make it **data-driven** rather than fixed.

---

## Section 2: σ_aleatoric Estimation

### 2.1 Available historical data

The `source_accuracy` collection contains the required fields for σ_aleatoric estimation:

```typescript
// From sourceAccuracy.ts:36–52
interface SourceAccuracyObservation {
  source: string           // e.g., 'NWS', 'AccuWeather'
  forecastTemp: number     // Per-source forecast (°F)
  actualTemp: number       // Kalshi midpoint ground truth (°F)
  error: number            // forecastTemp - actualTemp (°F)
  absError: number         // |error| (°F)
  leadHours?: number       // Hours from forecast capture to resolution
  temperatureType: 'high' | 'low'
  cityCode: string
  timestamp: number
}
```

Each record is a (forecast, actual, leadHours) triple — exactly what's needed to compute RMSE by lead time bucket.

### 2.2 Data volume assessment

**Current state (as of 2026-03-10):**

| Metric | Value |
|--------|-------|
| Total clean records | 490 |
| Date range | Mar 5–10, 2026 (6 days) |
| temperatureType: high | 490 (100%) |
| temperatureType: low | 0 (no low-temp markets yet) |
| Sources per record | ~99 each for 5 sources |
| groundTruthSource | All `kalshi_midpoint` |
| Accumulation rate | ~82/day |

**Lead hour distribution:** The `leadHours` field is computed as `Math.round((Date.now() - snapshot.timestamp) / 3_600_000)` in `writeSourceAccuracyFromServerSnapshot()` (sourceAccuracy.ts:477–479). Server-side captures (`captureServerSideForecasts`) run during warmup and on cache miss, typically capturing forecasts 12–72 hours before resolution.

The exact distribution requires a MongoDB query:
```javascript
db.source_accuracy.aggregate([
  { $bucket: {
    groupBy: "$leadHours",
    boundaries: [0, 12, 18, 24, 30, 42, 72, 200],
    default: "unknown",
    output: { count: { $sum: 1 }, avgAbsError: { $avg: "$absError" } }
  }}
])
```

**Estimated distribution** (based on capture patterns — warmup runs ~every 5min restart, cache miss at request time):

| Lead Bucket | Estimated Records | Notes |
|-------------|-------------------|-------|
| ≤18h | ~50–80 | Same-day captures close to resolution |
| 18–30h | ~80–120 | Day-before captures |
| 30–42h | ~80–120 | Two-day-ahead captures |
| >42h | ~150–200 | Multi-day captures (warmup captures up to 5 days out) |

### 2.3 Empirical RMSE estimation

From the calibration audit (2026-03-10), per-source MAE across all lead times:

| Source | MAE (°F) | MAE (°C) |
|--------|----------|----------|
| AccuWeather | 2.45 | 1.36 |
| NWS | 2.51 | 1.39 |
| Open-Meteo | 3.45 | 1.92 |
| Google-Weather | 3.46 | 1.92 |
| Tomorrow.io | 3.51 | 1.95 |
| **Ensemble avg** | **~3.08** | **~1.71** |

For RMSE (assuming normal error distribution, RMSE ≈ MAE × √(π/2) ≈ MAE × 1.25):

| Lead Bucket | Estimated Ensemble RMSE (°C) | Notes |
|-------------|------------------------------|-------|
| ≤18h | ~1.0–1.2 | Close to current floor |
| 18–30h | ~1.3–1.6 | Slightly below current 1.4 floor |
| 30–42h | ~1.5–2.0 | Near current 1.8 floor |
| >42h | ~2.0–2.5 | Near current 2.2 floor |

**Critical insight:** The current floors are calibrated to *average* NWP error. σ_aleatoric should represent *irreducible* error — the RMSE of the *best possible* ensemble mean, which is lower than any single source. With 5 sources, the ensemble mean RMSE is roughly single-source RMSE / √(effective_independent_sources). Given source correlation (see Section 3), effective independent sources ≈ 2–3, so:

**σ_aleatoric estimates (°C):**

| Lead Bucket | Estimated σ_aleatoric | Current Floor | Ratio |
|-------------|----------------------|---------------|-------|
| ≤18h | 0.6–0.8 | 0.7–1.0 | ~0.8× |
| 18–30h | 0.8–1.1 | 1.0–1.4 | ~0.7× |
| 30–42h | 1.0–1.4 | 1.4–1.8 | ~0.7× |
| >42h | 1.3–1.8 | 1.8–2.2 | ~0.7× |

### 2.4 Data sufficiency

490 records across 5 sources = ~98 per source. With ~4 lead buckets, that's ~25 per source per bucket — **marginal but usable** for initial σ_aleatoric estimates, especially if computed as ensemble-level RMSE (pooling across sources).

**Recommendation:** Compute initial σ_aleatoric from the 490 existing records, bucketed by lead time. This gives ~120+ records per lead bucket (pooled across sources). Refine monthly as data accumulates. Add a fallback to the current fixed floors if lead bucket has <30 records.

---

## Section 3: σ_epistemic Computation

### 3.1 Where inter-source spread is currently computed

The weighted inter-source standard deviation is computed in two places:

| Location | File:Line | Formula | Currently Used For |
|----------|-----------|---------|-------------------|
| `calculateTemperatureProbability()` | weatherProbability.ts:482 | `rawStdDev = √(Σ w_i × (t_i - μ)²)` | Only as floor comparison: `Math.max(rawStdDev, MIN_STD_DEV)` — MIN_STD_DEV dominates |
| `calculateBracketProbability()` | weatherProbability.ts:586 | Same formula | Same — rawStdDev is almost always overridden |

The weighted inter-source spread IS computed but is **discarded** whenever MIN_STD_DEV > rawStdDev (which is nearly always for high-agreement forecasts).

### 3.2 Exact σ_epistemic formula

Using existing variable names from `weatherProbability.ts`:

```typescript
// Existing code (weatherProbability.ts:481-482):
const mean = correctedTemps.reduce((s, t, i) => s + t * forecastWeights[i], 0)
const rawStdDev = Math.sqrt(
  correctedTemps.reduce((s, t, i) => s + forecastWeights[i] * (t - mean) ** 2, 0)
)

// σ_epistemic = rawStdDev × λ_correlation
// λ_correlation corrects for correlated sources (see §3.3)
const LAMBDA_CORRELATION = 0.6
const sigmaEpistemic = rawStdDev * LAMBDA_CORRELATION
```

**Where `rawStdDev` comes from:** `forecastWeights` are normalized per-source weights from `getForecastWeights()` (weatherProbability.ts:135–140), derived from `activeWeights` (dynamic or DEFAULT_WEIGHTS). `correctedTemps` are bias-corrected source temperatures.

### 3.3 Source correlation problem and λ correction

**The problem:** The 5 forecast sources are not independent. They share common inputs:

| Source | Primary NWP Input | Independence |
|--------|-------------------|-------------|
| Open-Meteo | ECMWF HRES + ENS | Semi-independent from GFS |
| NWS | GFS + NAM + RAP | Shares GFS with most others |
| Google-Weather | Proprietary (MetNet) | Most independent (AI-native) |
| AccuWeather | GFS + ECMWF blend | Shares both major models |
| Tomorrow.io | Proprietary + GFS | Partially independent |

When correlated sources agree, inter-source spread understates true uncertainty. If all sources share GFS input and GFS has a systematic bias today, they'll all be wrong in the same direction — but rawStdDev will be near zero.

**The fix — λ correction factor:**

```
σ_epistemic = rawStdDev × λ_correlation
```

Where `λ_correlation` inflates the epistemic uncertainty to account for unobserved correlation. When `rawStdDev` is already large (sources genuinely disagree), the inflation is harmless — it makes an already-wide distribution slightly wider. When `rawStdDev` is small (correlated agreement), it provides a minimum epistemic contribution.

**Recommended starting value: λ = 0.6**

Rationale: With ~2–3 effective independent sources out of 5, the "true" inter-model spread is roughly `observed_spread / √(effective_independent / total) ≈ observed_spread / √(0.4–0.6)`. But since σ_epistemic is combined with σ_aleatoric via quadrature (√(σ_a² + σ_e²)), the correlation correction applies to σ_epistemic before combination, not after.

**Wait — λ should INFLATE, not deflate.** If sources are correlated, `rawStdDev` *understates* true epistemic uncertainty. The correction should be:

```typescript
// λ > 1 inflates observed spread to account for correlation
const LAMBDA_CORRELATION = 1.5  // = 1/√(effective_independence_ratio)
const sigmaEpistemic = rawStdDev * LAMBDA_CORRELATION
```

However, since the *minimum* σ_epistemic (when rawStdDev ≈ 0) is also 0 regardless of λ, the correlation correction alone doesn't solve the zero-spread problem. The fix comes from σ_aleatoric providing the irreducible floor via quadrature:

```
σ_total = √(σ_aleatoric² + (rawStdDev × λ)²)
```

When sources agree perfectly (rawStdDev = 0): `σ_total = σ_aleatoric` (the irreducible forecast error).
When sources disagree: `σ_total > σ_aleatoric` (adds epistemic contribution).

**Where to apply λ:** In the σ_total computation, before the quadrature sum. See Section 4.

**Recommended initial λ values:**
- **λ = 1.5** — conservative, accounts for ~40% effective independence
- Tune via A/B testing: compare BSS with λ ∈ {1.0, 1.25, 1.5, 2.0}

---

## Section 4: Phase 1 Migration Plan — Dynamic Bandwidth

### 4.1 Exact lines to modify

**File: `src/lib/models/weatherProbability.ts`**

**In `calculateTemperatureProbability()` (lines 484–494):**

Current code:
```typescript
// Line 485-487:
const hoursToRes = ensemble.hoursToResolution ?? 36
const MIN_STD_DEV = calculateDynamicStdDevFloor(maxTemps.length, ensemble.consensus.modelAgreement, hoursToRes)
const stdDev = Math.max(rawStdDev, MIN_STD_DEV)

// Line 493-494:
if (correctedTemps.length >= 3) {
  probability = kdeTemperatureProbability(correctedTemps, threshold, direction, undefined, forecastWeights, MIN_STD_DEV)
```

Replace with:
```typescript
// Dynamic bandwidth: σ_total = √(σ_aleatoric² + σ_epistemic²)
const hoursToRes = ensemble.hoursToResolution ?? 36
const sigmaAleatoric = getSigmaAleatoric(hoursToRes)  // learned from historical residuals
const LAMBDA_CORRELATION = 1.5
const sigmaEpistemic = rawStdDev * LAMBDA_CORRELATION
const sigmaTotalDynamic = Math.sqrt(sigmaAleatoric ** 2 + sigmaEpistemic ** 2)

// Retain hard floor as safety net (below irreducible measurement error)
const HARD_FLOOR = 0.4  // °C — thermometer precision + representativity
const sigmaTotal = Math.max(sigmaTotalDynamic, HARD_FLOOR)

const stdDev = sigmaTotal  // for reasoning string

// ...
if (correctedTemps.length >= 3) {
  probability = kdeTemperatureProbability(correctedTemps, threshold, direction, undefined, forecastWeights, sigmaTotal)
```

**Same change in `calculateBracketProbability()` (lines 588–597)** — identical pattern, lines 588–591 compute MIN_STD_DEV, line 597 passes it to `kdeBracketProbability`.

**`calculateDynamicStdDevFloor()` is NOT deleted** — it becomes a fallback for the transition period. If σ_aleatoric lookup returns null (insufficient data for a lead bucket), fall back to the fixed floor.

### 4.2 New function: `getSigmaAleatoric()`

```typescript
// Lookup table: σ_aleatoric by lead time bucket, in °C
// Computed from source_accuracy ensemble RMSE (see Section 2.3)
// Updated by cron job or calibration training
const SIGMA_ALEATORIC_TABLE: Record<string, number> = {
  'lt18h':  0.7,   // Initial estimate from 490 records
  'lt30h':  0.95,
  'lt42h':  1.2,
  'gt42h':  1.6,
}

function getSigmaAleatoric(hoursToResolution: number): number {
  if (hoursToResolution <= 18) return SIGMA_ALEATORIC_TABLE['lt18h']
  if (hoursToResolution <= 30) return SIGMA_ALEATORIC_TABLE['lt30h']
  if (hoursToResolution <= 42) return SIGMA_ALEATORIC_TABLE['lt42h']
  return SIGMA_ALEATORIC_TABLE['gt42h']
}
```

Initial values are estimates. They should be recomputed from actual data before deployment (see implementation notes below).

### 4.3 New inputs required

| Input | Source | Currently Available? |
|-------|--------|---------------------|
| `σ_aleatoric(leadTime)` | Lookup table computed from `source_accuracy` ensemble RMSE | **No** — requires a one-time computation script |
| `rawStdDev` (for σ_epistemic) | Already computed at weatherProbability.ts:482/586 | **Yes** |
| `λ_correlation` | Constant (1.5 initially) | **New constant** |

### 4.4 API surface preservation

`calculateTemperatureProbability()` signature (weatherProbability.ts:451–458):
```typescript
export function calculateTemperatureProbability(
  ensemble: WeatherEnsemble,
  threshold: number,
  direction: 'above' | 'below',
  temperatureType: 'high' | 'low' = 'high',
  biasCorrection = 0,
  weightsOverride?: EnsembleWeights
): WeatherProbability
```

**No change to inputs or outputs.** The `WeatherProbability` return type is unchanged. The `reasoning` string will reflect the new formula (`σ_total` instead of `floor`) but this is informational only.

`calculateBracketProbability()` — same, no signature change.

### 4.5 Expected probability change — New York example

**Scenario:** 5 sources agreeing at 71°F (21.67°C), ≤18h lead time, bracket 69–72°F (20.56–22.22°C).

**Current model:**
- rawStdDev ≈ 0°C
- MIN_STD_DEV = calculateDynamicStdDevFloor(5, 100, 18) = max(0.7, 1.0 × 0.85 × 0.75) = max(0.7, 0.6375) = 0.7°C
- KDE bandwidth = 0.7°C
- For bracket 20.56–22.22°C centered near mean 21.67°C:
  - P(bracket) ≈ Φ((22.22-21.67)/0.7) - Φ((20.56-21.67)/0.7) = Φ(0.79) - Φ(-1.59) ≈ 0.73
  - After base-rate blending (0.92): 0.92 × 0.73 + 0.08 × (1.67/15) ≈ 0.68
  - After normalization across ~8 brackets: depends on bracket count and positions

**New model with σ_aleatoric = 0.7°C (conservative initial estimate):**
- rawStdDev ≈ 0°C → σ_epistemic = 0 × 1.5 = 0
- σ_total = √(0.7² + 0²) = 0.7°C
- **Same as current** — no change because σ_aleatoric equals the current floor at this lead time

**New model with σ_aleatoric = 0.5°C (if residual data supports it):**
- σ_total = √(0.5² + 0²) = 0.5°C
- P(bracket) ≈ Φ((22.22-21.67)/0.5) - Φ((20.56-21.67)/0.5) = Φ(1.10) - Φ(-2.22) ≈ 0.864 - 0.013 = 0.85
- After base-rate blending: 0.92 × 0.85 + 0.08 × (1.67/15) ≈ 0.79
- **+11pp** improvement (79% vs 68%) for the peak bracket

**Key insight:** The improvement is **entirely determined by whether the data supports a lower σ_aleatoric than the current fixed floor.** If the empirical RMSE at ≤18h lead time is truly ~0.5°C (ensemble mean), the model gains significant sharpness. If it's 0.7°C or higher, Phase 1 produces minimal change and the real value comes from Phase 2 (BMA).

### 4.6 Implementation prerequisite: compute σ_aleatoric from data

Before implementing Phase 1, run this analysis script against production MongoDB:

```javascript
// Compute ensemble-mean RMSE by lead time bucket
// Uses source_accuracy records (490 clean as of 2026-03-10)
db.source_accuracy.aggregate([
  // Group by (cityCode, marketId) to get per-event records
  { $group: {
    _id: { marketId: "$marketId", source: "$source" },
    forecastTemp: { $first: "$forecastTemp" },
    actualTemp: { $first: "$actualTemp" },
    leadHours: { $first: "$leadHours" }
  }},
  // Compute ensemble mean per event
  { $group: {
    _id: "$_id.marketId",
    sources: { $push: { source: "$_id.source", forecast: "$forecastTemp" } },
    meanForecast: { $avg: "$forecastTemp" },
    actual: { $first: "$actualTemp" },
    leadHours: { $first: "$leadHours" }
  }},
  // Compute squared error of ensemble mean
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
    rmse_c: { $divide: [{ $sqrt: "$rmse_f" }, 1.8] }  // °F to °C
  }},
  { $sort: { _id: 1 } }
])
```

**If any lead bucket has <30 events, fall back to the current fixed floor for that bucket.**

---

## Section 5: Phase 2 BMA Migration Plan

### 5.1 BMA formula

Bayesian Model Averaging replaces the single-bandwidth KDE with a **weighted Gaussian mixture** — one component per source, each with its own uncertainty:

```
P(T ∈ bracket) = Σ_i  w_i × Φ((cap - μ_i) / σ_i) - Φ((floor - μ_i) / σ_i)
```

Where:
- `w_i` = source weight (from `forecastWeights[i]`, already computed at weatherProbability.ts:474/579)
- `μ_i` = `correctedTemps[i]` (bias-corrected source forecast, already computed)
- `σ_i` = per-source predictive uncertainty (NEW — not currently available)

Using existing variable names:

```typescript
function bmaBracketProbability(
  correctedTemps: number[],
  forecastWeights: number[],
  floorStrike: number,
  capStrike: number,
  perSourceSigma: number[]  // NEW: σ_i for each source
): number {
  let probability = 0
  for (let i = 0; i < correctedTemps.length; i++) {
    const pBracket = normalCDF(capStrike, correctedTemps[i], perSourceSigma[i])
                   - normalCDF(floorStrike, correctedTemps[i], perSourceSigma[i])
    probability += forecastWeights[i] * pBracket
  }
  return probability
}
```

### 5.2 What changes in `weatherProbability.ts`

| Current Component | Phase 2 Change | Status |
|-------------------|---------------|--------|
| `kdeTemperatureProbability()` call (line 494) | Replace with `bmaTemperatureProbability()` | **Replaced** |
| `kdeBracketProbability()` call (line 597) | Replace with `bmaBracketProbability()` | **Replaced** |
| `calculateDynamicStdDevFloor()` (lines 414–440) | Removed — σ_aleatoric per source replaces it | **Removed** |
| `buildKDE()` in distributions.ts | No longer called for temperature — kept for other potential uses | **Unused** |
| `getForecastWeights()` (lines 135–140) | **Stays** — weights still needed for BMA | **Kept** |
| `buildConsensus()` (lines 339–393) | **Stays** — agreement score still used for shrinkage and UI | **Kept** |
| Base-rate blending (lines 506–509, 607–609) | **Stays** but with reduced weight (0.97/0.03) — BMA already incorporates uncertainty | **Modified** |
| Agreement shrinkage (lines 511–517, 611–618) | **Stays** — still needed for low-agreement regimes | **Kept** |
| normalCDF() (lines 254–262) | **Stays** — used by BMA per-source Gaussian evaluation | **Kept** |

### 5.3 Data requirements: per-source σ_i

BMA requires per-source historical error distributions, not just MAE:

| Data Needed | Currently Available? | Source |
|-------------|---------------------|--------|
| Per-source MAE by lead time | **Yes** — `source_accuracy` has (source, absError, leadHours) | Direct query |
| Per-source RMSE by lead time | **Derivable** — compute from (source, error, leadHours) | √(Σerror²/n) per bucket |
| Per-source bias by lead time | **Derivable** — compute from (source, error, leadHours) | Σerror/n per bucket |
| Per-source error variance | **Derivable** — RMSE² - bias² | Computed |

**What's NOT available and may be needed later:**
- Per-source error distribution shape (kurtosis, skewness) — needed if departing from Gaussian assumption
- Per-source cross-correlation matrix — needed for optimal BMA (not required for basic implementation)

**Minimum viable per-source σ_i:** Use per-source RMSE by lead bucket from `source_accuracy`. With 490 records / 5 sources = ~98 per source, and ~4 lead buckets = ~25 per source per bucket. **Marginal for per-source × per-lead estimates.** Consider:
- Global per-source RMSE (pooling lead times): ~98 per source — adequate
- Per-source × per-lead: ~25 per bucket — needs more data for stable estimates

### 5.4 Ordering dependency

**Phase 1 should be validated before Phase 2 begins.** Rationale:

1. Phase 1 (dynamic bandwidth) replaces the fixed floor with σ_aleatoric — this alone may be sufficient if the main issue is the floor being too high
2. Phase 1 uses the same KDE infrastructure (minimal code change, lower risk)
3. Phase 2 (BMA) replaces the entire probability engine — higher risk, harder to roll back
4. The σ_aleatoric estimates from Phase 1 are reused as the per-source σ_i initial values in Phase 2
5. Phase 1 provides a clean baseline for measuring Phase 2's incremental improvement

**Recommended timeline:**
- Phase 1: Implement + deploy → monitor BSS for 1 week
- Phase 2: Implement only after Phase 1 validates that σ_aleatoric estimates are sound

---

## Section 6: Phase 3 Calibration Coherence Fix

### 6.1 Current calibration path trace

**Is per-bracket isotonic calibration followed by renormalization happening?**

Tracing the exact path:

1. **Each bracket probability is computed independently** — `calculateBracketProbability()` is called once per bracket in `calculateOpportunity()` (useWeatherOpportunities.ts:269/297)

2. **Each bracket is independently calibrated** — `applyCalibration(adjusted, ...)` at weatherProbability.ts:622–625 applies isotonic regression to each bracket's probability separately

3. **Brackets are then renormalized** — useWeatherOpportunities.ts:583–611:
   ```typescript
   if (brackets.length >= 2) {
     const probSum = brackets.reduce((s, b) => s + b.modelProbability, 0)
     if (probSum > 0 && Math.abs(probSum - 1.0) > 0.01) {
       for (const b of brackets) {
         b.modelProbability = b.modelProbability / probSum
       }
     }
   }
   ```

**Confirmed: GPT 5.4's finding is correct.** The pipeline does:
1. Compute each bracket probability independently (KDE)
2. Apply safety adjustments independently per bracket
3. Apply isotonic calibration independently per bracket
4. Renormalize all brackets to sum to 1.0

This breaks probability additivity. Isotonic calibration is a monotonic but non-linear transformation. Applying it independently to each bracket and then renormalizing is NOT equivalent to calibrating the probability distribution as a whole.

### 6.2 Current magnitude of distortion

**Currently zero** — because the calibration model is a no-op (≤1 breakpoint, calibration.ts:212–213 returns raw probability unchanged). So right now:
- Step 2 (calibration) passes through unchanged
- Step 3 (normalization) corrects for the slight non-additivity introduced by base-rate blending and agreement shrinkage

Once calibration is retrained with >50 samples and has 2+ breakpoints, the distortion will manifest. Its magnitude depends on the calibration curve's nonlinearity.

**Expected distortion when calibration is active:** If the calibration curve maps 0.10→0.05 and 0.50→0.45 (compressing the lower end more than the upper), then:
- A bracket at 50% gets mapped to 45% (-5pp)
- Adjacent brackets at 10% each get mapped to 5% each (-5pp each)
- Sum of calibrated brackets < 1.0 → renormalization inflates all brackets
- The 45% bracket becomes 45/(45+5+5+...) > 45% → inflation depends on the full bracket set
- Net effect: brackets near 50% get inflated, tail brackets get deflated relative to their calibrated values

### 6.3 Recommended fix

**Option A (Simplest — recommended for Phase 3):** Calibrate the continuous distribution parameters, not the bracket probabilities.

Instead of calibrating each bracket's P(bracket) independently, calibrate the distribution's *location* and *scale*:
- Learn a bias correction δ(leadTime, marketType) and scale correction γ(leadTime, marketType)
- Apply: `calibrated_mean = raw_mean + δ`, `calibrated_sigma = raw_sigma × γ`
- Recompute all bracket probabilities from the calibrated distribution
- Bracket probabilities automatically sum to 1.0

This requires restructuring the calibration model from (predicted_P, actual_outcome) pairs to (predicted_temp, actual_temp) pairs — which is exactly what `source_accuracy` already stores.

**Option B (Alternative):** Use Platt scaling on the logit of the bracket simplex (log-ratio transform → calibrate → back-transform → softmax). More complex but preserves the existing calibration infrastructure.

**Option C (Quick fix):** Move the normalization step BEFORE calibration. Calibrate the normalized probabilities. This doesn't fully fix the coherence issue (calibration still breaks additivity) but reduces the magnitude since the inputs are already on the simplex.

### 6.4 Ordering relative to Phase 1

**Phase 3 can be implemented in parallel with Phase 1** because:
- The calibration model is currently a no-op
- Phase 3 doesn't depend on the bandwidth formula
- Both modify different parts of the pipeline

However, **Phase 3 should be deployed AFTER Phase 1** because:
- Phase 1 changes the raw probabilities feeding into calibration
- Any calibration model trained on Phase 1 outputs will be invalidated if Phase 1's σ_aleatoric changes
- The correct sequence is: Phase 1 → stabilize → retrain calibration → deploy Phase 3

---

## Section 7: Risk Assessment

### Phase 1: Dynamic Bandwidth

**What could go wrong:**

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| σ_aleatoric underestimated → overconfident probabilities → more false signals | Medium | High | Hard floor at 0.4°C; A/B test before full rollout |
| σ_aleatoric overestimated → no improvement over current model | Low | Low | Compare to current floors; if similar, confirms current floors are reasonable |
| Lead hour data is sparse in some buckets → noisy σ_aleatoric | Medium | Medium | Fall back to current fixed floor for buckets with <30 events |
| λ_correlation too high → inflates all probabilities → loss of sharpness | Low | Medium | Start conservative (1.5); tune via BSS optimization |
| Low-temp markets have no data (0 records) | High | Medium | Use high-temp σ_aleatoric for low-temp markets initially; separate when data exists |

**Regression tests (before implementation):**

1. Unit test: `σ_total` with rawStdDev=0 equals σ_aleatoric (agreement doesn't reduce below irreducible)
2. Unit test: `σ_total` with large rawStdDev exceeds σ_aleatoric (disagreement adds uncertainty)
3. Unit test: `σ_total` with rawStdDev > 0 and λ > 1 produces larger σ_total than rawStdDev alone
4. Integration test: bracket probabilities still sum to ~1.0 (within normalization tolerance)
5. Snapshot test: probability output for the existing test scenarios in `distributions.test.ts` changes in the expected direction (tighter when σ_aleatoric < current floor)
6. Regression test: `calculateDynamicStdDevFloor()` still exists and produces correct values (fallback)

**Regression tests (after implementation):**

7. End-to-end: wire up a mock ensemble with 5 identical temperatures and verify the bracket containing the mean gets higher probability than the current model
8. Edge case: single source → σ_epistemic = 0 → σ_total = σ_aleatoric (no division by zero)
9. Edge case: all sources at different temperatures → σ_epistemic large → σ_total dominated by epistemic

**Metrics to monitor (48h post-deploy):**

| Metric | Expected Direction | Alert Threshold |
|--------|-------------------|-----------------|
| Bracket probability max (across all events) | Increase (>40% → 50-70%) | <30% would indicate regression |
| Brier Skill Score | Improve or neutral | Drop >0.05 from baseline |
| Signal count per day | Slight increase (sharpened probabilities find more edges) | >3× increase suggests overconfidence |
| Tail contract signal rate | Should NOT increase (tail guard still active) | Any increase warrants investigation |
| P&L per signal | Improve | >2σ decline over 2-day window |

**Rollback plan:**
- Feature flag: `SIGMA_ALEATORIC_ENABLED` env var (default: true)
- If false, revert to `calculateDynamicStdDevFloor()` path
- No schema changes, no API changes → rollback is a single env var flip + PM2 reload

### Phase 2: BMA

**What could go wrong:**

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Per-source σ_i estimates too noisy with ~25 records/bucket | High | Medium | Use pooled (all lead times) per-source σ initially |
| BMA with Gaussian components doesn't capture fat tails | Medium | Medium | Test against KDE on bimodal forecasts; hybrid possible |
| Complete probability engine replacement → many untested paths | Medium | High | Extensive unit test coverage; shadow mode first |
| Per-source σ_i needs ongoing recomputation → cron complexity | Low | Low | Piggyback on existing weight rollup cron |

**Regression tests:** All Phase 1 tests plus:
- BMA output matches KDE output when all sources have equal σ_i and equal weights (degenerate case)
- BMA with one dominant source (high weight, low σ) produces sharper distribution than equal weights
- BMA handles missing sources gracefully (2 sources instead of 5)

**Metrics:** Same as Phase 1 plus per-source weight differentiation in probability contributions.

**Rollback plan:**
- Feature flag: `BMA_ENABLED` env var
- If false, revert to KDE path (Phase 1 dynamic bandwidth)
- Phase 1 code stays in the codebase as the fallback

### Phase 3: Calibration Coherence

**What could go wrong:**

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| New calibration approach (Option A) requires different training data format | Medium | Medium | `source_accuracy` already has the right data; just needs a new training script |
| Removing independent bracket calibration worsens BSS for some market types | Low | Medium | Compare Option A vs current (no-op) before switching |
| Timing: deploying calibration coherence while σ_aleatoric is still being tuned | Medium | Medium | Strict ordering: Phase 1 stable → calibration retrain → Phase 3 |

**Regression tests:**
- Calibrated bracket probabilities sum to 1.0 without renormalization (the whole point)
- Calibration improves Brier score on held-out validation set
- Calibration is monotonic (higher raw P always maps to higher calibrated P)

**Metrics:** Brier Skill Score improvement over uncalibrated, reliability diagram shape.

**Rollback plan:** Set calibration model to null → probabilities pass through uncalibrated (current state).

---

## Appendix: Implementation Sequence

```
Week 1:  Run σ_aleatoric computation script on production MongoDB
         Review results → set initial lookup table values
         Implement Phase 1 behind SIGMA_ALEATORIC_ENABLED flag
         Write unit + integration tests

Week 2:  Deploy Phase 1 in shadow mode (log new probabilities, use old for signals)
         Compare shadow BSS vs production BSS over 48h
         If neutral or positive: flip to live
         If negative: investigate σ_aleatoric values, adjust

Week 3:  Monitor Phase 1 live metrics
         Begin Phase 2 implementation (BMA) behind BMA_ENABLED flag
         Compute per-source σ_i from source_accuracy

Week 4:  Phase 2 shadow mode testing
         Phase 3 implementation (calibration coherence)
         Retrain calibration model on Phase 1 output probabilities

Week 5+: Phase 2 + Phase 3 deployment (sequenced)
```
