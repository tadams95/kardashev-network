# Weather Trading Probability Pipeline

How the Kardashev Network computes trading probabilities from raw weather forecasts, and how calibration corrects systematic errors over time.

---

## Table of Contents

1. [The Big Picture](#1-the-big-picture)
2. [Stage 1: Ensemble Forecasts](#2-stage-1-ensemble-forecasts)
3. [Stage 2: Consensus Building](#3-stage-2-consensus-building)
4. [Stage 3: KDE Probability Estimation](#4-stage-3-kde-probability-estimation)
5. [Stage 4: Safety Adjustments](#5-stage-4-safety-adjustments)
6. [Stage 5: Calibration](#6-stage-5-calibration)
7. [The CalibrationModelBundle](#7-the-calibrationmodelbundle)
8. [Training the Calibration Model](#8-training-the-calibration-model)
9. [End-to-End Example](#9-end-to-end-example)
10. [Current State & Next Steps](#10-current-state--next-steps)

---

## 1. The Big Picture

The system answers one question: **"What is the probability that a weather event happens?"**

For example: *"What is the probability that NYC's high temperature exceeds 65°F tomorrow?"*

It then compares that probability to the Kalshi market price to find trading edges.

```
Weather Sources (5-6 APIs)
        ↓
   Ensemble of Forecasts
        ↓
   Consensus (weighted average + agreement score)
        ↓
   KDE Probability (kernel density estimation)
        ↓
   Safety Adjustments (base-rate blend, agreement shrinkage, clamp)
        ↓
   Calibration (isotonic regression correction)
        ↓
   Final Probability → compare to market price → trade signal
```

**Key files:**
- `src/lib/models/distributions.ts` — KDE math
- `src/lib/models/weatherProbability.ts` — probability pipeline + consensus
- `src/lib/models/calibration.ts` — isotonic regression
- `src/pages/api/weather/calibration.ts` — training endpoint
- `src/hooks/useWeatherOpportunities.ts` — ties it all together client-side

---

## 2. Stage 1: Ensemble Forecasts

We fetch forecasts from multiple independent weather sources:

| Source | Weight | What It Is |
|--------|--------|------------|
| NWS | 0.30 | National Weather Service — Kalshi uses NWS for resolution, so it gets the highest weight |
| Open-Meteo | 0.20 | ECMWF-based global model, strong multi-day skill |
| Google Weather | 0.15 | Google's MetNet AI model |
| METAR | 0.15 | Airport weather observations (ground truth, excluded from KDE) |
| AccuWeather | 0.10 | Statistical post-processing blend |
| Tomorrow.io | 0.10 | Proprietary NWP + machine learning hybrid |

Each source provides a high temperature, low temperature, and precipitation forecast for the target day.

**Why multiple sources?** No single weather model is always right. By combining them, we get a more robust estimate. The disagreement between sources also tells us how uncertain the forecast is.

**Why is METAR excluded from KDE?** METAR reports what already happened (observations), not what will happen (forecasts). It helps with consensus quality scoring but shouldn't influence the probability distribution for future events.

**Dynamic weights** can override these defaults. The system tracks per-source accuracy over time (`sourceAccuracy.ts`) and computes Brier-score-based weights stored in Redis. When available, these replace the static defaults.

---

## 3. Stage 2: Consensus Building

`buildConsensus()` aggregates the ensemble into summary statistics.

**What it computes:**
- **Weighted mean temperature** — each source's forecast × its weight, divided by total weight
- **Temperature range** — min and max across all sources
- **Model agreement score** (0–100) — measures how much the sources agree

**Agreement score formula:**
```
tempStdDev = standard deviation of all source temperatures
tempAgreement = max(0, 100 - tempStdDev × 5)
```

Examples:
- All sources say 72°F ± 0.5° → stdDev ≈ 0.3 → agreement = 98 (high confidence)
- Sources say 65°F, 72°F, 79°F → stdDev ≈ 7 → agreement = 65 (moderate)
- Sources say 50°F, 70°F, 90°F → stdDev ≈ 20 → agreement = 0 (chaos)

The agreement score is used later to shrink extreme probabilities when sources disagree. If the models can't agree on the temperature, we shouldn't be confident about any specific threshold.

**Market type matters:** When computing agreement for a "high temperature" market, only max temps are compared. For "low temperature" markets, only min temps. This prevents irrelevant variables from diluting the signal.

---

## 4. Stage 3: KDE Probability Estimation

This is the core mathematical engine. Given a set of temperature forecasts and a threshold, KDE computes the probability that the actual temperature will exceed (or fall below) that threshold.

### Why KDE instead of a simple normal distribution?

A normal (Gaussian) distribution assumes the data is symmetric and unimodal — one bell curve. But weather forecasts from multiple sources can be **bimodal** (two clusters of predictions) or **fat-tailed** (more extreme outcomes than a bell curve predicts).

KDE handles both cases naturally.

### How KDE works (conceptual)

Imagine each forecast value as a small bell curve (a "kernel") centered at that temperature. KDE stacks all these mini bell curves on top of each other to create the overall probability distribution.

```
Source forecasts: 68°F, 70°F, 71°F, 69°F, 72°F

Each becomes a small Gaussian kernel:
    ╱╲         ╱╲
   ╱  ╲       ╱  ╲     ╱╲
  ╱    ╲  ╱╲ ╱    ╲   ╱  ╲
──68───69──70──71───72──73──→ Temperature

Stacked together = smooth probability distribution:
         ╱──╲
       ╱      ╲
     ╱          ╲
   ╱              ╲
──68───69──70──71───72──73──→ Temperature
```

The probability P(T > 65°F) is the area under this curve to the right of 65°F.

### Bandwidth: how wide each kernel is

The **bandwidth** controls how spread out each mini bell curve is. Too narrow = spiky, overfits to exact forecast values. Too wide = oversmoothed, loses signal.

We use **Silverman's Rule** for automatic bandwidth selection:
```
bandwidth = 0.9 × min(stdDev, IQR/1.34) × n^(-1/5)
```

But there's a critical **minimum bandwidth floor** to prevent overconfidence.

### The Dynamic StdDev Floor

This is one of the most important design decisions. Even when all 5 sources agree on 72°F, the actual temperature won't be exactly 72°F. There's irreducible uncertainty from:

- **NWP model error** — weather models have known RMSE at different lead times
- **Representativity error** (~0.3°C) — the forecast is for a grid cell, not the exact station
- **Observation error** (~0.2°C) — thermometers aren't perfect

The dynamic floor scales with **lead time** (further out = more uncertainty):

| Hours to Resolution | Base Floor |
|---------------------|-----------|
| ≤ 18h (same day) | 1.0°C |
| 18–30h (day 1) | 1.4°C |
| 30–42h (day 1.5) | 1.8°C |
| > 42h (day 2+) | 2.2°C |

This floor is further adjusted by source count and agreement:
- **3+ sources** → 0.85× (more data, can tighten slightly)
- **1 source** → 1.3× (less data, widen)
- **High agreement (>80%)** → 0.75–1.0× (predictable regime)
- **Low agreement (<50%)** → 1.0–1.4× (genuine uncertainty)

**Why this matters:** Without the floor, if all sources say exactly 72°F, the KDE bandwidth would shrink to near-zero, producing probabilities like 99.99% for "above 65°F." The floor ensures the probability reflects real-world uncertainty (~90-95% in this case), not just inter-source agreement.

### Weighted KDE

Each source's kernel is scaled by its weight. A source with weight 0.30 (NWS) contributes more to the distribution shape than one with weight 0.10 (Tomorrow.io):

```
Weighted CDF:  F(x) = Σ weight[i] × Φ((x - forecast[i]) / bandwidth)
```

where Φ is the standard normal CDF (computed via error function approximation).

### Two probability types

**Threshold probability** (`calculateTemperatureProbability`):
- "Will the high be above 65°F?" → P(T > 65)
- "Will the high be below 40°F?" → P(T < 40)
- Used for T-prefix Kalshi markets (above/below)

**Bracket probability** (`calculateBracketProbability`):
- "Will the high be between 65°F and 70°F?" → P(65 ≤ T < 70)
- Computed as CDF(70) - CDF(65)
- Used for B-prefix Kalshi markets (between brackets)

---

## 5. Stage 4: Safety Adjustments

Three layers prevent the model from producing overconfident probabilities.

### 5a. Base-Rate Blending

Even a perfect model shouldn't output 0% or 100%. We blend with a neutral prior:

```
For threshold markets:
  probability = 0.95 × raw_probability + 0.05 × 0.50

For bracket markets:
  uniform_prior = bracket_width / 15°F   (bracket's fair share of the range)
  probability = 0.92 × raw_probability + 0.08 × uniform_prior
```

This creates effective floors (~2.5%) and ceilings (~97.5%) even before the final clamp.

### 5b. Agreement-Based Shrinkage

When sources disagree (agreement < 60%), the probability is pulled toward the center:

```
if agreement < 60%:
  shrinkage = 0.5 + 0.5 × (agreement / 60)    // ranges 0.5 to 1.0
  probability = 0.50 + (probability - 0.50) × shrinkage
```

Example: Raw probability is 85%, but agreement is only 40% (sources disagree badly):
- shrinkage = 0.5 + 0.5 × (40/60) = 0.833
- adjusted = 0.50 + (0.85 - 0.50) × 0.833 = 0.792 (pulled toward 50%)

When agreement ≥ 60%, no shrinkage is applied.

### 5c. Final Clamp

```
probability = clamp(probability, 0.02, 0.95)
```

The model never asserts near-certainty in either direction. In practice, the 15% minimum edge filter already screens out markets where the model and market agree.

---

## 6. Stage 5: Calibration

After all the above, we have a probability that's mathematically sound but may still have systematic biases. **Calibration corrects these biases using historical data.**

### What calibration fixes

Imagine the model consistently outputs probabilities around 40% for events that actually happen 25% of the time. The raw probability is systematically too high in that range. Calibration learns this pattern and maps 40% → 25%.

### Isotonic Regression

We use **isotonic regression** (not logistic regression) because:
- Weather probability relationships aren't sigmoid-shaped
- Isotonic regression is **non-parametric** — it makes no assumptions about the shape
- It **guarantees monotonicity** — higher raw probability always maps to higher calibrated probability

**Pool Adjacent Violators (PAV) algorithm:**

1. Sort all historical predictions by predicted probability
2. Start: each prediction is its own "block"
3. Scan left to right. If block[i].avgActual > block[i+1].avgActual (a "violation" — higher prediction had lower actual rate), merge the two blocks
4. Repeat until no violations remain
5. Output the averaged (x, y) values per block as breakpoints

Visual example:
```
Raw data (sorted by predicted):
  predicted: 0.10  0.20  0.30  0.40  0.50  0.60  0.70  0.80
  actual:    0.05  0.15  0.35  0.20  0.45  0.55  0.60  0.85
                              ^^^^  violation! 0.35 > 0.20

After PAV merges the violating pair:
  predicted: 0.10  0.20  [0.35]  0.50  0.60  0.70  0.80
  actual:    0.05  0.15  [0.275] 0.45  0.55  0.60  0.85
                         merged: avg(0.35, 0.20) = 0.275

Now the sequence is monotonically non-decreasing ✓
```

### Applying calibration

When the model outputs a raw probability:

1. Find the two nearest breakpoints that bracket the raw value
2. **Linearly interpolate** between them
3. **Blend with identity** (10% raw + 90% calibrated) to prevent overfitting
4. Clamp to [0.02, 0.95]

```
Example breakpoints: [(0.1, 0.05), (0.3, 0.20), (0.5, 0.45), (0.7, 0.65), (0.9, 0.88)]

Raw probability = 0.40 (between breakpoints 0.3→0.5)
  Interpolation: 0.20 + (0.40 - 0.30)/(0.50 - 0.30) × (0.45 - 0.20) = 0.325
  Identity blend: 0.90 × 0.325 + 0.10 × 0.40 = 0.3325
  Final calibrated: ~0.33

The model said 40%, calibration corrected it to 33%.
```

---

## 7. The CalibrationModelBundle

A single global calibration curve treats all markets the same. But predicting tomorrow's high is very different from predicting the day-after-tomorrow's low. The **segmented bundle** trains separate correction curves for different contexts.

### Structure

```
CalibrationModelBundle (kind: 'segmented-v1')
├── global          — trained on ALL resolved predictions
├── byType
│   ├── temperature-high   — all high-temp markets
│   ├── temperature-low    — all low-temp markets
│   └── precipitation      — all precip markets
└── bySegment (type × lead time)
    ├── temperature-high:lt12h      — high temp, <12h to resolution
    ├── temperature-high:12to24h    — high temp, 12-24h out
    ├── temperature-high:24to48h    — high temp, 24-48h out
    ├── temperature-high:48to72h
    ├── temperature-high:gt72h
    ├── temperature-low:lt12h
    ├── temperature-low:12to24h
    │   ... (up to 15 possible segments)
    └── precipitation:gt72h
```

### Routing hierarchy

When computing probability for a specific market, the system picks the most specific model with enough data:

```
1. SEGMENT  (type + lead bucket)  — if ≥ 200 samples → use it
        ↓ (not enough data)
2. TYPE     (type only)           — if ≥ 200 samples → use it
        ↓ (not enough data)
3. GLOBAL   (all data)            — if ≥ 50 samples → use it
        ↓ (not enough data)
4. NONE     (passthrough)         — return raw probability unchanged
```

**Example:** A temperature-high market resolving in 30 hours:
- Lead bucket = `24to48h`
- Try `temperature-high:24to48h` → only 80 samples → skip
- Try `temperature-high` → 350 samples → use this model

### Why segmentation matters

The model's biases differ by context:
- **Short lead times** (< 12h): Forecasts are accurate, model tends to be well-calibrated
- **Longer lead times** (24-48h): More uncertainty, model may systematically overestimate extreme outcomes
- **High vs low temps**: Different error distributions (highs cluster tighter than lows)

A single curve would average these biases together, diluting corrections. Segmented models apply the right correction for each situation.

### Sample thresholds

- **Global**: needs ≥ 50 samples (bare minimum for isotonic regression)
- **Per-type**: needs ≥ 200 samples (enough to capture the type-specific bias)
- **Per-segment**: needs ≥ 200 samples (same — prevents overfitting on sparse data)

These are conservative thresholds. With fewer samples, isotonic regression can overfit to noise, making calibration worse than no calibration.

---

## 8. Training the Calibration Model

### Data source

Training uses `market_predictions` collection documents that have:
- `correctedProbability` — the model's probability at signal time (0–1)
- `resolvedOutcome` — the actual result (0 = NO, 1 = YES)
- `marketType` — for segmentation (`temperature-high`, `temperature-low`, `precipitation`)
- `hoursToResolution` — for lead-bucket segmentation

### Training trigger

Manual cron call (not automatic):
```bash
curl -X POST /api/weather/calibration \
  -H 'Authorization: Bearer $CRON_SECRET' \
  -d '{"action":"train","lookbackDays":180}'
```

### What training does

1. Pull all resolved predictions from the last 180 days
2. For each context (global, per-type, per-segment):
   a. Collect (predicted, actual) pairs
   b. Run PAV isotonic regression → breakpoints
   c. Compute quality metrics (Brier before/after, calibration error)
3. Package into a `CalibrationModelBundle`
4. Save to MongoDB (`calibration` collection, `_id: 'active'`)
5. Hot-load into the running app via `setCalibrationModel()`

### Startup loading

On app start (`instrumentation.node.ts`):
1. Query MongoDB for `calibration` doc with `_id: 'active'`
2. If found: load into `setCalibrationModel()` — all subsequent probability calculations use it
3. If not found: probabilities pass through uncalibrated (the system works without it)
4. Warning if model is > 30 days old

---

## 9. End-to-End Example

**Market:** "Will NYC high temperature exceed 65°F tomorrow?" (Kalshi price: $0.12)
**Resolution:** 28 hours from now

### Step 1: Gather forecasts
| Source | High Temp Forecast | Weight |
|--------|--------------------|--------|
| NWS | 58°F (14.4°C) | 0.30 |
| Open-Meteo | 57°F (13.9°C) | 0.20 |
| Google Weather | 59°F (15.0°C) | 0.15 |
| AccuWeather | 56°F (13.3°C) | 0.10 |
| Tomorrow.io | 58°F (14.4°C) | 0.10 |

### Step 2: Build consensus
- Weighted mean: ~57.8°F (14.3°C)
- StdDev across sources: ~1.0°C
- Agreement score: 100 - (1.0 × 5) = 95 (high agreement)

### Step 3: KDE probability
- Threshold: 65°F = 18.3°C
- The threshold is 4°C above the consensus mean
- Dynamic stdDev floor: 1.4°C (28h lead, 5 sources, high agreement → 1.4 × 0.85 × 0.80 ≈ 0.95, but hard minimum 0.7°C applies → effective ~1.0°C)
- KDE with bandwidth ~1.0°C and all kernels centered around 13.3–15.0°C
- P(T > 18.3°C) ≈ 0.03 (3%) — the threshold is far into the tail

### Step 4: Safety adjustments
- Base-rate blend: 0.95 × 0.03 + 0.05 × 0.50 = 0.0535 (~5.4%)
- Agreement shrinkage: agreement = 95 (> 60%), so no shrinkage
- Clamp: 0.054 is within [0.02, 0.95] ✓

### Step 5: Calibration
- No calibration model loaded (purged) → passthrough
- Final probability: **~5.4%**

### Step 6: Trading decision
- Model: 5.4%, Market: 12¢
- Edge: |0.054 - 0.12| = 6.6% (above 5% display threshold)
- Direction: NO (model < market → sell YES / buy NO)
- The model says the market is overpricing this event
- Signal strength depends on whether 6.6% exceeds the dynamic minEdge threshold

---

## 10. Current State & Next Steps

### What we just fixed
1. **Cross-city contamination** — SWR was serving stale forecast data from City A when computing probabilities for City B's markets. Guard added in commit `ec159c9`.
2. **Calibration trained on contaminated data** — the old calibration model learned wrong mappings. Purged.
3. **Direction bug for KXLOW tickers** — `ticker.includes('LOW')` was forcing `direction='below'` regardless of actual `strike_type`. Removed.

### Current state
- **35 clean resolved predictions** — too few for calibration (need 50+)
- **Calibration disabled** — raw KDE probabilities pass through uncalibrated
- **Raw KDE probabilities are mathematically correct** — the model works without calibration, just less precisely
- **Brier score: 0.218** — below the 0.25 random baseline, showing the raw model has skill

### When to retrain calibration
- **Minimum:** 50+ clean resolved predictions (for global model)
- **Ideal:** 200+ per type (for segmented models)
- **Timeline:** ~2-4 weeks at current signal logging rate for 50+ global

### What calibration will improve
Looking at the reliability curve on the dashboard: the model's predicted probabilities don't perfectly match actual outcome frequencies. Calibration will bend the curve toward the diagonal (perfect calibration), improving:
- **Brier Skill Score** — should turn positive (beating the market)
- **Win rate** — better-calibrated probabilities produce more accurate edge estimates
- **P&L** — correctly sized edges mean fewer false signals
