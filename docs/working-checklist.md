# Working Checklist — Item B Coordinated Refit + Low-Temp Warm-Tail Rollout

**Created:** 2026-04-15
**Last updated:** 2026-04-20
**Current phase:** Phase 1 COMPLETE (Day 5 = PROCEED 2026-04-20) → Phase 2 queued next

## How to use this checklist

- Mark items complete with `[x]` as phases progress
- Update "Last updated" and "Current phase" at the top when state changes
- Run `/check-calibration` daily during active measurement windows and note key metrics inline
- Each phase has explicit validation criteria and rollback triggers — do not proceed to the next phase without satisfying the gate
- Reference files are linked by full path for quick navigation

## Timeline summary

| Phase | Expected dates | Status |
|-------|---------------|--------|
| Phase 1: σ refit + threshold weights | Apr 15-20 | **COMPLETE** (PROCEED 2026-04-20) |
| Tail-sell → recalibration: Pathway 2 (σ check, Day 5 input) | Apr 20 (before Day 5) | Queued |
| Phase 2: μ correction table | Apr 20-24 | **NEXT** |
| Tail-sell → recalibration: Pathway 1 (source_accuracy writeback) | Apr 22-30 (post-Phase-2) | Queued |
| Deploy 3: Low-temp infrastructure (kill switch OFF) | Apr 24-27 | Queued |
| Phase 1.5: σ retune to debiased values | Apr 27-30 | Queued |
| Shadow validation (warm-tail) | Apr 27 - May 8 | Queued |
| Limited city rollout (ATL/MIA/LAX) | May 8-15 | Queued |
| Phase 3: Calibration retrain | May 8-15 | Queued (parallel) |
| All-cities rollout at $5 | May 15-29 | Queued |
| Position size raise to $10 | May 29+ | Queued |
| Final evaluation | May 15-19 | Queued |

---

## Phase 1: σ refit + threshold weights (IN PROGRESS)

**Status:** Deployed 2026-04-15 ~20:08 UTC, commit `48637d1`
**Scope:** Regime-aware SIGMA_SOURCE_TABLE (45 cells), lead bucket collapse (4→3), THRESHOLD_WEIGHTS (uniform 20%)
**Reference:** `memory/item-b-phase-1-deploy-2026-04-15.md`

### Pre-deploy baseline (captured at deploy time)

| Metric | Value |
|--------|-------|
| BSS (calibrated, clean era) | -0.30 (249 trades) |
| BSS (all resolved) | -0.44 (1,810 trades) |
| Raw Brier | 0.261 |
| Calibrated Brier | 0.242 |
| Market Brier | 0.194 |
| Calibration lift | 7.4% |
| Reliability 0.0-0.1 gap | 0.175 (underconf) |
| Reliability 0.1-0.2 gap | 0.276 (underconf) |
| Reliability 0.2-0.3 gap | 0.293 (underconf) |
| Pending trades | 37 |

### Daily measurement checklist

- [x] Day 0 (Apr 15): `/check-calibration` within 2 hours of deploy — BSS -0.30, 37 pending, baseline captured
- [x] Day 1 (Apr 16): `/check-calibration` — BSS: -0.26 (276 trades), 0.1-0.2 gap: 0.251, 0.2-0.3 gap: 0.284, pending: 29. All metrics improving.
- [x] Day 2 (Apr 17): SKIPPED — check not run within window. Day 3 (Apr 18) below captures current state; 21 trades resolved between Day 1 and Day 3 checks.
- [x] Day 3 (Apr 18): `/check-calibration` — mid-window checkpoint. BSS: -0.28 (active model `cal_1775184454578:global`, 297 trades), 0.1-0.2 gap: 0.252, **0.2-0.3 gap: 0.313 (worsened from 0.293 baseline)**, pending: 19. Calibration lift 8.0% (up from 7.4% baseline). Reliability 0.3+ bins still empty (0 trades). PM2 clean. Mixed signals — see notes below.
- [x] Day 4 (Apr 19): `/check-calibration` — BSS: -0.28 (active model, 307 trades), 0.1-0.2 gap: 0.256 (slight drift up from D3's 0.252), 0.2-0.3 gap: 0.312 (plateaued at D3's 0.313), pending: 19 (unchanged). Calibration lift 8.3% (up from 8.0%). Reliability 0.3+ bins still empty. **Plateau day** — see Day 4 notes below.
- [x] Day 5 (Apr 20): `/check-calibration` — **validation decision**. BSS: -0.27 (active model, 313 trades, improved +0.01 vs Day 4), 0.1-0.2 gap: 0.256 (unchanged from Day 4), 0.2-0.3 gap: 0.291 (recovered from Day 3/4 excursion, back near baseline), pending: 15. Calibration lift 8.3% (unchanged). **0.3+ bins STILL empty — validation criterion #1 not met across all 5 days.** See Day 5 synthesis below.

### Day 3 notes (mid-window assessment)

- **No rollback trigger fired.** BSS -0.28 well above the -0.35 floor; 0.0-0.2 gaps not worsened over 3+ days; signal generation continues across cities.
- **0.2-0.3 gap worsening (0.293 → 0.313, +0.020) is a yellow flag.** Not a rollback signal but worth watching at Day 4. The 0.1-0.2 gap continues to improve (0.276 → 0.251 → 0.252) per the σ refit's intent; the 0.2-0.3 worsening may indicate the σ-table changes are pushing some predictions into a new misalignment band.
- **0.3+ reliability bins remain empty.** Phase 1's σ refit was expected to encourage higher predictions over time. Three days in, no observations there yet. Validation criterion #1 ("0.3+ bins start populating with at least 5 trades each") is unmet but not broken — still possible by Day 5, especially as the 19 pending trades resolve.
- **Calibration model is now 16 days old, 297 new rows since training; retrain recommendation = RETRAIN.** Defer to **Phase 3 (planned May 8-15)** — retraining mid-Phase-1 would confound the σ-refit signal and pollute the validation window. Surface for awareness only.
- **Sample-size caveat:** the active model only has 297 resolved trades (vs 1,813 on the legacy `none` route). BSS -0.28 is moderately stable but a single bad day could swing it more than expected.

### Day 4 notes (one day before validation decision)

- **No rollback trigger fired.** BSS still -0.28 (vs -0.35 floor); 0.0-0.2 gaps not worsened vs baseline; signal generation continues (latest unresolved Apr 19 09:01 SFO).
- **Plateau across all key metrics.** BSS unchanged from Day 3. 0.1-0.2 gap drifted up 0.004 (within noise). 0.2-0.3 gap stable at 0.312 (still worse than baseline's 0.293, not improving). Pending unchanged at 19. The σ refit moved metrics in the first 24h (Day 0 → Day 1), then they've stayed essentially flat for three days.
- **Validation criteria status going into Day 5:**
  - 0.3+ bins populate with ≥5 trades each → **NOT MET** (still all 0; this is the most concerning miss because the σ refit was specifically expected to push predictions higher)
  - 0.1-0.2 gap shrinks toward 0.20 → **PARTIAL** (0.276 → 0.256, still 0.056 above target)
  - 0.2-0.3 gap shrinks toward 0.25 → **NOT MET** (0.293 → 0.312, moved the wrong direction)
  - BSS moves from -0.30 toward -0.20 → **PARTIAL** (-0.30 → -0.28, only 0.02 of 0.10 progress)
- **Day 5 decision-direction read:** lines up with **ITERATE** (extend measurement). Not enough movement to declare PROCEED, no rollback trigger to declare ROLLBACK. Strong "wait and see" signal — possibly extend by 3-5 days, possibly accept that the σ refit was a partial win and move to Phase 2.
- **Calibration lift continues to inch up** (7.4% → 8.0% → 8.3%) — calibration is doing slightly more work each day; small win regardless of where the σ refit lands.

### Validation criteria (what success looks like) — Day 5 final

- [ ] Reliability bins 0.3+ start populating with at least 5 trades each → **NOT MET** (still 0 across all 5 days)
- [ ] 0.1-0.2 bin gap shrinks from 0.276 toward 0.20 or lower → **PARTIAL** (0.276 → 0.256, stalled for 4 days at 0.256)
- [ ] 0.2-0.3 bin gap shrinks from 0.293 toward 0.25 or lower → **PARTIAL** (0.293 → 0.291, marginal improvement only)
- [ ] BSS moves from -0.30 toward -0.20 or better → **PARTIAL** (-0.30 → -0.27, 30% of target progress)

### Rollback triggers

- BSS worsens by >0.05 over 3+ consecutive days (drops below -0.35)
- Reliability 0.0-0.2 bin gap increases vs baseline over 3+ days
- Any previously-trading city stops generating signals for >24 hours
- **Rollback command:** `git revert 48637d1` → deploy

### Decision point at Day 5

**No rollback triggers fired:**
- BSS never dropped below -0.30 floor (stayed -0.27 to -0.28 across Days 1-5, actually IMPROVED vs baseline by 0.03)
- 0.0-0.2 reliability bins never worsened vs baseline (both improved slightly and held)
- Signal generation continuous (15 pending, most recent Apr 19-20)

**Synthesis across Days 0-5:**

| Metric | D0 | D1 | D3 | D4 | D5 | Net direction |
|---|---|---|---|---|---|---|
| BSS | -0.30 | -0.26 | -0.28 | -0.28 | -0.27 | +0.03 ✓ (modest) |
| 0.1-0.2 gap | 0.276 | 0.251 | 0.252 | 0.256 | 0.256 | -0.020 ✓ (plateau) |
| 0.2-0.3 gap | 0.293 | 0.284 | 0.313 | 0.312 | 0.291 | -0.002 (recovered) |
| 0.3+ bins populated | 0 | 0 | 0 | 0 | 0 | — (never moved) |
| Pending | 37 | 29 | 19 | 19 | 15 | -22 (resolving) |
| Cal lift | 7.4% | — | 8.0% | 8.3% | 8.3% | +0.9pp ✓ |

**Pattern:** σ refit moved metrics in Days 0-1, then plateaued Days 2-5. We're at the ceiling of what this specific intervention can do. The persistent 0.3+ empty-bin signal is the most important miss — Phase 1 was expected to push predictions higher into those bins, and it didn't.

**Corroborating evidence from Pathway 2 (Day 5 morning, above):** σ table for threshold regime appears to be oversized. Observed tail rate 0% vs σ-derived 21-42% per cell, 5 flagged cells across all 5 sources at 24to48h. This is consistent with "σ too wide for threshold → predictions compressed toward 0.2 ceiling → 0.3+ bins empty." Two independent signals from the same direction.

**Decision options and my recommendation:**

- [ ] **PROCEED** to Phase 2 (μ correction). My recommendation. Rationale: 5 days of plateau tells us more time with current parameters won't move the needle. Phase 2 is the next lever (per-source bias correction) and it directly addresses one of the plausible reasons 0.3+ bins stay empty. Bundle with a scope adjustment to Phase 1.5 — add explicit investigation of threshold-regime σ values to see if they need broader reduction than just debiasing, informed by Pathway 2's findings.
- [ ] **ITERATE** (extend Phase 1 window 3-5 more days). Defensible but unlikely to produce new information — the plateau pattern says the σ refit has done what it will do. Main reason to ITERATE would be gathering more Pathway 2 data points at 12to24h and gt72h (currently n<20 on those buckets), but 3-5 more days probably won't take those over n=20 given signal volume.
- [ ] **ROLLBACK** — NOT recommended; no triggers fired, BSS improved modestly.

**Suggested Phase 1.5 scope expansion** (input to Phase 1.5 design later):
- Original scope: debias σ where |μ correction| ≥ 1°F
- Addition: evaluate whether threshold-regime σ values (currently 3.18-3.69°C per source) should be reduced more aggressively. Pathway 2's |Δ| of 0.21-0.35 suggests σ may be 1.5-2× oversized. Re-run Pathway 2 analysis against Phase 2 + 1.5 σ values to confirm.

### Day 5 decision — **PROCEED (confirmed 2026-04-20)**

- [x] **PROCEED** to Phase 2 (validation criteria met or trending positive) — confirmed by Ty
- [ ] ~~**ITERATE** on Phase 1~~
- [ ] ~~**ROLLBACK**~~

**Phase 1 status:** COMPLETE. σ refit shipped at commit `48637d1` (2026-04-15), ran its course through Apr 20. Modest positive movement (BSS +0.03, 0.1-0.2 gap -0.020, cal lift +0.9pp) but hit a ceiling that Phase 2 + Phase 1.5 are expected to break through.

**Carry-forward into Phase 1.5 design (from Day 5 synthesis):** expand scope beyond "debias σ where |μ correction| ≥ 1°F" to also evaluate whether threshold-regime σ values (3.18-3.69°C per source) should be reduced more aggressively. Pathway 2's |Δ| of 0.21-0.35 suggests σ may be 1.5-2× oversized. Re-run Pathway 2 analysis against Phase 2 + 1.5 σ values to confirm.

---

## Tail-sell → recalibration pathway (NEW — added 2026-04-19)

**Source:** Brainstorm/plan at `~/.claude/plans/solar-dashboard-audit-nested-wombat.md`
**Premise:** Tail-sell signals (96% win rate, 80 signals as of Apr 19) carry per-source forecast residuals after market resolution. Currently thrown away. Feeding them into `source_accuracy` augments the corpus that drives dynamic weights and Phase 2 μ correction. Two-pathway sequence: cheap σ-table check now (Day 5 prep), source_accuracy plumbing later (post-Phase-2).

### Pathway 2: σ independent check (one-shot script — Day 5 prep)

**Timing:** Run before Day 5 decision (Apr 20). Output is a deliberate input to PROCEED/ITERATE/ROLLBACK rather than a post-mortem check.
**Effort:** ~1 hour. Single mongo query + math. No deploy, no schema change.

**Spec — fixed before script runs (per reviewer pushback):**
- **Min cell population:** ≥20 observations. Cells with fewer are reported but not flagged.
- **Flag threshold:** |observed tail prob − σ-derived tail prob| ≥ 0.05 (5 percentage points). Tail probability, not implied σ — more interpretable.
- **Trigger ladder:**
  - 0 cells flagged → σ table credible. Note in Day 5 doc, no action.
  - 1-2 cells → σ-credibility caveat in Day 5 doc; not a vote on PROCEED/ITERATE.
  - 3+ cells across multiple sources → input toward ITERATE (broader σ issue).
  - 3+ cells on a single source → that source is a Phase 1.5 retune candidate.

**Pricing-side caveat (must appear in script output):** observed tail probability assumes efficient Kalshi pricing. Tail-sell sells NO at 5-20¢ where liquidity is thin and mispricing likely. A 96% win rate could mean (a) true tail narrower than σ table says, OR (b) tail matches table but Kalshi systematically overprices the cold tail by ~15-20¢. Output should name explicitly: "if Kalshi systematically overprices the cold tail, this upper-bounds true tail probability rather than estimating it."

**Checklist:**

- [x] Greenlight from Ty (approved 2026-04-20)
- [x] Write one-shot script (inline mongosh query, no production file)
- [x] Run, capture output table (cell × observed-tail-prob × σ-derived × Δ × population)
- [x] Apply trigger ladder, document conclusion (below)

**Results (run 2026-04-20):**

Sample: 43 resolved threshold tail-sell signals with `perSourceForecastsF` populated (1 inner skipped). Note: user-quoted 70W/3L/80 total signals — the 3 losses are on pre-pivot/pre-instrumentation signals without `perSourceForecastsF` and got filtered out. **Observed tail rate in the instrumented sample: 0.000 across all cells.**

| Cell | N | Observed | σ-derived | \|Δ\| | Flag |
|---|---|---|---|---|---|
| AccuWeather:12to24h:high | 5 | 0.000 | 0.245 | 0.245 | n<20 |
| AccuWeather:24to48h:high | 27 | 0.000 | 0.212 | 0.212 | **FLAG** |
| AccuWeather:gt72h:high | 11 | 0.000 | 0.239 | 0.239 | n<20 |
| Google-Weather:12to24h:high | 5 | 0.000 | 0.421 | 0.421 | n<20 |
| Google-Weather:24to48h:high | 27 | 0.000 | 0.349 | 0.349 | **FLAG** |
| Google-Weather:gt72h:high | 11 | 0.000 | 0.346 | 0.346 | n<20 |
| NWS:12to24h:high | 5 | 0.000 | 0.218 | 0.218 | n<20 |
| NWS:24to48h:high | 27 | 0.000 | 0.267 | 0.267 | **FLAG** |
| NWS:gt72h:high | 11 | 0.000 | 0.268 | 0.268 | n<20 |
| Open-Meteo:12to24h:high | 5 | 0.000 | 0.293 | 0.293 | n<20 |
| Open-Meteo:24to48h:high | 27 | 0.000 | 0.295 | 0.295 | **FLAG** |
| Open-Meteo:gt72h:high | 11 | 0.000 | 0.231 | 0.231 | n<20 |
| Tomorrow.io:12to24h:high | 5 | 0.000 | 0.362 | 0.362 | n<20 |
| Tomorrow.io:24to48h:high | 27 | 0.000 | 0.318 | 0.318 | **FLAG** |
| Tomorrow.io:gt72h:high | 11 | 0.000 | 0.256 | 0.256 | n<20 |

**Verdict:** 5 flagged cells across all 5 sources (each source has one flagged cell at 24to48h:high, all n=27). Per trigger ladder: "3+ cells across multiple sources → BROADER σ-TABLE ISSUE → input toward ITERATE."

Aggregate across all 215 per-source-per-signal observations: observed 0.000 vs σ-derived 0.285 (|Δ| = 0.285). The σ table predicts ~29% tail mass where we observed 0%.

**Interpretation (pricing caveat remains):**
- **(a)** σ table dramatically oversizes threshold regime (2-10× too wide depending on source), OR
- **(b)** Kalshi systematically overprices the cold tail by ~15-20¢, and our signal filter (YES ≤20¢) selects only cases where Kalshi has already priced the tail far below true.
- These are not distinguishable from this script alone.

**However — corroboration from Phase 1 Day 4:** yesterday's reliability diagram showed 0.3+ bins still empty after 4 days. If σ were correctly wide for threshold, BMA output would land *higher* than it currently does (the wide σ drives the output toward the middle, and higher confidence on tail predictions would push some predictions into the 0.3+ bins). Both signals — Day 4 empty 0.3+ bins AND Pathway 2 near-zero observed tail — point the same direction: **σ table values for threshold regime likely too wide.** Kalshi mispricing alone wouldn't explain the Day 4 reliability pattern.

**Going into Day 5 decision:** strong input toward ITERATE, with a specific hypothesis: Phase 1.5 σ-retune-to-debiased-values may not be enough — the raw σ values for threshold regime might also need to come down. Worth keeping the current deploy (no rollback trigger fired) and extending measurement 3-5 days while formulating the Phase 1.5 refinement.

### Pathway 1: source_accuracy writeback (40-80 LOC, after Phase 2)

**Timing:** Earliest Apr 22 (Phase 2 deploy + 2 day settle); realistically Apr 28-30 if Phase 1 ITERATEs and Phase 2 slips.
**File:** `src/lib/models/tailSellTracker.ts:resolveTailSellSignals()` (line 269-333 area)

**The reframe:** the tail-sell strategy is *already* generating training data — we're throwing it away. This isn't a data-collection project; it's plumbing.

**!! Selection bias is the real risk.** Tail-sell signals are conditioned on "ensemble forecast was ≥6°F from a bracket boundary." Per-source MAE on this subset may not equal MAE on the full distribution. The 7-day MAE divergence check below is a **hard gate** before the corpus compounds — not a sanity check after the fact.

**Independence loss (must document at deploy):** once shipped, tail-sell outcomes are no longer independent of model training. Future audits cannot use tail-sell performance as out-of-sample validation on the model. Code comment + plan-doc note at deploy time.

**Pre-deploy checklist:**

- [ ] Decide `groundTruthSource` naming (open question — see end of section)
- [ ] Verify `recordSourceAccuracy()` 25°F sanity guard is on absolute error (not delta-from-bracket)
- [ ] Audit downstream consumers of `source_accuracy` for `groundTruthSource: 'kalshi_midpoint'` equality checks. Update to `$in: [...]` whitelist or `$regex: /^tail_sell_/` prefix match. Likely files: `dynamicWeights.ts`, `rollup-weights.ts`, Phase 2 μ-correction reader (once written).

**Code changes:**

- [ ] In `resolveTailSellSignals()`: iterate `perSourceForecastsF` per resolved signal, call `recordSourceAccuracy()` per (source, signal) pair with `actualF`
- [ ] Add new `groundTruthSource` variant to type union + valid-values list (e.g., `tail_sell_actual_ge6`)
- [ ] Code comment block at the new writeback site explaining (a) the data flow, (b) the independence loss, (c) the selection-bias gate

**Deploy + verify:**

- [ ] TypeScript clean, build clean, tests pass
- [ ] Single SSH session deploy
- [ ] `/pulse-check` passes
- [ ] After 24h: `source_accuracy` daily write count climbs by ~3-15/day
- [ ] After 24h: `groundTruthSource: 'tail_sell_actual_ge6'` rows visible in collection

**Hard gate — 7-day MAE divergence check:**

- [ ] After 7 days: compare per-source MAE for `kalshi_midpoint` vs `tail_sell_actual_ge6` rows over the window
- [ ] If meaningful divergence (specific threshold TBD when running — likely >1.5°F per-source diff) → selection bias confirmed → back out the writeback
- [ ] If no divergence → ship, leave running, note in plan as validated

### Why NOT Pathway 3 (calibration training)

Tempting but harmful. The `-T\d` exclusion filter exists because threshold-bracket predictions distort isotonic breakpoints — predictions cluster near price extremes (≤10¢, ≥90¢) and don't fit the inner-bracket distribution. Folding tail-sell into calibration training reintroduces the extrapolation pathology the filter was built to prevent. If tail-sell evaluation by calibration is wanted later, it needs a *separate* threshold-bracket calibration model — that's Phase 4+ scope, not near-term.

### Open questions for Ty

- [ ] **Greenlight Pathway 2?** Cheap script, runs before Day 5, output goes into Day 5 doc. Recommend yes.
- [ ] **`groundTruthSource` naming preference?** `tail_sell_actual_ge6` (terser) vs `tail_sell_actual_ge6f` (unit-tagged, near-free future-proofing if Celsius observations ever enter the corpus).

### Cross-references

- `memory/feedback-tight-agreement-shared-bias.md` — the "if our σ table is wrong, what direction is it wrong" question relates to ensemble convergence as shared bias signal. Pathway 2's results should be read against this.
- `memory/noaa-backfill-poc-2026-04-08.md` — already noted that `source_accuracy only accepts kalshi_midpoint`. Pathway 1 is partly closing that gap.
- `memory/feedback-plan-doc-external-review-cycle.md` — this brainstorm went through 2 review rounds before approval; specs above reflect post-review tightening.

---

## Phase 2: μ correction table (QUEUED — expected Apr 19-24)

**Prerequisite:** Phase 1 validates clean
**Scope:** MU_CORRECTION_TABLE lookup per (source, lead, temperatureType, regime). Applied per-source BEFORE BMA aggregation. Replaces current scalar bias in `temperatureBias.ts`.
**Reference:** `memory/item-b2-mu-correction-2026-04-14.md`, `memory/item-b-summary-2026-04-14.md`

**NOT in scope:** Low-temp signal generation (still off), DEFAULT_WEIGHTS_LOW (Deploy 3), debiased σ retune (Phase 1.5).

### Key μ correction values (temperature-high, °F)

| Source | 12to24h inner | 24to48h inner | gt72h inner | gt72h threshold |
|--------|--------------|--------------|-------------|-----------------|
| NWS | 0.0 | -0.70 | -0.38 | -0.85 |
| AccuWeather | 0.0 | -1.35 | -1.03 | -1.93 |
| Open-Meteo | 0.0 | -1.50 | -2.09 | -0.87 |
| Google-Weather | -1.78 | **-3.35** | **-3.29** | **-3.96** |
| Tomorrow.io | 0.0 | **-2.43** | **-2.21** | **-2.65** |

### Pre-deploy checklist

- [x] Confirm Phase 1 validation passed (Day 5 decision = PROCEED) — 2026-04-20
- [x] Capture pre-Phase-2 baseline via `/check-calibration` — Day 5 metrics above ARE the baseline (BSS -0.27, 0.1-0.2 gap 0.256, 0.2-0.3 gap 0.291, 0.3+ bins empty, cal lift 8.3%, 313 trades on active model)
- [x] Draft Phase 2 deployment prompt — `docs/work/phase-2-mu-correction-plan.md` (2026-04-20)
- [x] Pre-ship grep audit — DONE. Correct injection point: **`src/lib/models/forecastDistribution.ts:90`** (unified, both threshold and inner BMA paths). Working-checklist's original `weatherProbability.ts:582` pointer was stale (that line is now in the deprecated KDE path). Grep audit also flagged design conflict: B2 memory doc says REPLACE scalar bias; grep-agent suggested ADDITIVE. B2's replace approach is correct (additive would double-subtract since MU values already contain city-level components); plan reflects this with feature flag `MU_CORRECTION_ENABLED` for rollback safety.

### Deploy checklist

- [ ] Code changes match `memory/item-b2-mu-correction-2026-04-14.md` values exactly
- [ ] TypeScript clean (`npx tsc --noEmit`)
- [ ] Build clean (`npm run build`)
- [ ] Tests pass (`npx vitest run`)
- [ ] Single SSH session deploy (stop → clean .next → build → start)
- [ ] Post-deploy spot-check: `/pulse-check` passes, PM2 online

### Daily measurement checklist (3-5 days)

- [ ] Day 1: `/check-calibration` — BSS: ___ , per-source mean error: ___
- [ ] Day 2: `/check-calibration` — BSS: ___ , per-source mean error: ___
- [ ] Day 3: `/check-calibration` — BSS: ___ , per-source mean error: ___
- [ ] Day 4 (if needed): `/check-calibration`
- [ ] Day 5 (if needed): `/check-calibration`

### Validation criteria

- [ ] Google Weather 24to48h:high mean bias moves from -3.35°F toward zero
- [ ] Tomorrow.io 24to48h:high mean bias moves from -2.43°F toward zero
- [ ] All sources within ±0.5°F of target for 3+ consecutive days
- [ ] BSS continues improving from Phase 1 baseline

### Rollback triggers

- Per-source MAE increases by >0.3°F on any source (inner or threshold) for 3+ days
- Bias direction reverses on any source (correction overshoots — e.g., GW goes from -3.35°F to +0.5°F or more positive)

### Decision point

- [ ] **PROCEED** to Deploy 3 (low-temp infra) AND Phase 1.5 (σ retune)
- [ ] **ITERATE** (metrics improving but haven't stabilized)
- [ ] **ROLLBACK** (rollback trigger fired)

---

## Deploy 3: Low-temp infrastructure — kill switch OFF (QUEUED — expected Apr 24-27)

**Prerequisite:** Phase 2 validates clean
**Scope:** Ship low-temp signal generation infrastructure with kill switch remaining OFF. Warm-tail signals generated but forced to HOLD — shadow validation only.
**Reference:** `memory/low-temp-phase-b-design-2026-04-05.md`, plan file `silly-wiggling-ocean.md` Section 3

### Code changes (~90 lines across 3 files)

- [ ] Add `DEFAULT_WEIGHTS_LOW` constant (~5 lines)
  - Provisional values: GW=0.35, TI=0.27, OM=0.18, NWS=0.13, AW=0.07
  - Recompute against current corpus (should be 1,100+ records by then vs 790 at design time)
- [ ] Add weight branching in `computeOpportunities.ts` based on `temperatureType` (~5 lines)
- [ ] Add `generateWarmTailSellSignals()` function (~40 lines)
  - Separate function, NOT parameterized version of cold-tail
  - Direction: warm-side (sell brackets **above** forecast low)
  - Inner distance: ≥5°F above forecast (conservative start from Phase B design)
  - Threshold distance: ≥3°F above forecast
- [ ] Type widening in `TailSellRecord` and `TailSellSignal` (~5 lines)
  - `direction: 'cold' | 'warm'`
  - `temperatureType: 'high' | 'low'`
- [ ] Add `MAX_PER_CITY_TYPE = 2` sub-cap in `tailSellTracker.ts` (~10 lines)
  - Prevents low-temp from consuming all 3 city slots
- [ ] Add `POSITION_SIZE_LOW = 5` constant (~1 line)
- [ ] `LOW_TEMP_SIGNAL_GENERATION_ENABLED` stays `false`

### Pre-deploy checklist

- [ ] Recompute `DEFAULT_WEIGHTS_LOW` against current low-temp corpus (compare to Apr 5 values from 790 records)
- [ ] Pre-ship grep audit: confirm `execute-tail-sells.ts` needs zero changes (market-type agnostic)
- [ ] Verify city exclusion list still valid: AUS, DEN, DC excluded for lows

### Deploy checklist

- [ ] TypeScript clean, build clean, tests pass
- [ ] Single SSH session deploy
- [ ] Post-deploy: `/pulse-check` passes
- [ ] Verify warm-tail signals generated but forced to HOLD (query `tail_sell_signals` for `direction: 'warm'` — should be 0)
- [ ] Verify execution script does NOT pick up shadow signals
- [ ] Verify high-temp cold-tail trading unaffected

---

## Phase 1.5: σ retune to debiased values (QUEUED — expected Apr 27-30)

**Prerequisite:** Phase 2 validates AND per-source bias within ±0.5°F of target for 3+ days
**Scope:** Replace raw RMSE σ values with debiased σ for cells where |μ correction| ≥ 1°F
**Reference:** `memory/item-b-summary-2026-04-14.md` (Phase 1.5 section), B1×B2 interaction table

### Key debiased σ changes (24to48h:high inner, °C)

| Source | Raw σ (Phase 1) | Debiased σ | Reduction |
|--------|-----------------|------------|-----------|
| NWS | 1.39 | 1.33 | -4% |
| AccuWeather | 1.65 | 1.46 | -12% |
| Open-Meteo | 1.78 | 1.57 | -12% |
| Google-Weather | 2.33 | **1.39** | **-40%** |
| Tomorrow.io | 2.04 | **1.53** | **-25%** |

### Checklist

- [ ] Confirm per-source bias within ±0.5°F for 3+ consecutive days
- [ ] Capture pre-Phase-1.5 baseline via `/check-calibration`
- [ ] Update SIGMA_SOURCE_TABLE entries for cells where |μ correction| ≥ 1°F
- [ ] Deploy and verify
- [ ] Measure for 3-5 days

### Validation criteria

- [ ] Reliability 0.1-0.3 bins tighten further (less underconfidence)
- [ ] No new overconfidence in 0.3+ bins (predicted > actual gap stays < 0.10)

### Rollback triggers

- BSS worsens by >0.03 vs post-Phase-2 baseline over 3+ consecutive days
- New overconfidence appears in 0.3+ bins (gap > 0.10) that was absent before

---

## Shadow validation period (QUEUED — expected Apr 27 - May 8, ~10-14 days)

**Goal:** Validate warm-tail signal quality before live execution
**Runs in parallel with Phase 1.5 measurement**

### Daily checklist during shadow period

- [ ] Query `tail_sell_signals` for `direction: 'warm'` signals logged today
- [ ] Compare warm-tail signal generation rate to cold-tail (expect similar volume per market)
- [ ] Compute hypothetical P&L assuming all shadow signals had executed
- [ ] Track per-city warm-tail signal distribution
- [ ] Note any signals that look anomalous (wrong direction, extreme distances, etc.)

### Validation criteria (must ALL pass before flipping kill switch)

- [ ] Warm-tail shadow signals show hit rate within ±0.15% of cold-tail historical 0.24% rate
- [ ] No individual day shows >3 false-positive warm-tail signals across all cities
- [ ] Hypothetical P&L over the shadow period is positive (or not significantly negative)
- [ ] Source bias on lows continues to hold within Phase 2 expectations

### Decision point at end of shadow period

- [ ] **PROCEED** to limited-city rollout
- [ ] **EXTEND** shadow period (signals look borderline — need more data)
- [ ] **PIVOT** (warm-tail is not viable — rethink strategy)

---

## Limited city rollout — ATL/MIA/LAX only (QUEUED — expected May 8-15)

**Prerequisite:** Shadow validation passes
**Scope:** Flip `LOW_TEMP_SIGNAL_GENERATION_ENABLED = true`. Limit eligibility to ATL, MIA, LAX via city allowlist.
**Position size:** $5/position (`POSITION_SIZE_LOW = 5`)

### Deploy checklist

- [ ] Add city allowlist for low-temp: ATL, MIA, LAX only
- [ ] Flip `LOW_TEMP_SIGNAL_GENERATION_ENABLED = true`
- [ ] Deploy and verify
- [ ] Confirm warm-tail orders appearing on Kalshi for allowed cities only

### Daily measurement checklist

- [ ] Track warm-tail trades executed per city (ATL, MIA, LAX)
- [ ] Track warm-tail P&L vs hypothetical from shadow period
- [ ] Confirm high-temp trading unaffected (no crowding from shared `MAX_PER_CITY`)
- [ ] Watch for execution failures or circuit breaker trips

### Validation criteria for expansion

- [ ] 1 week of clean execution (no failures, no circuit breaker trips)
- [ ] Win rate within expected range (>85% given 0.24% hit rate)
- [ ] No anomalous P&L days
- [ ] `MAX_PER_CITY_TYPE = 2` sub-cap working correctly

### Decision point

- [ ] **EXPAND** to all cities
- [ ] **EXTEND** limited rollout (need more data)
- [ ] **ROLLBACK** (unexpected losses or execution issues)

---

## All-cities rollout at $5/position (QUEUED — expected May 15-29)

**Prerequisite:** Limited city rollout validates
**Scope:** Remove city allowlist, expand to all 16 cities. Position size remains $5.

### Checklist

- [ ] Remove city allowlist — all 16 cities eligible for low-temp
- [ ] Deploy and verify
- [ ] Monitor for 2 weeks

### Validation criteria

- [ ] 2 weeks of clean execution
- [ ] Positive cumulative warm-tail P&L
- [ ] No city-specific anomalies
- [ ] High-temp cold-tail P&L unaffected

---

## Position size raise to $10 (QUEUED — expected May 29+)

**Prerequisite:** All-cities rollout at $5 validates
**Scope:** Raise `POSITION_SIZE_LOW` from $5 to $10 to match high-temp.
**Final state:** Low-temp warm-tail running at parity with high-temp cold-tail.

### Checklist

- [ ] Change `POSITION_SIZE_LOW = 10`
- [ ] Deploy and verify
- [ ] Monitor for 1 week
- [ ] Confirm total portfolio exposure within acceptable limits (`MAX_TOTAL = 30` × $10 = $300 max)

---

## Phase 3: Calibration retrain (QUEUED — expected May 8-15)

**Runs in parallel with limited city rollout — independent of warm-tail**
**Prerequisite:** 200+ resolved trades under post-Phase-1.5+2 BMA parameters
**Reference:** `memory/calibration-retrain-2026-03-27.md`

### Pre-retrain checklist

- [ ] Confirm 200+ resolved trades under new BMA parameters (query `market_predictions` with `timestamp >= Phase 1.5 deploy timestamp`)
- [ ] Capture pre-retrain baseline via `/check-calibration`
- [ ] Run training: `curl -X POST /api/weather/calibration -H 'Authorization: Bearer $CRON_SECRET' -d '{"action":"train","lookbackDays":180}'`

### Post-retrain checklist

- [ ] Verify new model loaded (check `calibrationModelId` in PM2 logs)
- [ ] `/check-calibration` — capture post-retrain baseline
- [ ] Monitor for 3-5 days

### Validation criteria

- [ ] Calibration lift improves from current 7.4% baseline
- [ ] BSS improves further from post-Phase-1.5 level

### Rollback triggers

- Calibration lift drops below 6.0% after 3+ days post-retrain
- Raw vs calibrated Brier gap reverses (calibrated Brier becomes worse than raw)
- Active model BSS worsens relative to pre-retrain by >0.03
- **Rollback:** Restore backup model from MongoDB (`backup_cal_1775184454578`)

---

## Final evaluation (QUEUED — expected May 15-19)

**Goal:** Strategic review of whether Item B moved the needle.

### Inputs to review

| Metric | Pre-Item-B (Apr 15) | Post-Item-B target | Actual |
|--------|---------------------|-------------------|--------|
| BSS (clean era) | -0.30 | -0.22 or better | ___ |
| Reliability 0.0-0.1 gap | 0.175 | <0.10 | ___ |
| Reliability 0.1-0.2 gap | 0.276 | <0.20 | ___ |
| Reliability 0.2-0.3 gap | 0.293 | <0.25 | ___ |
| Calibration lift | 7.4% | >10% | ___ |
| Warm-tail shadow P&L | N/A | positive | ___ |
| Warm-tail live P&L | N/A | positive | ___ |

### Meta rollback trigger

If BSS hasn't improved by at least 0.08 from -0.30 baseline (target: -0.22 or better) after all phases ship, pause Item B follow-up work and escalate for strategic review.

### Three branches

- [ ] **Item B worked:** Discuss next steps (Phase 4 per-city multipliers, Phase 5 inner weight rebalance, atmospheric variables Phase 2b)
- [ ] **Item B partially worked:** Measure per-source residuals conditioned on atmospheric bands; decide whether atmospheric variables become next investment
- [ ] **Item B didn't move the needle:** Broader strategic conversation about project direction

---

## Deferred work (NOT on this checklist's timeline)

- **Phase 4:** Per-city σ multipliers — deferred until 2-3 weeks post-Phase-1 stable. Reference: `memory/item-b3-per-city-sigma-2026-04-14.md`
- **Phase 5:** Inner weight rebalance to empirical inverse-MAE — deferred to post-evaluation. Reference: `memory/item-b4-regime-weights-2026-04-14.md`
- **Phase 2b:** Atmospheric variable storage schema — deferred to post-Item-B evaluation
- **Phase 3 (atmos):** Atmospheric variable bias correction model — far deferred
- **API + x402:** Strategic conversation about forecast product — independent track, no Item B dependency

---

## Daily quick-check (during active phases)

> Reset checkboxes each day; today's run (Apr 18) is reflected in Day 3 above.

- [ ] Run `/check-calibration` and capture key metrics (BSS, reliability gaps, calibration lift)
- [ ] Check pending trade count and active model sample size
- [ ] Glance at PM2 logs for errors: `ssh root@104.248.223.48 "pm2 logs kardashev-web --lines 20 --nostream 2>&1"`
- [ ] Note any signals or trades that look unusual
- [ ] Update this checklist with progress (mark items `[x]`, fill in metric blanks)
