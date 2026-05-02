# Phase 2 Deployment Plan — μ Correction Table

Companion to `docs/working-checklist.md` (Phase 2 — μ correction table).
Supersedes the B2 design doc in `memory/item-b2-mu-correction-2026-04-14.md`
with post-grep-audit adjustments.

## Context

Phase 1 (σ refit, deployed 2026-04-15, commit `48637d1`) shipped modest
improvement (BSS -0.30 → -0.27, cal lift 7.4% → 8.3%) but plateaued at
Day 4. Day 5 synthesis (2026-04-20) + Pathway 2 σ-independent check
both pointed to the same cause: predictions compressed toward the 0.2
ceiling because σ is too wide for threshold regime, and per-source
bias is not corrected for.

Phase 2 addresses the *second* half of that story — per-source μ
correction. Google-Weather and Tomorrow.io carry cold bias of -2.4 to
-3.4°F that the current per-city scalar bias cannot capture because
it shifts all five sources uniformly. The fix is a lookup table keyed
by `(source, leadBucket, temperatureType, regime)`.

## Goals

- Per-source bias correction is applied BEFORE BMA aggregation, using a
  static `MU_CORRECTION_TABLE` mirroring `SIGMA_SOURCE_TABLE`'s
  structure and key format.
- Google-Weather and Tomorrow.io mean bias moves from -3.35°F / -2.43°F
  (24to48h high inner) toward zero within 3 days post-deploy.
- No other source's MAE degrades by >0.3°F vs pre-deploy baseline.
- Feature flag (`MU_CORRECTION_ENABLED`) lets us toggle off via PM2
  reload without a code revert if the table values turn out wrong.

## Scope

### In scope
- New `MU_CORRECTION_TABLE` export in `src/lib/models/weatherProbability.ts`
  (alongside `SIGMA_SOURCE_TABLE`), keyed `${source}:${leadBucket}:${type}:${regime}`.
- New `getMuCorrection(source, hoursToResolution, temperatureType, bracketRegime)`
  helper — parallel to `getPerSourceSigma()` — returning °C value (table
  stored in °C for consistency with σ; source values in memory doc are
  °F and need conversion at table-construction time).
- Per-source μ correction applied in `buildForecastDistribution()` at
  `src/lib/models/forecastDistribution.ts:90` — the unified injection
  point for both threshold and inner BMA paths.
- Feature flag `MU_CORRECTION_ENABLED` (default `true`; env var reads
  `process.env.MU_CORRECTION_ENABLED !== 'false'` — mirrors `BMA_ENABLED`
  pattern at `weatherProbability.ts:501`).
- Deprecate the city-level `biasCorrection` scalar parameter in the BMA
  callers: when `MU_CORRECTION_ENABLED=true`, ignore the scalar; when
  `false`, use the scalar as today (so both paths coexist during rollout).
- Keep `getCityBias()` / `temperature_bias` collection untouched for now
  — removal is a follow-up cleanup (Phase 2b), not part of this deploy.

### Out of scope (deferred)
- `Phase 1.5 — σ retune to debiased values` (queued separately, ships
  after Phase 2 validates clean).
- Expanded σ reduction for threshold regime per Day 5 carry-forward
  (goes into Phase 1.5 scope expansion, not here).
- Removing `getCityBias()` and the `temperature_bias` MongoDB collection
  (Phase 2b cleanup, after 2+ weeks of stable μ operation).
- Tail-sell → `source_accuracy` plumbing (Pathway 1 per yesterday's plan;
  ships after Phase 2 validates).

## Design

### Table structure

Key format: `${source}:${leadBucket}:${temperatureType}:${regime}`
(identical to `SIGMA_SOURCE_TABLE`).

Lead bucket lookup falls back gt72h when key missing (mirrors
`getPerSourceSigma()` at `weatherProbability.ts:539`).

Values stored in °C (converted from the °F values in the B2 memory doc
at table-definition time — multiply °F by 5/9).

**Temperature-high entries (from memory doc, °F → °C):**

| Source | 12to24h inner | 24to48h inner | gt72h inner | gt72h threshold |
|---|---|---|---|---|
| NWS | 0.0 | -0.39 | -0.21 | -0.47 |
| AccuWeather | 0.0 | -0.75 | -0.57 | -1.07 |
| Open-Meteo | 0.0 | -0.83 | -1.16 | -0.48 |
| Google-Weather | -0.99 | **-1.86** | **-1.83** | **-2.20** |
| Tomorrow.io | 0.0 | **-1.35** | **-1.23** | **-1.47** |

**Temperature-low entries (°F → °C):**

| Source | 24to48h inner | gt72h inner | gt72h threshold |
|---|---|---|---|
| NWS | +2.52 | +0.88 | -0.65 |
| AccuWeather | +2.29 | +1.26 | -0.30 |
| Open-Meteo | -0.72 | +1.47 | +0.50 |
| Google-Weather | -0.55 | -0.34 | -1.43 |
| Tomorrow.io | -0.84 | -0.38 | -1.30 |

Note the low-temp inverted pattern: NWS and AW forecast too warm for
lows (positive bias), opposite of their high-temp cold bias. Confirms
`temperatureType` dimension is required.

### Injection point

`src/lib/models/forecastDistribution.ts:90` in `buildForecastDistribution()`.
Current line 90 reads (per grep audit):

```ts
const correctedTemps = maxTemps.map(t => t + biasCorrection)
```

Replaced with (when `MU_CORRECTION_ENABLED`):

```ts
const leadBucket = getLeadBucket(hoursToRes)
const perSourceMu = sourceNames.map(source =>
  getMuCorrection(source, hoursToRes, temperatureType, bracketRegime)
)
const correctedTemps = MU_CORRECTION_ENABLED
  ? maxTemps.map((t, i) => t - perSourceMu[i])  // μ is forecast-minus-actual; subtract to correct
  : maxTemps.map(t => t + biasCorrection)       // legacy path kept behind flag
```

Sign convention: per memory doc, μ is `mean(forecast - actual)`. Positive
μ = source forecasts too warm → subtract to correct. Negative μ = source
forecasts too cold → subtraction becomes addition.

### Sign, scale, and cap — differences from the legacy scalar path

Three things differ between the legacy `biasCorrection` scalar and the
new per-source μ correction. All three are intentional; calling them
out here so the reviewer doesn't have to dig.

1. **Sign convention.** Both conventions measure bias as
   `mean(forecast - actual)`:
   - `temperatureBias.ts:23` comment: `error: number  // forecast - actual`
   - Memory doc `item-b2-mu-correction-2026-04-14.md:93`: "Positive =
     source forecasts too warm → subtract from forecast"
   The legacy path *pre-negates* at `opportunities.ts:111`:
   ```ts
   const rawCorrection = isActive ? -CORRECTION_GAIN * bias.meanError : 0
   ```
   So the value passed into `t + biasCorrection` is already `-scaled
   meanError` — addition applies the correction in the right
   direction. The new MU_CORRECTION_TABLE stores raw `forecast - actual`
   values (no pre-negation). The injection uses `t - perSourceMu[i]`
   to achieve the same net effect without relying on an off-site
   sign flip.

2. **No gain scaling.** Legacy path multiplies by
   `CORRECTION_GAIN = 0.5` at `opportunities.ts:103` — applies only
   50% of observed bias, a conservative hedge when per-city mean
   error might be noisy on a small sample. Phase 2 applies **full
   correction** (effective gain 1.0). Rationale: the B2 memory doc's
   cold-snap cohort validation confirms per-source bias is stable
   within ±1°F across regimes; per-source corpora are ~1,900 rows
   (vs per-city which can be <100). Full correction is justified.
   Tradeoff: overcorrection risk is higher; rollback trigger "bias
   direction reverses" catches this.

3. **No magnitude cap.** Legacy path caps corrections at
   `MAX_CORRECTION_F = 5` (`opportunities.ts:102`) — guards against
   pathological per-city signals. Phase 2 does not cap. The largest
   MU table value is GW threshold-high at -3.96°F (-2.20°C) —
   within the legacy cap anyway. No table value exceeds ±5°F. If a
   future corpus produces a larger bias, the full value will apply
   uncapped; re-evaluate then.

## Work items — checklist format

### Code changes (~60-90 LOC across 2 files)

- [ ] **Add `MU_CORRECTION_TABLE` + `getMuCorrection()` to `weatherProbability.ts`**
      File: `src/lib/models/weatherProbability.ts` (append after
      `SIGMA_SOURCE_TABLE` block ending at line 498)
      What: ~40 lines — table definition + accessor mirroring
      `getPerSourceSigma()`'s shape. gt72h fallback for missing lead
      keys. Return 0 when table has no matching entry (safe default).
      All values in °C.

- [ ] **Add feature flag + branch in `forecastDistribution.ts`**
      File: `src/lib/models/forecastDistribution.ts:90`
      What: ~15 lines — import `getMuCorrection`; read
      `MU_CORRECTION_ENABLED = process.env.MU_CORRECTION_ENABLED !== 'false'`
      at module top; branch `correctedTemps` computation per design
      above.

- [ ] **Verify legacy path still compiles and typechecks**
      Run `npx tsc --noEmit` — no regressions outside the intentional
      edit sites.

### Tests (optional for this deploy — rollback lever is the flag)

- [ ] **Unit tests for `getMuCorrection`** (if time allows)
      File: `src/lib/models/__tests__/weatherProbability.test.ts` or
      similar. Verify: key hit, gt72h fallback, missing-key returns 0,
      all source/lead/type combinations resolve.

### Deploy

- [ ] TypeScript clean (`npx tsc --noEmit`)
- [ ] Build clean (`npm run build`)
- [ ] Existing tests pass (`npx vitest run` — no new expectations needed
      since legacy behavior is preserved behind flag when
      `MU_CORRECTION_ENABLED=false`)
- [ ] Commit with conventional message and plan reference
- [ ] Single SSH session deploy: `git pull --ff-only` → `npm install`
      → `pm2 stop kardashev-web` → `rm -rf .next` → `npm run build`
      → `pm2 start kardashev-web`
- [ ] `/pulse-check` passes post-deploy
- [ ] Verify new flag is active: grep PM2 stdout for "MU_CORRECTION"
      or inspect a live forecast-log to confirm `correctedTemps`
      reflects per-source μ

### Daily measurement (3-5 days post-deploy)

- [ ] Day 1 post-deploy: `/check-calibration` — BSS and per-source mean
      error captured. Baseline for μ correction window.
- [ ] Day 2: `/check-calibration` — Google-Weather 24to48h:high mean
      bias moving toward zero? (target: within ±1°F of zero by Day 3)
- [ ] Day 3: `/check-calibration` — all sources within ±0.5°F of zero?
- [ ] Day 4-5 (if needed): continue monitoring until metrics stabilize

## Risks & rollback

### Rollback triggers (from working-checklist Phase 2)

- Per-source MAE increases by >0.3°F on any source (inner or threshold)
  for 3+ consecutive days
- Bias direction reverses on any source (correction overshoots — e.g.,
  GW goes from -3.35°F to +0.5°F or more positive)

### Rollback mechanism

Feature flag toggle via PM2, no code revert required:

```bash
ssh root@104.248.223.48 'cd /var/www/kardashev &&
  echo "MU_CORRECTION_ENABLED=false" >> .env.local &&
  pm2 reload kardashev-web --update-env'
```

Code revert (if flag toggle insufficient): `git revert <commit>` +
standard deploy sequence.

### Risks to flag

- **Staleness risk.** μ values were computed on 2026-04-14 corpus
  (~1,900 inner + ~235 threshold rows per source). Corpus has grown
  since; actual bias may have drifted. Mitigation: validate Day 1-2
  that observed per-source bias moves toward zero, not past it.
- **Overcorrection risk on extreme μ values.** GW threshold high at
  -2.20°C (-3.96°F) is the largest correction. If the underlying bias
  has softened, we'd overshoot into warm territory. Mitigation: the
  Day 1-2 per-source MAE check surfaces this fast; rollback trigger
  ("bias direction reverses") catches the explicit overshoot case.
- **Low-temp path is COLD because `LOW_TEMP_SIGNAL_GENERATION_ENABLED`
  is currently OFF (commit `affc672`).** The low-temp μ entries ship
  in this deploy but won't affect any trades until low-temp signals
  re-enable (Deploy 3 post-Phase-2 per working-checklist). They're
  validated by shadow logging only. Low-temp rollback concerns are
  downstream.
- **Cold-snap cohort sensitivity.** B2 validated bias-stability across
  March 24-31 cold snap (within ±1°F of global). If we're currently
  in another unusual synoptic regime (late April thaw? check weather),
  the static μ may be a worse fit than the corpus average suggests.
  Mitigation: the Day 1-2 metrics surface this quickly — if MAE
  moves the wrong way across multiple sources simultaneously, roll
  back.

## Verification (how we know it worked)

### Primary

- **Per-source MAE trend:** per-source mean error from
  `/check-calibration`'s observation side should move toward zero for
  GW and TI specifically within 3 days. Query pattern: compare MAE
  across sources pre-deploy (today's baseline) vs Day 3 post-deploy.
- **Ensemble-level BSS:** BSS on active calibration model should
  improve from -0.27 (Day 5 baseline) — even 0.02-0.03 improvement
  indicates the μ correction is contributing signal.
- **0.3+ reliability bins populate:** Phase 1 didn't move predictions
  high enough to populate 0.3+ bins (validation criterion unmet for
  5 days). Phase 2 should push some predictions higher. If 0.3+
  remains empty 5 days post-Phase-2, the residual gap isn't per-source
  bias — it's elsewhere (correlated source errors, σ too wide, other).
- **Calibration lift:** should continue to inch up past 8.3% as
  per-source debiased predictions produce cleaner raw signal for the
  calibrator.

### Independent re-check (Day 3-5 post-deploy)

- **Rerun Pathway 2** (σ independent check) using updated µ-corrected
  forecasts. The signal under Phase 2 should show σ-derived tail
  probability moving closer to observed 0% (because µ correction
  shifts means closer to bracket, narrowing the gap between what σ
  predicts and what we observe). If σ-derived stays at 20-40% with
  observed at 0%, the σ table itself is the issue (not μ), confirming
  the Phase 1.5 scope expansion is warranted.

## Open questions for Ty — RESOLVED (2026-04-20)

1. **Feature flag default — DEFAULT-ON confirmed.** Ship with
   `MU_CORRECTION_ENABLED=true`. Rationale: clean rollback via PM2
   reload, and default-off would add a manual enable step that's
   easy to forget.
2. **Unit-test coverage — SKIPPED for this deploy.** Rollback lever
   is the feature flag; the legacy path is preserved. Tests for
   `getMuCorrection` are low-value relative to deploy delay (table
   lookup + fallback is straightforward; integration verification
   via the Day 1-2 MAE check is what actually validates behavior).
   Backfill tests during Phase 1.5 session.
3. **Low-temp entries — INCLUDE in table.** Even though
   `LOW_TEMP_SIGNAL_GENERATION_ENABLED=false` means no low-temp
   trades fire, including the rows avoids a later churn cycle
   (strip + re-add) and means correct corrections are in place from
   day one if the kill switch flips unexpectedly.

## Cross-references

- `docs/working-checklist.md` Phase 2 section — ownership of this work
- `memory/item-b2-mu-correction-2026-04-14.md` — design origin, corpus
  details, sign conventions
- `memory/item-b-summary-2026-04-14.md` — full B1-B5 synthesis
- `memory/feedback-plan-doc-external-review-cycle.md` — this plan was
  drafted anticipating review; decision rules and thresholds specified
  up front
- `~/.claude/plans/solar-dashboard-audit-nested-wombat.md` (active) —
  tail-sell brainstorm with Pathway 2 results that corroborate
  Phase 1.5 scope expansion
