# City-Specific Dynamic Weights — Implementation-Ready Engineering Spec

**Version:** 1.0  
**Date:** 2026-03-02  
**Status:** Approved for implementation

---

## 1) Purpose

Implement city-specific dynamic source weighting for weather market probability generation, with:

- hierarchical fallback to avoid sparse-data overfitting,
- Redis-served weight rollups for low-latency production reads,
- calibration compatibility under non-stationary probability distributions,
- end-to-end traceability from signal snapshot -> resolved outcome -> source skill update.

This spec is implementation-ready and defines exact interfaces, key contracts, integration points, and phase acceptance tests.

---

## 2) Scope

### In Scope

- City-aware dynamic weights for forecast sources (`Open-Meteo`, `Google-Weather`, `NWS`, `AccuWeather`, `Tomorrow.io`; excludes `METAR` for forward probability generation).
- Lead-time-aware weighting (`leadBucket`).
- Hierarchical shrinkage fallback: `city+marketType+leadBucket -> city+marketType -> city -> global -> default`.
- Redis rollup serving path (`kn:weights:*`) with Mongo as source of truth.
- Missing-source-safe renormalization.
- Segmented calibration routing to avoid global calibrator collision.
- Phased rollout with shadow mode and kill switches.

### Out of Scope

- Trade execution logic changes (other than consuming updated probabilities).
- New external data providers.
- Portfolio/risk engine redesign.

---

## 3) Current-State Constraints (must preserve)

- Existing Redis wrapper in `src/lib/cache/redis.ts` uses logical keys and prepends `kn:` internally.
- `WeatherEnsemble` and probability calculators in `src/lib/models/weatherProbability.ts` remain primary decision path.
- Resolution pipeline runs through `src/pages/api/weather/resolve-markets.ts` and performance tracking via `src/lib/models/performanceTracker.ts`.
- `METAR` remains observation-only and excluded from forecast-source probability math.

---

## 4) Target Architecture

1. **Signal snapshot time (server-side):** capture per-source modeled probabilities and context (city, marketType, leadBucket).
2. **Market resolution time:** map resolved outcome back to stored source snapshots and write source-accuracy observations.
3. **Rollup job (cron/background):** compute decayed source skill, apply shrinkage, cache effective weights in Redis.
4. **Probability calculation time:** read Redis weights by city/type/leadBucket, fallback hierarchically, drop missing sources, renormalize, then compute probabilities.
5. **Calibration routing:** use segmented calibrator by `(marketType, leadBucket)` with global fallback.

---

## 5) Data Contracts

## 5.1 TypeScript Interfaces

Add to `src/types/weather.ts` (or new `src/types/weights.ts` and re-export):

```ts
export type ForecastSource = 'Open-Meteo' | 'Google-Weather' | 'NWS' | 'AccuWeather' | 'Tomorrow.io'
export type MarketType = 'temperature-high' | 'temperature-low' | 'precipitation'
export type LeadBucket = 'lt12h' | '12to24h' | '24to48h' | '48to72h' | 'gt72h'
export type WeightRegime =
  | 'city_type_lead'
  | 'city_type'
  | 'city'
  | 'global'
  | 'default'

export interface SourcePredictionSnapshot {
  signalId: string
  marketId: string
  cityCode: string
  marketType: MarketType
  leadBucket: LeadBucket
  timestamp: number
  policyVersion: string
  calibrationModelId?: string
  sources: Array<{
    source: ForecastSource
    predictedProbability: number // [0,1]
    available: boolean
  }>
  ensemble: {
    rawProbability: number
    correctedProbability: number
    selectedRegime: WeightRegime
    appliedWeights: Partial<Record<ForecastSource, number>>
  }
  expiresAt: Date
}

export interface SourceAccuracyObservation {
  id: string
  signalId: string
  marketId: string
  cityCode: string
  marketType: MarketType
  leadBucket: LeadBucket
  source: ForecastSource
  predictedProbability: number
  actual: 0 | 1
  timestamp: number
  policyVersion: string
  expiresAt: Date
}

export interface SourceSkillRollup {
  source: ForecastSource
  cityCode?: string
  marketType?: MarketType
  leadBucket?: LeadBucket
  effectiveSampleSize: number
  decayedBrier: number
  decayedMae?: number
  lastUpdated: number
}

export interface DynamicWeightResult {
  weights: Partial<Record<ForecastSource, number>>
  regime: WeightRegime
  effectiveSampleSize: number
  computedAt: number
  expiresAt: number
}
```

## 5.2 Mongo Collections

### Collection: `source_accuracy`

Purpose: immutable source-level prediction outcomes.

Document shape: `SourceAccuracyObservation`

Indexes (required):

```js
{ source: 1, cityCode: 1, marketType: 1, leadBucket: 1, timestamp: -1 }
{ cityCode: 1, marketType: 1, timestamp: -1 }
{ marketId: 1, signalId: 1 }
{ expiresAt: 1 } // TTL expireAfterSeconds: 0
```

Retention:

- trade-linked rows: 400 days
- non-trade/telemetry rows: 45 days

### Collection: `source_prediction_snapshots`

Purpose: snapshot source probabilities used at decision time.

Document shape: `SourcePredictionSnapshot`

Indexes (required):

```js
{ signalId: 1 }
{ marketId: 1, timestamp: -1 }
{ cityCode: 1, marketType: 1, timestamp: -1 }
{ expiresAt: 1 } // TTL expireAfterSeconds: 0
```

Retention:

- actionable signals (`edge >= threshold`): 400 days
- telemetry snapshots: 45 days

---

## 6) Redis Key Contracts (L2 serving path)

`src/lib/cache/redis.ts` prepends `kn:`. Keys below are logical keys passed to `rget/rset`.

## 6.1 Weight Rollups

### Canonical key

`weights:{cityCode}:{marketType}:{leadBucket}`

Stored value (`DynamicWeightResult`):

```json
{
  "weights": {
    "NWS": 0.34,
    "Open-Meteo": 0.22,
    "Google-Weather": 0.19,
    "AccuWeather": 0.13,
    "Tomorrow.io": 0.12
  },
  "regime": "city_type_lead",
  "effectiveSampleSize": 87.4,
  "computedAt": 1762372800000,
  "expiresAt": 1762376400000
}
```

TTL: `3600` seconds (1h)

### Fallback keys

- `weights:{cityCode}:{marketType}:all`
- `weights:{cityCode}:all:all`
- `weights:global:{marketType}:{leadBucket}`
- `weights:global:{marketType}:all`
- `weights:global:all:all`

All use same JSON schema and TTL.

## 6.2 Rollup metadata key

`weights:meta:lastRollupAt`

Value:

```json
{ "timestamp": 1762372800000, "version": "weights-v1" }
```

TTL: `7200` seconds.

## 6.3 Cache behavior requirements

- Read path must never throw on Redis miss/unavailable.
- On miss, fallback hierarchy resolves from Mongo or defaults, then backfills Redis.
- Redis unavailability must degrade to deterministic default weights.

---

## 7) Algorithms (normative)

## 7.1 Lead bucket function

```ts
export function toLeadBucket(hoursToResolution: number): LeadBucket {
  if (hoursToResolution < 12) return 'lt12h'
  if (hoursToResolution < 24) return '12to24h'
  if (hoursToResolution < 48) return '24to48h'
  if (hoursToResolution < 72) return '48to72h'
  return 'gt72h'
}
```

## 7.2 Decayed Brier and effective sample size

Half-life: `14 days`

For observation `i` at age `a_i` days:

$$w_i = 2^{-a_i / 14}$$

Decayed Brier for a source/context:

$$\text{Brier}_d = \frac{\sum_i w_i (p_i - y_i)^2}{\sum_i w_i}$$

Effective sample size:

$$N_{eff} = \frac{(\sum_i w_i)^2}{\sum_i w_i^2}$$

## 7.3 Shrinkage to prior

City-context raw inverse-Brier weight for source `s`:

$$u_s = \frac{1}{\epsilon + \text{Brier}_{d,s}}$$

Normalize `u_s` across available sources to `w_city_raw`.

Shrinkage coefficient:

$$\lambda = \frac{N_{eff}}{N_{eff} + k}$$

Default: `k = 50`.

Final blended weight:

$$w_s = \lambda \cdot w_{city\_raw,s} + (1-\lambda) \cdot w_{prior,s}$$

Where prior is next fallback level.

Apply bounds before final renormalization:

- `minWeight = 0.05`
- `maxWeight = 0.60`

## 7.4 Missing-source handling (required)

Given desired weights and `availableSources`:

1. Drop missing sources from map.
2. If none remain, return default source weights for available set.
3. Renormalize surviving weights to sum exactly `1.0`.
4. If bounded weights violate sum after clipping, run water-filling renormalization.

---

## 8) Calibration Strategy (to prevent calibrator collision)

Global single isotonic model is non-stationary under dynamic city weighting. Implement segmented calibration routing:

- Primary segment key: `{marketType}:{leadBucket}`
- Fallback: `{marketType}:all`
- Fallback: `global`

Activation gate per segment:

- `minSamples = 200` (segment)
- otherwise fallback to broader segment/global.

### Interface

```ts
export interface CalibrationRouteInput {
  marketType: MarketType
  leadBucket: LeadBucket
}

export interface CalibrationRouteResult {
  modelId: string
  route: 'segment' | 'type' | 'global'
}

export function selectCalibrationModel(input: CalibrationRouteInput): CalibrationRouteResult
```

---

## 9) Exact Integration Points

## 9.1 New files

- `src/lib/models/sourceAccuracy.ts`
  - Mongo writes/reads for `source_accuracy` and snapshot linking.
- `src/lib/models/dynamicWeights.ts`
  - hierarchical read, shrinkage, missing-source renorm.
- `src/lib/models/weightRollupJob.ts`
  - rollup computation and Redis publish.
- `src/pages/api/weather/source-weights.ts`
  - diagnostics endpoint.

## 9.2 Existing files to update

- `src/lib/models/weatherProbability.ts`
  - Accept external dynamic weights in temperature and bracket probability paths.
  - Use available-source renormalized weights instead of static defaults when provided.
- `src/hooks/useWeatherOpportunities.ts`
  - No client-owned weighting logic; consume server-computed outputs only.
- `src/lib/models/performanceTracker.ts`
  - Persist `SourcePredictionSnapshot` on signal log events (server-side path).
  - Resolve and write `SourceAccuracyObservation` at settlement.
- `src/pages/api/weather/resolve-markets.ts`
  - Ensure idempotent settlement update for source observations.
- `src/lib/cache/warmup.ts`
  - Optional prewarm of top city/type/lead weight keys.

## 9.3 Function signatures

```ts
// src/lib/models/dynamicWeights.ts
export interface ResolveWeightsInput {
  cityCode: string
  marketType: MarketType
  leadBucket: LeadBucket
  availableSources: ForecastSource[]
  now?: number
}

export async function resolveDynamicWeights(input: ResolveWeightsInput): Promise<DynamicWeightResult>

// src/lib/models/sourceAccuracy.ts
export async function logSourcePredictionSnapshot(snapshot: SourcePredictionSnapshot): Promise<void>
export async function writeSourceAccuracyFromResolution(args: {
  marketId: string
  signalId: string
  actual: 0 | 1
  resolvedAt: number
}): Promise<number> // rows written

// src/lib/models/weightRollupJob.ts
export async function recomputeAndPublishWeightRollups(args?: {
  cityCodes?: string[]
  marketTypes?: MarketType[]
  leadBuckets?: LeadBucket[]
}): Promise<{ keysWritten: number; durationMs: number }>
```

---

## 10) API Contracts

## 10.1 GET `/api/weather/source-weights`

Query:

- `cityCode` (required)
- `marketType` (required)
- `hoursToResolution` (required)

Response `200`:

```json
{
  "success": true,
  "data": {
    "weights": {
      "NWS": 0.34,
      "Open-Meteo": 0.22,
      "Google-Weather": 0.19,
      "AccuWeather": 0.13,
      "Tomorrow.io": 0.12
    },
    "regime": "city_type_lead",
    "effectiveSampleSize": 87.4,
    "computedAt": 1762372800000,
    "expiresAt": 1762376400000,
    "leadBucket": "24to48h"
  },
  "timestamp": 1762372815000
}
```

Errors:

- `400` invalid params
- `500` internal failure (must still include deterministic fallback in internal trading path; endpoint failure must not block trade computation)

## 10.2 POST `/api/weather/rollup-weights` (internal/cron)

Auth required (`requireAuth` or `CRON_SECRET`).

Body (optional filter):

```json
{
  "cityCodes": ["NYC", "CHI"],
  "marketTypes": ["temperature-high", "temperature-low"],
  "leadBuckets": ["12to24h", "24to48h"]
}
```

Response `200`:

```json
{ "success": true, "data": { "keysWritten": 180, "durationMs": 942 }, "timestamp": 1762372820000 }
```

---

## 11) Critical Implementation Caveats

Before starting implementation, the following tactical details must be strictly observed:

1. **Handle "Canceled" Market Resolutions:**
   Kalshi markets occasionally resolve to `canceled` or get voided. The `resolve-markets.ts` integration must explicitly ignore/drop these markets so they don't pollute the `source_accuracy` system with false `0`s. (`actual` should strictly be `0 | 1` for resolved YES/NO).

2. **Protect the Write Path (No Client-Driven Writes):**
   `source_prediction_snapshots` must ONLY be written during background cron resolutions, initial internal cache-warming, or when a user actually executes a trade. Do *not* attach `logSourcePredictionSnapshot` to the public public forecast or opportunities endpoints if they can be spammed by client reloads, or the database will be overwhelmed.

3. **Water-Filling Algorithm Needs Strict Tests:**
   The algorithm for missing-source renormalization (Section 7.4) is tricky edge-case logic. When applying bounds `[0.05, 0.60]` after dropping a source, the system must renormalize, clip to bounds, distribute the excess proportionally, and repeat until stable. A standalone, pure-function unit test must be written specifically for this logic before it is integrated.

---

## 12) Rollout Phases + Acceptance Tests

## Phase 1 — Data Plumbing + TTL + Lineage

### Deliverables

- `source_prediction_snapshots` writes from server-side signal generation path.
- `source_accuracy` writes from settlement mapping.
- TTL indexes active for both collections.

### Acceptance Tests

1. **Snapshot integrity**
   - Given a logged actionable signal, one snapshot exists with all available source probabilities.
2. **Resolution linkage**
   - Given a settled market, `writeSourceAccuracyFromResolution` writes exactly one row per source snapshot.
3. **Idempotency**
   - Re-running the same resolution does not create duplicate `source_accuracy` rows.
4. **TTL enforcement**
   - Test documents with past `expiresAt` are pruned by Mongo TTL.

## Phase 2 — Rollup Engine + Redis Publish + Shadow Mode

### Deliverables

- Rollup job computes decayed Brier + shrinkage weights.
- Redis keys published for canonical + fallback contexts.
- Trading still uses current baseline probabilities; dynamic outputs logged as shadow metrics.

### Acceptance Tests

1. **Redis contract**
   - `rget('weights:NYC:temperature-high:24to48h')` returns valid `DynamicWeightResult` JSON.
2. **Weight math validity**
   - Weights are bounded [0.05, 0.60] pre-renorm and sum to exactly 1.0 post-renorm.
3. **Fallback correctness**
   - Missing city+type+lead key returns city+type, then city, then global, then default.
4. **Shadow delta logging**
   - For each decision, baseline and shadow probability deltas are logged with route metadata.

## Phase 3 — Pilot Activation (limited cities)

### Deliverables

- Activate dynamic weights for pilot city set only.
- Runtime feature flag + kill switch.

### Acceptance Tests

1. **Feature flag routing**
   - Pilot cities use dynamic route; non-pilot cities remain baseline.
2. **Missing-source resilience**
   - If one provider is unavailable, engine drops it and renormalizes without exception.
3. **Latency budget**
   - P95 weight resolution overhead <= 10ms with Redis hit, <= 75ms with miss+recompute.
4. **No outage degradation**
   - With Redis down, probability computation returns with deterministic default weights.

## Phase 4 — Calibration Refit + Global Rollout

### Deliverables

- Segmented calibrator routing active.
- Calibration retrained using dynamic-weight regime data.
- Global rollout enabled.

### Acceptance Tests

1. **Calibration route selection**
   - Segment with enough samples selected; otherwise fallback to type/global.
2. **Reliability improvement**
   - Out-of-sample ECE and Brier improve or remain non-inferior to baseline by pre-defined thresholds.
3. **Trade quality guardrail**
   - No statistically significant degradation in realized edge capture over pilot window.
4. **Operational stability**
   - Error rate and timeout rate for weather opportunities endpoints do not regress.

---

## 13) Non-Functional Requirements

- **Determinism:** same inputs + same rollup state => same weights.
- **Observability:** log `weightRegime`, `effectiveSampleSize`, `leadBucket`, `availableSources`, and `calibrationRoute` per decision.
- **Backward compatibility:** if dynamic path fails, baseline behavior remains unchanged.
- **Security:** mutating endpoints must require auth; reject untyped payloads.

---

## 14) Operational Guardrails

- Feature flags:
  - `DYNAMIC_WEIGHTS_ENABLED` (global)
  - `DYNAMIC_WEIGHTS_PILOT_CITIES` (comma list)
  - `DYNAMIC_WEIGHTS_SHADOW_MODE` (log only)
- Rollback: disable feature flag, preserve data collection.
- Alert thresholds:
  - Redis key freshness (`weights:meta:lastRollupAt`) > 2h stale -> warning
  - Weight resolution fallback-to-default rate > 10% -> warning
  - Pilot city probability drift > configured threshold -> warning

---

## 15) End-to-End "No Loose Ends" Checklist

- [x] Source snapshots written server-side with lineage fields.
- [x] Settlements map snapshots to source outcomes idempotently.
- [x] Mongo TTL retention verified for snapshots and accuracy observations.
- [x] Rollup job writes all required Redis keys and metadata key.
- [x] Probability engine consumes dynamic weights with fallback + missing-source renorm.
- [x] Segmented calibration routing active with sample gates.
- [x] Shadow metrics available and reviewed before pilot activation.
- [ ] Pilot + global acceptance tests passed.

---

## 16) Appendix — Default Constants (v1)

- Decay half-life: `14 days`
- Shrinkage constant `k`: `50`
- Inverse-Brier epsilon: `0.001`
- Min samples for dynamic activation:
  - `N_eff >= 30` for `city+type+lead`
  - `N_eff >= 50` for `city+type`
  - `N_eff >= 75` for `city`
  - else fallback
- Redis weight key TTL: `3600s`
- Rollup cadence: every `1h` (plus on-demand API trigger)

These constants are policy-configurable and must be versioned via `policyVersion`.
