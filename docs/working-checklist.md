# Working Checklist — Item B Coordinated Refit + Low-Temp Warm-Tail Rollout

**Created:** 2026-04-15
**Last updated:** 2026-05-02
**2026-07-21:** Tail-sell ledger backfilled (125 phantom unfilled-order rows, all pre-outage cold/high, pnl → $0; real-dollar `pnl × filledCount` view unchanged at +$96.27); `getTailSellSummary` + daily-loss circuit breaker now compute filled-contract dollars via `realizedPnlDollars`.
**2026-07-22 (Item 1):** Per-city HIGH sizing replaces flat $20 (`resolvePositionSize` in `tailSellTracker.ts`): KEEP $20 CHI/HOU/SF/NY/LV, TRIM $15 AUS/DAL/PHX/ATL/DEN, TRIM $10 LA/BOS/DC/MIA, default $15. All ≤ prior $20; LOW ($5) and warm/high ($20) untouched. Effective size logged at placement.
**2026-07-22 (Item 2):** Cap/circuit-breaker suppressions now persisted to `suppression_events` (was a silent `continue`) — makes MAX_TOTAL foregone-EV measurable. Non-blocking best-effort write; trading path unchanged.
**2026-07-22 (Item 3):** `kalshi_market_snapshots` extended with far-tail book depth (`restDepth`, `restDepthPM2`, `depthLevelYes`, `depthStatus`) for tail brackets only (yesAsk 0.03–0.18); additive fields, 30-min cadence unchanged (~200–320 orderbook GETs/run, batched).
**2026-07-22 (Item 4):** Warm-low stop monitor wired (`scripts/check-warmlow-stops.ts`, daily PM2 cron `kardashev-warmlow-stops`): logs cumulative realized P&L + Wilson 95% win-rate upper bound, Telegram-alerts on breach (P&L ≤ −$35 or Wilson upper < 92%). Read-only; alerts only, never auto-flips. Current: −$17.12 / 92.8% (both OK).
**Current phase:** Phase 2 ITERATE measurement (Day 6 of 8-10 day window). **Paper trading verified working** (May 2): 23 paper signals total, 13 resolved at **12W/1L = 92.3% win rate** + $2.20 hypothetical P&L, zero anomalies. **CRITICAL FINDING (May 2 heat-check `/audit-brier`):** inner-bracket signal pipeline has been silent since 2026-04-26 08:01 UTC — zero new `signals` / `market_predictions` rows in 6 days. Tail-sell + paper-warm-tail flow normally on separate paths; only the probability-model inner-bracket emission is frozen. Two structural causes: (1) YES_SIGNALS_ENABLED=false moratorium blocks all YES-side opps (even today's 65.6%-edge case), (2) May warm-weather regime → tight bracket distributions → NO-side edges below `minEdge=0.15`. Implication: **May 4-5 audit-brier will read same numbers as today** unless we lift the moratorium or market regime shifts. Post-Phase-2 corpus stuck at n=63 (BSS -0.385). Next `/audit-brier` checkpoint still scheduled May 4-5 but now informational rather than decisive.

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
| Tail-sell → recalibration: Pathway 2 (σ check, Day 5 input) | Apr 20 (before Day 5) | **DONE** (Apr 20 — fed Day 5 ITERATE input) |
| Phase 2: μ correction table | Apr 20-24 | **DEPLOYED** (commit `8886f1f`, 2026-04-20) |
| Inner-bracket viability monitoring | Apr 21 - mid-May (extended) | **ACTIVE** — REFRAMED 2026-04-24 due to 20-30¢ regime absence |
| Tail-sell position size raise ($10 → $20) | Deployed 2026-04-25 commit `9a93eb1` | **LIVE** — first $20 signal MIA 14:00 UTC |
| Fade-the-tail mass-concentration — Phase A snapshot capture | Deployed 2026-04-24 | **LIVE** — capturing every 30 min, ~3K rows/day |
| Tech debt cleanup (audit complete 2026-04-24) | Apr 25-27 + post-Phase-2 | **DONE** (Apr 25-26) — see section below |
| Sweet Spot gate refresh build | Apr 26 | **DEPLOYED** (commit `b00c960`, Apr 26) |
| `/audit-brier` Apr 27 checkpoint | Apr 27 (run early Apr 26) | **DONE** — see Phase 2 Decision point below; ITERATE selected |
| Deploy 3: Low-temp infrastructure (kill switch OFF) | Apr 27-29 | **DEPLOYED** (commit `88beab7`, Apr 27) — kill switch OFF, dormant infra; cold-tail unaffected |
| Tail-sell `actualF` bound-on-loss fix + backfill | Apr 29 | **DEPLOYED** (commit `ccf6afd`, Apr 29) — 7 historical loss records backfilled to `actualFKind: 'le'` |
| Warm-tail paper-trading infrastructure | Apr 29 | **DEPLOYED** (commit `731e0b9`, Apr 29) — tri-state `LOW_TEMP_WARM_TAIL_MODE`, `mode` field on records, paper P&L on resolution, dedicated UI section. |
| Daily P&L Calendar (audit-trail filter) | Apr 29 | **DEPLOYED** (commit `1895fab`, Apr 29) — 14-day click-to-filter strip above live + paper audit trails. |
| Warm-tail paper-mode flip | Apr 29 evening | **LIVE** — `LOW_TEMP_WARM_TAIL_MODE=paper` set on droplet; first 8 paper signals captured Apr 30 (HOU/DAL/SF/MIA/AUS/CHI/NY low-temp events). |
| First-10-paper-trades verification | May 2 | **DONE** — 23 paper signals total, 13 resolved (12W/1L = 92.3% win rate, +$2.20 hypothetical P&L). Zero anomalies. All resolved have `actualF` + `actualFKind` populated (12 'exact' + 1 'ge'). System working as designed. |
| Paper pipeline fixes (Date column + cap) | Apr 30 | **DEPLOYED** (Apr 30) — audit-table Date column now shows event date (was log timestamp in local TZ → confusing); `MAX_TOTAL_PAPER=30` (was 8) prevents resolution-overlap blackouts. |
| 12-20¢ YES band watch item | Apr 29 finding | **WATCH** — see section below; needs +5-10 resolutions in band |
| `/audit-brier` ITERATE re-check | May 4-5 | Queued — 10 days post-ITERATE decision |
| BMA deprecation (deletion phase) | ~2026-06-04 onward | Queued — see BMA deprecation tracker section below |

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

### Pathway 1: source_accuracy writeback — SUPERSEDED 2026-05-04

Was queued post-Phase-2 to feed dynamic weights and μ-correction with tail-sell-derived per-source residuals. Both downstream consumers (dynamic weights, μ-correction) are part of BMA — now in maintenance-only mode per `memory/bma-deprecation-decision-2026-05-04.md`. Plumbing this would have added training data to a system slated for deletion. Not pursuing.

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
- [x] Draft Phase 2 deployment prompt — `docs/archive/phase-2-mu-correction-plan.md` (2026-04-20)
- [x] Pre-ship grep audit — DONE. Correct injection point: **`src/lib/models/forecastDistribution.ts:90`** (unified, both threshold and inner BMA paths). Working-checklist's original `weatherProbability.ts:582` pointer was stale (that line is now in the deprecated KDE path). Grep audit also flagged design conflict: B2 memory doc says REPLACE scalar bias; grep-agent suggested ADDITIVE. B2's replace approach is correct (additive would double-subtract since MU values already contain city-level components); plan reflects this with feature flag `MU_CORRECTION_ENABLED` for rollback safety.

### Deploy checklist — DONE 2026-04-20

- [x] Code changes match `memory/item-b2-mu-correction-2026-04-14.md` values exactly (verified table-by-table during implementation)
- [x] TypeScript clean (`npx tsc --noEmit`) — clean for in-scope files
- [x] Build clean (`npm run build`) — local + droplet ✓
- [x] Tests pass — 6 pre-existing failures remain (bias/calibration/resolve-markets/weights/temperatureBias/weatherProbability base-rate-blending), none related to μ correction. forecastDistribution suite (56 tests) all pass with `MU_CORRECTION_ENABLED=false` set in `vitest.config.ts`
- [x] Single SSH session deploy — required cold reinstall of node_modules per `/deploy` skill recovery section (lockfile-patch failure pattern, second occurrence). Build then succeeded; PM2 online (PID 806738)
- [x] Post-deploy spot-check: `/dashboard` and `/weather-forecast` HTTP 200 sub-50ms; PM2 logs clean (`✓ Ready in 991ms`, warmup started for 16 cities, no errors in current process)

### Daily measurement checklist (3-5 days)

- [x] Day 1 (Apr 21): `/check-calibration` — BSS -0.27 (active model, 315 trades, +2 since Day 5 baseline). Reliability gaps unchanged (0.1-0.2: 0.255, 0.2-0.3: 0.294). 0.3+ bins still empty. Cal lift 8.3%. Pending 16. **Per-source n is very thin** post-deploy (75 source_accuracy rows total across 5 sources × 3 lead buckets; most cells n=0 or n=2). System healthy, no rollback triggers fired. See Day 1 notes below.
- [x] Day 2 (Apr 22): `/check-calibration` — BSS **-0.26** (active model, 318 trades, +3 since Day 1, +0.01 vs Day 5 baseline). Reliability gaps essentially unchanged (0.0-0.1: 0.174, 0.1-0.2: 0.252, 0.2-0.3: 0.291). 0.3+ bins still empty (Day 7 streak). Cal lift 8.3%. Pending 17. **Per-source bias metric ruled NON-DIAGNOSTIC for Phase 2 validation** — writeback records raw forecasts (see Day 2 notes). Drop from daily flow; rely on BSS + reliability bins.
- [x] Day 3 (Apr 23): `/check-calibration` — BSS **-0.27** (active model, 321 trades, +3 since Day 2, reverted Day 2's +0.01 win). Reliability gaps unchanged (0.0-0.1: 0.174, 0.1-0.2: 0.257 drift +0.005, 0.2-0.3: 0.291). 0.3+ bins still empty (Day 8 streak). Cal lift 8.3%. **Pending doubled 17 → 36 overnight** — decisive measurement signal arrives Days 4-5 as these resolve.
- [x] Day 4 (Apr 24): `/check-calibration` — BSS **-0.27** (active model, 343 trades, +22 resolutions since Day 3 — sample finally accumulating). Mixed gap signals: 0.1-0.2 **0.249** (first sub-0.250 in window, -0.008 vs Day 3) but 0.2-0.3 **0.316** (worsened +0.025 vs Day 3 — same pattern as Phase 1 Day 3 which recovered by Day 5). 0.3+ bins still empty (Day 9 streak). Cal lift 8.6% (+0.3pp). Pending 42 (was 36 — 22 resolved + 28 new). No rollback signals — see Day 4 notes below.
- [x] Day 5 (Apr 25): `/check-calibration` — BSS **-0.27** (active model, 364 trades, +21 since Day 4). 0.1-0.2 **0.244** (-0.005 vs Day 4, continued slow improvement, now 4 days under 0.250). 0.2-0.3 **0.315** (essentially flat from Day 4's 0.316 — did NOT recover toward 0.291 baseline as the Phase 1 pattern predicted). 0.3+ bins still empty (Day 10 streak from Phase 1 baseline). Cal lift **8.8%** (+0.2pp vs Day 4). Pending **21** (was 42 — overnight resolution surge). Routing 100% on active model. No rollback signals. See Day 5 notes below.

### Day 1 notes (Apr 21, ~24h post-deploy)

- **No rollback signals.** No metric worsened beyond noise. Signal generation continues (latest unresolved Apr 21 07:01 SFO).
- **Per-source bias windowed Apr 15-20 (pre-Phase-2) vs Apr 20-21 (post):** sample sizes way too small to draw conclusions on the 24to48h cells (n=2 each). gt72h cells have n=13 each post-deploy. No clean trend yet.
- **Two yellow flags to watch over Days 2-3:**
  - **Open-Meteo 24to48h drifted -3.34°F worse** (pre-Phase-2 mean -3.03 → post -6.36, n=2). Likely noise from 2 unusual data points; if it persists across 3+ days at n>10, would trigger rollback condition.
  - **GW + TI 24to48h not yet trending toward zero** (changed by +0.39 and -0.18 °F respectively, both n=2). Phase 2's whole point was to push these toward zero; need 3-7 more days of resolution data to know if it's working.
- **Pre-Phase-2 5-day window had higher per-source bias than B2's long-run baseline on most sources** (e.g., GW 24to48h was -5.32°F in Apr 15-20 window vs -3.35°F in B2 corpus). Means the comparison "post-Phase-2 bias vs B2 baseline" is muddled — the immediate pre-deploy window was already an unusual period. Decision: report against pre-Phase-2 5-day window (window-A baseline) AS WELL AS the B2 long-run when both windows have enough data.
- **0.3+ reliability bins remain empty** (Day 6 of streak now). If μ correction is going to push predictions higher, the signal would land here first as new trades resolve.
- **Calibration metrics unchanged from Day 5** because only 2 new trades resolved overnight, and those were generated under the new μ-corrected forecasts but represent <1% of the 313-trade corpus. The decisive shift in BSS lands as the cumulative new-prediction count crosses ~30-50.

### Day 2 notes (Apr 22, ~48h post-deploy)

- **No rollback signals.** Active-model BSS moved -0.27 → -0.26 (+0.01); 0.0-0.3 reliability gaps within noise of Day 1; routing healthy (47 of 50 last-7d predictions on active model, no stale IDs). Pending 17 (up 1).
- **Sample growth still slow.** Only 3 new active-model trades resolved overnight (315 → 318); per-source corpus added ~200 rows overnight (75 → 275 total post-Phase-2) but most growth is gt72h:high cells (n=26 each). 24to48h:high cells stuck at n=5 each — too thin to call.
- **0.3+ bin streak now Day 7.** If μ correction is going to push predictions higher into those bins, it hasn't manifested in 48h. Decisive signal still expected by Days 3-5 once cumulative new-prediction count crosses ~30-50.
- **Writeback semantics finding (Day 2 verification):** `extractPerSourceTemps` (`src/lib/utils/dailyForecasts.ts:274-317`) reads `f.temperature.max/min` directly from each source — no μ correction applied at the capture layer. The μ correction lives inside `forecastDistribution.ts:108-109`, downstream of source_accuracy entirely. **Verdict:** `source_accuracy` records **raw** forecasts. Per-source bias is NOT diagnostic for Phase 2 validation — biases there will stay roughly constant regardless of whether Phase 2 is on or off. (Good design — prevents feedback loop in the μ-correction corpus.) Day 1's "GW + TI 24to48h not yet trending toward zero" yellow flag was a category error and is now retracted.
- **Implication for daily flow:** drop the per-source bias query from the daily Phase 2 measurement. Phase 2 validation rests on BSS + reliability bins (0.1-0.3 gap shrinkage + 0.3+ bins populating) only. Phase 2 rollback triggers (per-source MAE +0.3°F for 3 days, bias direction reverses) **also need rethinking** — they assume corrected forecasts are recorded. They're effectively unreachable now. See `validation criteria` and `rollback triggers` sections below — both are updated to reflect this.

### Day 3 notes (Apr 23, ~72h post-deploy)

- **No rollback signals.** BSS -0.27 still well above -0.32 trigger; gaps stable; routing healthy (51 active model / 3 none in 7d post-retrain).
- **Day 2's +0.01 BSS bump reverted.** Active model trades only +8 cumulative since baseline (313 → 321) — sample is the bottleneck, not the parameters.
- **Pending doubled overnight: 17 → 36.** This is the most informative observation today — the next two days finally have meaningful new sample to land. If those resolutions don't move the needle, Phase 2 + Phase 1 combined haven't found the gap.
- **0.3+ empty-bin streak now Day 8.** Counted from Phase 1 Day 0 baseline (Apr 15) where the σ refit was specifically expected to start populating those bins. Phase 2's μ correction is the second lever expected to push predictions higher; if Days 4-5 don't show movement, the Apr 27 `/audit-brier` becomes the critical decision point — checking whether per-bucket BSS pattern (especially 20-30¢ NO at -0.05 baseline) has shifted at all.

### Day 4 notes (Apr 24, ~96h post-deploy)

- **No rollback signals.** BSS -0.27 still well above -0.32 trigger; routing healthy (75 active model in 7d post-retrain, all on `cal_1775184454578:global`, zero stale). Cal lift inched up to 8.6%.
- **Sample finally accumulating** — 22 of yesterday's 36 pending resolved overnight (vs 3/day previous pace). 28 new pending arrived. Active model trades now 313 → 343 (+30 in window).
- **Mixed reliability movement.** 0.1-0.2 gap crossed below 0.250 for the first time in the measurement window (0.249, was 0.257). 0.2-0.3 gap worsened (0.316, was 0.291) — but this exact pattern appeared in Phase 1 Day 3 and recovered by Day 5, so likely transient as new μ-corrected predictions populate the bin and shift cumulative averages.
- **0.3+ bins still empty (Day 9 streak).** Counted from Phase 1 Day 0 baseline (Apr 15). Two coordinated levers (σ refit + μ correction) both expected to push predictions higher; neither has done so. The Apr 27 `/audit-brier` becomes the critical decision point if Day 5 (tomorrow) doesn't show movement.
- **Trading Readiness gate cleared today** — 103 resolved, 96.1% win rate, +$35.40 P&L. Position-size raise queued and committed (commit `9a93eb1`, awaiting deploy). See section below.

### Day 5 notes (Apr 25, ~120h post-deploy — final scheduled day)

- **No rollback signals.** BSS -0.27 still well above -0.32 trigger; 0.0-0.1 gap unchanged at baseline (0.174); routing 100% on active model (69/69 in post-retrain window). Pending dropped 42 → 21 overnight (21 resolutions).
- **The decisive read came back mostly flat.** BSS unchanged from Day 4 despite +21 active-model trades resolving. The σ refit + μ correction combined haven't moved the needle on overall skill score across 5 days post-Phase-2.
- **0.2-0.3 gap did NOT follow the Phase 1 recovery pattern.** Phase 1 Day 3 saw a 0.293 → 0.313 excursion that recovered to 0.291 by Day 5. Phase 2 Day 3 saw 0.291 → 0.316; Days 4 and 5 both held 0.316/0.315. **This suggests the excursion is real and possibly μ-correction-induced**, not a transient sample artifact. Worth investigating at the Apr 27 `/audit-brier` whether per-bucket BSS in 30-50¢ NO has worsened. Day 4's 30-50¢ NO watch (46% win on n=28 vs historical 61% on n=1,096) tracks this same hypothesis.
- **0.1-0.2 gap continues its slow grind down.** 0.276 → 0.256 → 0.249 → 0.244 across Days 0/3/4/5. Net -0.032 vs Phase 1 Day 0 baseline (-0.020 was the Phase 1 standalone delta). μ correction has compounded modestly here.
- **0.3+ empty-bin streak now Day 10.** Counted from Phase 1 Day 0 (Apr 15). Both coordinated levers expected to push predictions higher; neither has done so. Per the working-checklist's Final evaluation meta-rollback: if BSS hasn't improved by ≥0.08 from -0.30 baseline (target -0.22) post-Phase-3, escalate. We are currently 0.03 of 0.08 there.
- **Calibration model is now 23 days old, 364 new rows since training; retrain recommendation = RETRAIN.** Per Phase 3 timeline (May 8-15), this is appropriately deferred. Surface for awareness only.
- **Decision deferred to Apr 27 `/audit-brier`.** The Phase 2 PROCEED/ITERATE/ROLLBACK call is not decisive on calibration metrics alone — we need the per-bucket Brier audit to know whether the 30-50¢ NO bucket regressed under μ correction. If 30-50¢ NO has stabilized at <55% win on 50+ trades, μ correction may have overshot and Phase 1.5 (which compounds the same direction) needs scope rethinking before deploy.

### Quick reference for Apr 27 (`/audit-brier`)

- Compare post-Phase-2 30-50¢ NO bucket BSS and win rate vs Day 4 baseline (n=28, 46% win, BSS -0.34 directionally) and historical (n=1,096, 61% win, BSS -0.28).
- Compare 20-30¢ NO if any post-Phase-2 trades have landed there (Day 4 had zero — depends on weather regime returning).
- Decision logic:
  - 30-50¢ NO post-Phase-2 stabilizes at ≥55% win on 50+ trades → μ correction is fine, PROCEED to Phase 1.5
  - 30-50¢ NO post-Phase-2 stays at ≤55% win on 50+ trades → μ correction may have overshot in this bucket → ITERATE on Phase 2 (consider partial rollback or per-bucket calibration before Phase 1.5)
  - Any rollback trigger fires (BSS < -0.32 sustained, cal lift < 6%, signal generation halted) → ROLLBACK

### Validation criteria (revised Day 2 — see writeback semantics finding)

> Original criteria targeted per-source mean bias trending toward zero in `source_accuracy`. Day 2 verification confirmed that collection records RAW forecasts (μ correction is applied downstream, inside BMA only). Per-source bias is therefore not a Phase 2 lever. New criteria:

- [ ] BSS (active model, clean era) moves from -0.27 baseline toward -0.20 over the measurement window
- [ ] 0.1-0.2 reliability gap shrinks from 0.256 toward 0.20 (Phase 1 stalled here)
- [ ] 0.2-0.3 reliability gap shrinks from 0.291 toward 0.25
- [ ] **0.3+ reliability bins start populating with at least 5 trades each** (the most important miss from Phase 1; if Phase 2 doesn't move this, neither lever is finding the gap)
- [ ] Calibration lift continues drifting up from 8.3% baseline

### Rollback triggers (revised Day 2 — see writeback semantics finding)

> Original triggers (per-source MAE +0.3°F, bias direction reversal) are unreachable now that source_accuracy is confirmed to record raw forecasts. New triggers measure the things Phase 2 actually moves:

- Active-model BSS worsens by >0.05 from -0.27 baseline (i.e., drops below -0.32) for 3+ consecutive days
- 0.0-0.2 reliability bin gap increases vs Day 5 baseline for 3+ consecutive days
- Any previously-trading city stops generating signals for >24 hours
- Calibration lift drops below 6.0% (currently 8.3%) for 3+ days
- **Rollback command:** `ssh root@104.248.223.48 'cd /var/www/kardashev && echo "MU_CORRECTION_ENABLED=false" >> .env.local && pm2 reload kardashev-web --update-env'`

### Decision point — `/audit-brier` 2026-04-26

**Audit-brier confirmation (run 2026-04-26, ahead of Apr 27 schedule because the new Sweet Spot gate surfaced the answer early):**

| Window | Trades | 30-50¢ NO BSS | NO Win% |
|---|---|---|---|
| Full corpus (Mar 7 - Apr 24) | 2,288 | -0.285 | 61% |
| Clean era (since Mar 21) | 1,554 | -0.299 | 60% |
| **Post-Phase-2 (since Apr 21)** | **57** | **-0.330** | **46%** |

Post-Phase-2 30-50¢ NO is **0.031 BSS worse** than clean era and **14pp lower win rate**. All 57 trades are in the 24-48h lead bucket; zero post-Phase-2 trades in 20-30¢ (regime confirmed seasonally absent). Zero YES bets post-Phase-2.

**Watch threshold from line 446 has fired:** "If post-Phase-2 30-50¢ NO stabilizes at ≤ -0.30 across 50+ trades → Phase 2 may have hurt this bucket → investigate before Phase 1.5." We are at exactly that threshold (BSS -0.330, n=57).

**No formal rollback triggers fired:** active-model BSS -0.27 (above -0.32 floor), cal lift 8.8% (above 6% floor), signals continuous, 0-0.2 reliability gaps stable.

- [ ] ~~**PROCEED** to Deploy 3 + Phase 1.5~~ — held back; Phase 1.5 compounds Phase 2's direction and risks deepening the 30-50¢ regression.
- [x] **ITERATE** (2026-04-26) — investigate whether Phase 2 hurt the 30-50¢ surface specifically before Phase 1.5. Options: (a) tighter measurement window with n>100 to confirm signal isn't noise, (b) selective μ rollback on the source most responsible for the 30-50¢ regression, (c) accept the regression and move to fade-the-tail track per `memory/strategic-reframe-2026-04-24.md`. Decision to be made after another 1-2 weeks of post-Phase-2 data accumulation.
- [ ] ~~**ROLLBACK**~~ — not warranted; no formal rollback triggers fired.

**Deploy 3 (low-temp warm-tail infrastructure) is decoupled from this decision** — it's tail-sell expansion, not inner-bracket. Proceeds independently.

---

## Inner-bracket viability monitoring (NEW — added 2026-04-20)

**Purpose:** Distinct from Phase 1/2/etc. (which is about *improving* the model). This section tracks **whether the model is good enough to trade inner brackets directly** — i.e., should we design automated execution beyond tail-sell.

**Viability gate** (per `memory/product-readiness-criteria-2026-03-21.md`): **BSS > 0 in the 20-40¢ NO-side bucket on 30+ resolved trades**, with rolling 7-day signal also positive.

### Pre-Phase-2 baseline (`/audit-brier` run 2026-04-20, full corpus 2026-03-07 → 2026-04-19)

**Total resolved trades:** 2,229. **Overall BSS:** -0.38 (vs Day 5 active-model BSS -0.27 — full corpus includes legacy `none` route).

| Bucket | Trades | Model Brier | Market Brier | **BSS** | Win % |
|---|---|---|---|---|---|
| 0-10¢ | 139 | 0.122 | 0.034 | -2.55 | 4% |
| 10-20¢ | 35 | 0.278 | 0.182 | -0.53 | 29% |
| **20-30¢** | **812** | **0.158** | **0.151** | **-0.05** | **81%** |
| 30-50¢ | 1086 | 0.297 | 0.232 | -0.28 | 61% |
| 50-70¢ | 64 | 0.424 | 0.226 | -0.88 | 39% |
| 70-100¢ | 93 | 0.604 | 0.066 | -8.15 | 9% |

**By direction:** YES 218 trades / 13.8% win. **NO 2,011 trades / 66.6% win.** NO-side dominance is strong and consistent with the 24-36h + 20-40¢ NO-only sweet-spot thesis.

**Key read at baseline:** the 20-30¢ NO-side bucket is **at parity with the market (BSS -0.05) on 812 trades / 81% win rate.** Statistically significant; one tick from viable. Phase 2 (μ correction) is the lever expected to push past zero. The 30-50¢ bucket at BSS -0.28 is the harder case.

### REFRAMED 2026-04-24 — interim `/audit-brier` revealed regime mismatch

The original Apr 27 decision criterion ("20-40¢ NO BSS > 0 on 30+ post-Phase-2 trades") **cannot be evaluated on current data**:

- Post-Phase-2 4-day window (Apr 20-24): **57 predictions, ALL in 30-50¢ bucket. Zero in 20-30¢.**
- Pre-Phase-2 14-day window (Apr 6-20): 316 predictions, only 6 in 20-30¢ (1.9%). The 812-trade 20-30¢ corpus came from earlier (March + early April) regimes.
- Conclusion: **20-30¢ activity is seasonally absent right now.** Late April is mild-weather season → bracket pricing clusters in 30-50¢. The 20-30¢ regime requires wider weather uncertainty (heat wave/cold snap onset).

**The viability target was based on a market regime that doesn't currently exist in our data.** Inner-bracket automation as previously designed is gated on a price band the markets aren't producing.

### Revised monitoring schedule

| Date | Skill | Goal | Action triggers |
|---|---|---|---|
| **Apr 21-25** (Phase 2 measurement window) | `/check-calibration` | BSS trending up from -0.27 baseline | Rollback μ correction if BSS drops below -0.32 for 3+ days OR cal lift drops below 6% for 3+ days |
| **Apr 27** (was Phase 2 viability checkpoint, now reduced) | `/audit-brier` | **30-50¢ NO post-Phase-2 BSS** vs historical -0.28 (n=28 today at -0.34, not yet significant) | If post-Phase-2 30-50¢ NO stabilizes at ≤ -0.30 across 50+ trades → Phase 2 may have hurt this bucket → investigate before Phase 1.5 |
| **~Apr 30 - May 4** (post-Phase-1.5) | `/audit-brier` | Combined effect of μ correction + σ retune across all populated buckets | **REVISED DECISION POINT.** No longer a binary "viable / not viable" — instead: "did the model improvements move ANY bucket toward viable, AND has 20-30¢ activity returned?" |
| **Mid-May (rolling)** | `/audit-brier` | Watch for 20-30¢ activity returning as weather volatility rises (late May / early June) | When 20-30¢ has 30+ post-Phase-2 trades, evaluate the original viability criterion |
| **Daily** | `/morning-audit` | No anomalies, model + execution healthy | Sanity sweep |

### Watch item — 30-50¢ post-Phase-2 win rate (NEW)

Post-Phase-2 30-50¢ NO win rate is **46% on n=28** vs historical 61% on n=1,096. Standard error ~9pp → not yet statistically significant (1.6 SD), but worth watching.

- [ ] Re-check on Apr 27 with `/audit-brier` — if 30-50¢ post-Phase-2 NO stabilizes at <55% on 50+ trades, Phase 2 may have hurt this surface (μ correction overshot, predictions now over-confident in NO direction)
- [ ] If confirmed → investigate before Phase 1.5 (which compounds the same direction)

### Trigger to design inner-bracket automation (UNCHANGED — but path is longer)

All three must still hold simultaneously:

- [ ] 20-40¢ NO-side BSS > 0 on 30+ resolved trades since Phase 2 deploy
- [ ] Rolling 7-day BSS in the 20-40¢ NO-side bucket also positive
- [ ] No regression on tail-sell

These criteria are **unchanged** but the timeline is now longer — we wait for 20-30¢ markets to return naturally, possibly mid-May to early June. Don't lower the bar just because the data is slow to arrive.

### Trigger to abandon Item B and rethink

Per the working-checklist's Final evaluation meta-rollback (line ~535): **if BSS hasn't improved by ≥0.08 from the -0.30 Apr 15 baseline (target -0.22 or better) after all phases ship, escalate for strategic review.**

Concretely: post-Phase-3 (calibration retrain, ~mid-May) `/check-calibration` should show active-model BSS ≥ -0.22. If it's still ≤ -0.27, the σ refit + μ correction + retrain combined didn't move the needle — the residual gap isn't bias or σ width, it's structural (correlated source errors, missing predictive features like atmospheric variables, or fundamental Kalshi pricing efficiency that we can't beat).

---

## Tail-sell position size raise: $10 → $20 (QUEUED — gated on Trading Readiness 100/100)

**Context (captured 2026-04-23):** Tail-sell at 95 resolved trades, 96% win rate (91W / 4L), +$29.79 P&L at $10/position. Loss distribution validated as structural (4 cities, 4 days, all at distance-threshold boundary). Last 20 trades: 95% win. Trading Readiness is 5/6 gates passing — only failing gate is "Resolved signals 95/100", clears at ~3/day pace by Apr 25-26. Per-trade EV ~$0.31 at $10 size; doubling makes it ~$0.62.

**Capital constraint:** ~$200 in Kalshi account. Each $20 position locks ~$19.32 collateral (NO buy at 92¢ × 21 contracts). MAX_TOTAL=8 caps max exposure at ~$155 (77% of account, $46 buffer). Current `MAX_TOTAL=30` was sized for $300 max exposure — must come down or risk over-allocating capital.

### Pre-deploy gate (Apr 24+ check) — DONE 2026-04-24

- [x] Confirm `/trading-readiness` shows "Resolved signals" gate at 100/100 (cleared at 103/100)
- [x] Confirm 5 other gates still passing (now 6/6 — execution gate flipped to PASS on 2026-04-22)
- [x] Confirm tail-sell win rate hasn't degraded below 93% on last 20 (96.1% overall)
- [x] No new losses cluster on a single day (still 4 total losses, last on Apr 22)

### Code changes (~4 lines, 2 files) — DONE 2026-04-24, commit `9a93eb1`

`src/lib/models/tailSellTracker.ts`:
- [x] `MAX_TOTAL = 30` → `MAX_TOTAL = 8` (line 18)
- [x] `DAILY_LOSS_LIMIT = 50` → `DAILY_LOSS_LIMIT = 80` (line 21) — was 5 losses at $10; at $20 sizing matches ~4 simultaneous losses
- [x] `POSITION_SIZE = 10` → `POSITION_SIZE = 20` (line 24)

`scripts/execute-tail-sells.ts`:
- [x] `POSITION_SIZE = 10` → `POSITION_SIZE = 20` (line 79)

Per-city (3) and NE corridor (5) caps unchanged — `MAX_TOTAL=8` is the binding constraint. **Local commit only** — not pushed, not deployed. Awaiting user eyeball before push + `/deploy`.

### Deploy checklist — DONE 2026-04-25

- [x] TypeScript clean (`npx tsc --noEmit` for in-scope files)
- [x] Build clean (`npm run build`)
- [x] Single SSH session deploy — cutover landed between 07:09 and 14:00 UTC
- [x] `/pulse-check` passes (PM2 online, 37m uptime, 525MB)
- [x] Verify `kn:opportunities:*` cache repopulates with new POSITION_SIZE in tail-sell signals (first $20 signal: MIA 14:00 UTC)

### Post-deploy live observation (first 10 trades)

- [ ] Watch fill quality on Kalshi: did orders fill at expected NO price? Slippage > 2¢?
- [ ] Confirm contract count = `floor(20 / noPrice)` (~21 contracts at 92¢)
- [ ] Confirm MAX_TOTAL=8 cap is respected (no >8 simultaneous open positions)
- [ ] Confirm DAILY_LOSS_LIMIT halts new entries at -$80 (test path; shouldn't trigger in normal flow)

### Validation criteria (2-3 weeks, ~50-60 signals)

- [ ] Win rate holds ≥93% on the post-raise sample
- [ ] Average pnl per win scales linearly (~$0.60-1.00 vs current ~$0.30-0.50)
- [ ] No fill-quality degradation (slippage stable)
- [ ] Survived at least one multi-loss event without blowing through the $46 buffer

### Rollback triggers

- Single-day P&L below -$100 (~5+ losses simultaneously, well past historical worst)
- Win rate drops below 90% on rolling last 20
- Persistent fill slippage > 3¢ vs expected NO entry price
- **Rollback command:** revert the 4-line commit and deploy

### Decision point (after 2-3 weeks at $20)

- [ ] **HOLD at $20** — performance steady, capital constraint satisfied
- [ ] **RAISE to $30 or $40** — if cushion has grown to ~$300+ AND a multi-loss event was absorbed cleanly
- [ ] **REVERT to $10** — if any rollback trigger fired

### Hard cap

Don't size above $50/position until inner-bracket automation viability is resolved (Apr 27 `/audit-brier` first checkpoint, ~Apr 30-May 4 primary decision). If inner-bracket is viable, capital is better deployed there at higher per-trade EV than scaling tail-sell further.

---

## Fade-the-tail mass-concentration strategy (NEW EXPLORATION TRACK — added 2026-04-24)

**Premise (the strategic reframe):** Our current strategies (tail-sell, inner-bracket viability path) all assume our edge comes from **forecasting better than the market**. The Apr 27 viability path was always speculative because forecasting is a hard game where the market has thousands of professionals using the same NWS feeds we do.

**The reframe:** Instead of "we forecast better," the edge becomes "**retail systematically overpays for tail lottery tickets, we sell them.**" This is a real, documented anomaly in prediction markets — retail loves cheap YES contracts on extreme outcomes ($1 lottery tickets), and market makers don't always bring tails back to fair value because the orders are small. The edge isn't forecasting skill; it's **structural mispricing of tails by retail**.

**Why this is more plausible than beating the market on forecasting:**
- Doesn't require us to be right; requires retail to be wrong (predictably)
- Doesn't compound with weather complexity (works regardless of regime)
- Already what tail-sell partially does — but with a forecast-gap requirement we don't actually need

### Difference from current tail-sell

| | Current tail-sell | Mass-concentration |
|---|---|---|
| Trigger | Ensemble forecast ≥6°F (or ≥3°F) from bracket | Market consensus already at a different bracket; tails priced above true probability |
| Forecast required? | Yes (ours) | No (uses market structure) |
| Detection | Per-source forecasts vs bracket | Order-book mass concentration (e.g., one bracket >70% YES) |
| Lead time sweet spot | 24-36h (per memory) | ~6-12h (after consensus forms, before tails collapse) |
| Edge source | Forecast skill | Retail overpaying |

### Phase A: Data capture (PREP WORK — can start anytime, doesn't touch live trading)

We don't currently capture historical Kalshi bracket-distribution snapshots — only point-in-time L1+L2 cache (TTL 300s). To backtest the mass-concentration strategy properly, we need to start capturing snapshots NOW so we have a corpus to test against in 2-4 weeks.

**Spec:**
- New mongo collection: `kalshi_market_snapshots`
- New cron: every 30 min (`*/30 * * * *`), fetches all active KX-prefix events, captures all bracket prices per event
- Per-snapshot row schema:
  - `eventTicker` (e.g., `KXHIGHNY-26APR24`)
  - `cityCode` (extracted from ticker)
  - `marketType` (high/low)
  - `resolutionDate` (parsed from ticker)
  - `snapshotTime` (timestamp)
  - `hoursToResolution` (computed)
  - `brackets[]`: array of `{ ticker, lowF, highF, yesPrice, noPrice, lastTradePrice, volume, openInterest }`
  - `dominantBracket`: ticker with highest YES price
  - `dominantConcentration`: dominant YES price (proxy for mass concentration)
  - `expiresAt`: TTL 90 days
- TTL index: `{ expiresAt: 1 }` with `expireAfterSeconds: 0`
- Other indexes: `{ eventTicker: 1, snapshotTime: -1 }`, `{ snapshotTime: -1 }`
- Estimated daily volume: ~30 events × 5-7 brackets × 48 snapshots/day ≈ ~10K rows/day = ~900K rows in 90-day retention. Modest.

**Pre-build:**
- [ ] Confirm Kalshi rate limits won't be hit by 30-min poll cadence (we already cache markets at 300s TTL — this is similar load)
- [ ] Decide: separate cron file or add to existing PM2 ecosystem

**Code:**
- [ ] New script: `scripts/capture-kalshi-snapshots.ts` (~80 lines)
- [ ] New mongo collection helper in `src/lib/cache/snapshots.ts` or similar
- [ ] Add to PM2 ecosystem.config.js as cron-style process OR add to crontab

**Deploy + verify:**
- [ ] TypeScript clean, build clean, tests pass
- [ ] Single SSH deploy
- [ ] After 1 hour: confirm 2 snapshots written for active events
- [ ] After 24 hours: confirm ~10K rows, indexes performing
- [ ] Confirm no impact on existing trading/cache (separate code path)

### Phase B: Backtest design (after 2-4 weeks of snapshot data)

Once we have ~2 weeks of snapshots, design the backtest:

- [ ] Define "mass concentration" threshold (e.g., dominant bracket YES > 0.65)
- [ ] Define "tail" criteria (brackets ≥2 brackets away from dominant, YES priced ≤ 0.20)
- [ ] Hypothetical fill: NO at 1 - YES price at snapshot time
- [ ] Resolution: actual settlement bracket from the resolved event
- [ ] P&L calculation: same fee structure as tail-sell (7% of profit)
- [ ] Output: per-cell EV across (lead time, concentration threshold, distance) parameter space

### Phase C: Paper trading + live deploy (later — only after backtest validates)

- [ ] If backtest shows positive EV in some parameter cell: design signal generation
- [ ] Paper trade for 1-2 weeks
- [ ] If paper P&L is positive: live deploy at small position size ($5-10), separate from existing tail-sell

### Strategic positioning

This is NOT a replacement for current strategies. It's a **complementary track** that:
- Doesn't depend on Item B model improvements working
- Uses different market mechanics (structural mispricing vs forecast skill)
- Runs independently (won't share signals with tail-sell)
- Has uncorrelated downside (different failure modes)

If Item B + inner-bracket automation works, great. If it doesn't, this gives us a second path that doesn't require us to win the forecasting battle.

### Cross-references

- Conversation that prompted this track: 2026-04-24, after `/audit-brier` revealed regime mismatch
- Houston example noted by user: 80% mass in one bracket end-of-day, neighbors at 11-13¢ YES
- Related memory: `memory/feedback-tight-agreement-shared-bias.md` (ensemble convergence as shared bias signal)

---

## Tech debt cleanup (audit completed 2026-04-24)

**Premise:** Three months of forecasting infrastructure has accumulated dead-code rollback paths, write-only observability, and over-engineered fallbacks. User wants to remove what isn't earning its keep, demote forecasting from "primary edge" to "input among many" alongside fade-the-tail, while keeping what's load-bearing.

**Audit method:** 3 subagents (BMA core / observability / source value) + 2 direct checks (sweet-spot UI, x402). Findings synthesized below with corrected GW recommendation (subagent missed the low-temp regime where GW is the BEST source).

### Findings table

| Candidate | Recommendation | When | LOC | Risk |
|---|---|---|---|---|
| **Shadow mode logging** | REMOVE | This week (Apr 25-26) | ~30 | Very low |
| **Disagreement detector** | INVESTIGATE first → likely REMOVE/REPURPOSE | This week | ~150 | Medium (need data first) |
| **Legacy `biasCorrection` fallback** | REMOVE | After Apr 27 audit-brier | ~3 | High during measurement |
| **Google-Weather** | **KEEP** (load-bearing for low-temp) | n/a | n/a | n/a |
| **KDE fallback path** | KEEP | Defer mid-May | ~25 | High (no backup if BMA breaks) |
| **`computeWeights()` legacy** | KEEP with code comment | Don't touch | ~125 | High (rollup cron failover) |
| **Solar/x402 infra** | KEEP (asset, not debt) | Future product track | (asset) | n/a |

### Bonus finding: Sweet Spot section already in /trading-readiness UI

`src/pages/trading-readiness.tsx:498-510` already renders a Sweet Spot section with three Go-Live gates. **But the gates need updating** to reflect today's `/audit-brier` regime mismatch finding:
- Current "BSS > 0 in 20-40¢ range" gate misses our actual trading bucket (30-50¢)
- Should add per-bucket BSS for both 20-30¢ AND 30-50¢
- Should add post-Phase-2 sample size requirement
- Should add rolling 7-day BSS in active bucket

### Cleanup execution sequence

**Apr 25 (this week — Day 5 + small cleanup day):**
- [x] Disagreement detector usage query (10 min): zero signals across 2,271 docs / zero PM2 firings / zero market_predictions rows → REMOVED 2026-04-25 (full module + tests + skill + docs + UI tab + analytics cache key bumped v5→v6). Build clean, tests green (6 unrelated pre-existing failures), no production data dependency.
- [x] Shadow mode removal (2026-04-25): stripped `shadowMeta`/`shadowProbabilityDelta`/`baselineModelProbability` etc. from `WeatherOpportunity`, `SignalRecord`, and the `/performance` POST handler. Removed `isDynamicWeightsShadowModeEnabled` + `shouldFetchDynamicWeightContexts` (`shouldFetchDynamicWeightContexts(cityCode)` collapsed to `isDynamicWeightsLiveEnabledForCity(cityCode)` since shadow logging is gone). Deleted `performance.shadow.test.ts` and pruned `dynamicWeightsRouting.test.ts`. Live dynamic-weights routing path preserved (the misleadingly-named `shadowModelProbability` local var stays — it's the legacy-functions output used to swap into `modelProbability` when `dynamicWeightsLiveEnabled`). Build clean, 247/253 tests pass (6 pre-existing failures, same set as before).
- [x] Sweet Spot gate refresh spec (2026-04-26): written at `docs/work/sweet-spot-gates-refresh-spec.md` (617 lines after three review rounds). New gate set: per-bucket (20-30¢ and 30-50¢ NO, matching working-checklist labels) cumulative-since-Phase-2 BSS + rolling-7d BSS, replacing the single 20-40¢ aggregate gate and dead `signalGeneration` gate. NO-only filter enforced explicitly at gate evaluation (extends `BacktestResult` to carry `direction` + `timestamp`). `MIN_CUMULATIVE=30`, `MIN_ROLLING_7D=20`, `ACTIVELY_LOSING_THRESHOLD=-0.05`. Phase 2 timestamp defined symbolically as `Date.UTC(2026, 3, 21, 0, 0, 0)` (= `2026-04-21 00:00 UTC`); pre-baked numeric literals struck after both authors and reviewers made arithmetic errors converting them. Viability policy: either-bucket-clears AND `!anyActivelyLosing` (deliberate softening of working-checklist line 442 — see spec Goals). Status string table split into 8 ordered rows so the rendered text always agrees with the `viable` flag. External Opus review (3 rounds) caught a Brier event-indicator inversion bug, math errors, and policy-flag inconsistencies; all resolved. Apr 27 audit-brier dependency explicit at top of spec with PROCEED/lower-priority/DEFER decision matrix; DEFER cost (calibration retrain + clean-era reset) documented. ~210 LOC build estimate, deferred to next week.

**Apr 27 (after `/audit-brier` validates Phase 2):**
- [ ] Legacy `biasCorrection` fallback removal (~15 min): remove the `MU_CORRECTION_ENABLED=false` branch in `src/lib/models/forecastDistribution.ts:108-110`. Update vitest.config.ts to drop the `MU_CORRECTION_ENABLED: 'false'` test override. Update affected forecastDistribution tests to assume μ correction is on.
- [ ] **DO NOT remove Google-Weather.** Earlier subagent recommended REMOVE based on high-temp regime only. Project memory `memory/low-temp-phase-a-2026-04-03.md` shows GW is the BEST low-temp source (MAE 2.65°F, weight 0.257 in DEFAULT_WEIGHTS_LOW). Removing it would gut Deploy 3.

**This week or next (Sweet Spot UI refresh build):**
- [ ] Implement the new gates per spec
- [ ] Update `src/pages/api/weather/trading-readiness.ts` to compute the new metrics
- [ ] Update `src/pages/trading-readiness.tsx` and `src/hooks/useTradingReadiness.ts` types
- [ ] Deploy

**Mid-May (post-Phase-3 stabilization):**
- [ ] KDE fallback removal (~30 min) — only after we're confident enough in BMA + downstream layers to lose the safety net

**Never:**
- `computeWeights()` legacy fallback in `sourceAccuracy.ts` — add code comment marking it as "weight rollup cron failover, do not remove"

### Why GW is NOT tech debt — important context

The 2026-04-24 audit subagent recommended REMOVE based on high-temp performance (MAE 3.19°F, worst source 37% of the time). **This recommendation is wrong because it ignored the low-temp regime.** Per memory:

- High-temp source rankings (clean era, 926 obs): NWS 1.75 < OM 2.21 < AW 2.28 < TI 2.35 < GW 3.19 (worst)
- **Low-temp source rankings reversed (Apr 23 corpus, 2,122 obs): GW 2.41 (best) < TI 2.89 < OM 3.12 < NWS 4.10 < AW 4.36 (worst)**

GW is dual-purpose: minor contributor for highs (4% weight), dominant contributor for lows (~26% weight in recomputed DEFAULT_WEIGHTS_LOW). Plus it's actively feeding the source_accuracy corpus that will support Deploy 3 (warm-tail rollout).

Lesson: when dispatching subagents for audit work, give them the FULL context (high AND low regimes, all consumers, future use cases), not just the surface they'll naturally find.

### Net impact estimate

- High-confidence cleanup (shadow mode + maybe disagreement): ~30-180 LOC removed, very low risk
- After Apr 27 (biasCorrection removal): ~3 more LOC out
- Mid-May (KDE removal): ~25 more LOC out
- **Total realistic cleanup: ~60-210 LOC**
- KEEP'd items: ~150 LOC retained as legitimate failover insurance
- Reframed value: forecasting infra now positioned as "input + filter for fade-the-tail" rather than "primary edge"

---

## Deploy 3: Low-temp infrastructure — kill switch OFF (DEPLOYED 2026-04-27, commit `88beab7`)

**Prerequisite:** Phase 2 validates clean
**Scope:** Ship low-temp signal generation infrastructure with kill switch remaining OFF. Warm-tail signals generated but forced to HOLD — shadow validation only.
**Reference:** `memory/low-temp-phase-b-design-2026-04-05.md`, plan file `silly-wiggling-ocean.md` Section 3

### Code changes (~235 LOC across 4 files — ended larger than 90 LOC estimate, mostly type-widening overhead)

- [x] Add `DEFAULT_WEIGHTS_LOW` constant — Apr 23 values: GW=0.257, TI=0.220, OM=0.207, NWS=0.162, AW=0.154. Lives at `src/lib/models/weatherProbability.ts` next to `DEFAULT_WEIGHTS` and `THRESHOLD_WEIGHTS`.
- [x] Add weight branching in `forecastDistribution.ts` based on `temperatureType` — high uses DEFAULT_WEIGHTS, low uses DEFAULT_WEIGHTS_LOW (override and ensemble.activeWeights take precedence).
- [x] Add `generateWarmTailSellSignals()` function — separate from cold-tail, gated on `LOW_TEMP_SIGNAL_GENERATION_ENABLED` (stays false). 5°F inner distance, 3°F threshold distance.
- [x] Type widening in `TailSellRecord` and `TailSellSignal` — `direction: 'cold' | 'warm'`, `temperatureType: 'high' | 'low'`.
- [x] Add `MAX_PER_CITY_TYPE = 2` sub-cap in `tailSellTracker.ts` — extends `PositionState` with `byCityType` map; `logTailSellSignals` enforces.
- [x] Add `POSITION_SIZE_LOW = 5` constant — wired into per-record `positionSize` based on `signal.temperatureType`.
- [x] `LOW_TEMP_SIGNAL_GENERATION_ENABLED` stays `false` ✓

### Pre-deploy checklist

- [x] Recompute `DEFAULT_WEIGHTS_LOW` against current low-temp corpus (DONE 2026-04-23 — values above)
- [x] Pre-ship grep audit completed — surfaced one known gap (filed, not blocking): `scripts/execute-tail-sells.ts` uses hardcoded `POSITION_SIZE=20` instead of reading `record.positionSize`. Irrelevant while kill switch OFF; must fix before flipping.
- [x] Verify city exclusion list — existing `THRESHOLD_EVENT_BLACKLIST` covers PHI/PHIL/SEA/DC/DEN; warm-tail uses `isThresholdSignalBlacklisted(cityCode, 'above')`.

### Deploy checklist — DONE 2026-04-27

- [x] TypeScript clean (non-test src), build clean, 247/253 tests pass (same 6 pre-existing failures)
- [x] Single SSH session deploy — first attempt hit lockfile-patch error, recovered via cold reinstall. PM2 online (PID 897405)
- [x] Post-deploy: HTTP smoke (200), PM2 logs clean
- [x] Verify warm-tail signals NOT generated (kill switch correctly suppressing): `tail_sell_signals.direction='warm'` count = 0 ✓
- [x] Verify high-temp cold-tail trading unaffected: 1 cold signal in last 6h post-deploy, normal ✓
- [x] Verify low-temperatureType signals NOT generated: count = 0 ✓

### Known gap (filed for warm-tail go-live, not blocking ship)

`scripts/execute-tail-sells.ts:79` uses hardcoded `POSITION_SIZE=20`. When the kill switch eventually flips, warm-tail signals would execute at $20 instead of $5. **Must fix before flipping**: change to `const positionSize = signal.positionSize ?? 20` (or equivalent) so it reads the per-record value. ~3 LOC.

---

## Tail-sell `actualF` bound-on-loss fix (DEPLOYED 2026-04-29, commit `ccf6afd`)

**Origin:** User noticed Signal Audit Trail rendering `—` in the Actual column for resolved tail-sell losses. Apr 27 examples: DAL `≤86°F` and AUS `≤92°F` both showed `actual=—`.

**Root cause:** `resolve-markets.ts:129-132` deliberately passes `actualTemp = null` when the day's winner is a threshold bracket — the boundary is a one-sided bound, not a true observation; using it would poison `source_accuracy` / `temp_bias`. `resolveTailSellSignals` wrote that null straight to `actualF` for both win and loss branches. UI correctly rendered null as `—`. Tail-sell losses by definition resolve via the threshold bracket the bet targeted → `actualTemp = null` for every loss.

**Fix:** Added `actualFKind: 'exact' | 'le' | 'ge' | null` qualifier to `TailSellRecord`. On loss with null actualTemp, `resolveTailSellSignals` derives a one-sided bound from the signal's own bracket fields:
- Cold-tail loss → `actualF = bracketCapF`, `actualFKind = 'le'` (actual was at or below cap)
- Warm-tail loss → `actualF = bracketFloorF`, `actualFKind = 'ge'` (actual was at or above floor)

UI renders `≤86°` / `≥40°` based on kind. Legacy records without kind fall through to the existing exact-decimal render. **Boundary preserved:** the `actualTemp = null` discipline that protects `source_accuracy`/`temp_bias` is untouched; bound only ever lives on `tail_sell_signals` records.

### Backfill

- [x] One-shot script `scripts/backfill-tail-sell-actual-loss.ts` (idempotent, `--dry-run` flag) — 7 historical loss records updated to `actualFKind: 'le'`. All cold-direction with valid `bracketCapF`. 0 skipped.
- [x] Post-fix mongo verifications: `loss with null actualF: 0` ✓, `actualFKind=le: 7` ✓, DAL Apr 27 row now shows `actualF=86, kind=le` ✓.

### Out of scope (intentionally deferred)

- **Win-side null actualF (5 records).** Threshold-bracket wins where the signal won but the day's actual landed in a different threshold bracket. Inferring a bound for these requires the day's winning bracket info from `resolve-markets.ts`, a separate cross-file change. User report was loss-specific.

---

## Watch item — 12-20¢ YES band post-doubling (NEW 2026-04-29)

**Finding:** While investigating user observation that "we've bought contracts in the 80-85¢ buckets," distribution audit revealed that the 12-20¢ YES band (= 80-88¢ NO) has historically lower win rate than the 4-12¢ YES band:

| YES band | NO band | Trades | Win% |
|---|---|---|---|
| 4-8¢ | 92-96¢ | 80 | **96.3%** |
| 8-12¢ | 88-92¢ | 25 | **100.0%** |
| 12-16¢ | 84-88¢ | 14 | **85.7%** |
| 16-20¢ | 80-84¢ | 12 | **83.3%** |

The 96.1% headline tail-sell win rate is buoyed by the 4-12¢ band (97% on n=105). The 12-20¢ band has been ~85% historically.

**Post-doubling concern:** Of 7 post-doubling resolved trades in the 12-20¢ band, 3 lost (57% win rate, n=7). Specifically the 16-20¢ sub-band went from 9/9 wins pre-doubling to 1/3 post-doubling. Sample is tiny but striking, and matches the user's observation directly.

**Hypothesis:** Higher YES prices mean the market has more conviction the bracket might hit. When the market disagrees with us more aggressively (15-20¢ vs 5-10¢), the model loses more often. This is consistent with the post-Phase-2 30-50¢ NO BSS = -0.33 finding — the model loses skill in price ranges where the market has conviction.

**EV check at $20 sizing:** Even at 83% win, 16¢ YES still has positive EV (~+$0.50/trade) vs 96% on 7¢ YES (~+$0.94/trade). Both make money historically; 12-20¢ band has roughly half the EV with materially higher variance.

**Decision rule:** Hold off on action until 5-10 more 12-20¢ band resolutions. Then re-evaluate:
- If 12-20¢ band post-doubling stabilizes ≤80% on n≥15 → tighten `TAIL_YES_MAX` from 0.20 → 0.15 (or 0.12). One-line change in `src/lib/computeOpportunities.ts:82`.
- If recovers toward 90%+ → leave alone, this was sample noise.
- Either way: revisit at next `/audit-brier` checkpoint May 4-5.

**Update 2026-05-07 — SHIPPED:** `TAIL_YES_MAX` tightened 0.20 → 0.15. Empirical at audit time: 15-20¢ band on cold-side HIGH live = 27 resolved, 85.2% win, NET **−$8.64**. 5-9¢ = 97.5% win / +$49.12; 10-14¢ = 89.7% win / +$3.71. Cutoff at 0.15 surgically removes the unprofitable band, preserves what works. Re-evaluate at +30 days — if 10-14¢ band degrades, consider tightening further to 0.12. See `memory/feedback-tail-yes-max-2026-05-07.md`.

**Cross-reference:** This is a different surface from the Phase 2 ITERATE 30-50¢ NO concern. That's about post-Phase-2 model BSS in the 30-50¢ inner-bracket range. This is about tail-sell win rate by tail-sell entry price band. Both share the underlying theme: model loses skill where market has conviction.

---

## Inner-bracket signal pipeline silent (FINDING 2026-05-02)

**Origin:** May 2 heat-check `/audit-brier` revealed the post-Phase-2 corpus had only grown by 6 trades in 6 days. Investigation showed `signals` and `market_predictions` collections last received writes at **2026-04-26 08:01 UTC** — 6 full days of zero inner-bracket emissions. Tail-sell + paper-warm-tail continue normally on separate code paths.

**Root cause** — two gates simultaneously rejecting all current-regime opportunities:

1. **YES moratorium** (`YES_SIGNALS_ENABLED=false` at `computeOpportunities.ts:638`). Per code comment: "STRONG_YES 0/56 wins, YES 5/94 wins (5.3%) — YES signals KILLED until BMA Phase 2 fixes the probability model." Phase 2 deployed Apr 20 but the moratorium was never lifted. Live API check May 2 confirmed: NYC has a 65.6% edge YES opportunity (`KXHIGHNY-26MAY02-B62.5`, mid $0.12) that's blocked by the moratorium.

2. **NO-side sub-threshold edges.** May warm-weather regime → tight bracket distributions → NO-side edges typically 5-10%, below `minEdge=0.15`. The 30-50¢ NO bucket that fed the Apr 21-26 trades has dried up; only 4 NYC opps today, all NO edges 0.06/0.09/0.09 (HOLD).

**Implication for May 4-5 audit-brier checkpoint:** corpus won't grow organically before then. The decision-relevant data is what we have today (n=63, BSS -0.385). May 4-5 will be informational rather than decisive on the Phase 2 ITERATE question.

**Implication for inner-bracket viability monitoring:** the BSS gate on `/trading-readiness` is currently rendering frozen Apr 26 data. Sweet Spot per-bucket gate accuracy is contingent on continued post-Phase-2 sample growth.

**Decision pending — lift moratorium for data capture?** Currently weighing tradeoffs (see open question below). Historical YES win rate was 13.8% across 218 bets pre-moratorium → real money loss if user manually executes recommendations. But we have ZERO post-Phase-2 YES data, so we can't measure whether Phase 2 corrected the asymmetry. Inner-bracket exploration is structurally blocked without it. Likely path: env-toggleable mode flag (mirror the `LOW_TEMP_WARM_TAIL_MODE` pattern), default to enabled-but-flagged-experimental, with explicit "do not manually trade YES recommendations" discipline.

### Update 2026-05-02 — moratorium lift shipped (data capture only)

**Implementation:** `YES_SIGNALS_ENABLED` env flag added (`computeOpportunities.ts`, default `false`); `/api/weather/opportunities` filters YES non-HOLD recs from public response (DB writes still capture full data); `/trading-readiness` adds new "Probability-Model Signals" section with EXPERIMENTAL banner + paginated audit trail. Section name reflects data reality — `signals` collection is overwhelmingly threshold-direction (≤X°F / ≥X°F), not true inner brackets.

Cache prefix bumps: `kn:opportunities:` → `kn:opportunities:v2:`, `trading-readiness:v4` → `v5`. Audit trail pagination (25/page) applied to all 3 audit tables on `/trading-readiness` (tail-sell live, paper, probability-model).

**Watch — YES win rate post-moratorium-lift (added 2026-05-02)**

Re-evaluate after 30+ post-lift YES trades resolve (estimate 2-3 weeks at current cadence, or sooner if regime shifts):

- **YES win rate ≥ 40%** → Phase 2 materially helped the YES asymmetry. Discuss next steps (cautious live YES bets at small position size, or further tuning).
- **YES win rate 20-40%** → Phase 2 helped modestly but YES still loses overall. Keep moratorium-lifted-for-data-capture state, don't trade live.
- **YES win rate ≤ 20%** → Phase 2 didn't fix the asymmetry. Re-disable the moratorium (`YES_SIGNALS_ENABLED=false`) and document the failed re-enablement attempt.

**Anomaly trigger:** any single YES win at edge ≥ 0.40 with hypothetical P&L > $5 is unexpected — flag for examination (could indicate regime shift or model improvement worth investigating).

**Discipline guard:** YES recs are filtered from `/weather-forecast` to prevent accidental manual trading. Inner-bracket execution is NOT automated — `execute-tail-sells.ts` cron is a separate code path. Lifting the moratorium causes DB writes + UI audit-trail surfacing only, no real money at risk.

### Update 2026-05-02 (evening) — Late-Day Arbitrage forward instrumentation LIVE

**Hypothesis:** in the last 6h of a weather bracket's local-time observation day, when actual temp observation already locks the bracket outcome (e.g., observed-so-far past the strike), Kalshi pricing should be ~$0.97/$0.03 — but if it lags, there's an information edge ("ride the wave"). Existing data couldn't validate retrospectively (0 of 700 resolved markets had a snapshot within 4h of resolution), so forward instrumentation is the only path.

**Shipped (commit `bcca5b5`):**

- `scripts/probe-late-day-arb.ts` — long-running poller, 60s loop, captures Kalshi orderbook + Iowa Mesonet ASOS obs for in-window markets. 3 σ heuristics for obs-implied probability. PM2 entry `kardashev-late-day-probe` (autorestart, 512MB cap, 10min heartbeat). Persists to `kalshi_late_day_snapshots` collection (TTL 30d).
- `scripts/retro-mid-day-arb.ts` — one-shot weak retro using existing 4-24h-pre-resolution snapshots. Output: `docs/work/late-day-arb-retro-2026-05-02.md`. Sample thin (n=4) due to survivorship + Iowa rate-limits — null finding here doesn't constrain forward result.
- Verified live 2026-05-02 21:48 UTC: probe online, 150 markets/cycle persisted across 13 cities, 88 (29%) "decided" by observation, sample priced near $0.005 (efficient). Single snapshot — need accumulation.

### Phase 3 — Forward-data analysis (2026-05-03) — **COMPLETE: KILL**

**Outcome: late-day arbitrage hypothesis disproven.** Probe stopped + deleted from PM2; ecosystem entry removed. Report at `docs/work/late-day-arb-analysis-2026-05-03.md`.

**What killed it (real data, n=144 decided + Kalshi-resolved):**

- Match rate (σ2 vs actual): **91.7%** (not 100% as proxy assumed)
- YES-side accuracy: **77.3%** (17/22) — the σ2 model claims 95% confidence, ground-truth disagrees ~23% of the time on YES-locked brackets
- NO-side accuracy: 94.3% (close to claimed)
- Real Brier vs actual: 0.0833
- **Real EV per actionable trade: −11.73¢ (29.4% win rate, n=17)**

**Independent failure mode — settlement-source drift (Phase 2b, n=11 events):**

- Mean |Δ| (Iowa ASOS vs NWS Climate): 0.55°F
- **45% of events drift ≥1°F** (range −1 to +2°F)
- Drift is directional: Kalshi/NWS reports HIGHER than Iowa for highs, LOWER for lows — pushes outcomes *against* our obs-implied edge
- Cases observed: NY high +1, CHI high +2, LV high +1, CHI low −1, DEN low −1

**Why this can't be rescued by σ retuning:** Phase 2b shows the ground-truth source itself is drifting. To make obs-implied probabilities meaningful for Kalshi pricing, we'd need NWS Climate Reports as our observation feed, not Iowa ASOS. That's a different project.

**Tasks:**

- [x] Verified probe online (20h uptime, 0 restarts, 9,978 → 10,128 snapshots accumulated)
- [x] Pulled snapshot stats (300 unique tickers / 50 events / 25 city×type combos / 51% decided)
- [x] Wrote `scripts/analyze-late-day-arb.ts` with all 5 sub-analyses + Phase 2 (resolution-joined validation) + Phase 2b (settlement-source alignment)
- [x] Output: `docs/work/late-day-arb-analysis-2026-05-03.md` with KILL recommendation
- [x] Probe stopped + deleted from PM2 + removed from `ecosystem.config.js`
- [x] Decision + structural reason saved to memory

**What we keep (instrumentation paid for itself in learnings):**

- σ-heuristic consistency analysis pattern (Analysis 5) — applicable to other binary settlement events
- Orderbook context capture (yesBookDepth / noBookDepth) and thin-vs-stacked classification — useful for any microstructure work
- Iowa ASOS fetcher (`fetchIowaAsosObservations` in `scripts/probe-late-day-arb.ts`, copied into `scripts/analyze-late-day-arb.ts`) — reusable for tail-sell observation backfill if needed
- Settlement-source drift discovery — informs any future strategy that uses non-NWS obs to predict NWS-settled markets
- `kalshi_late_day_snapshots` collection (TTL 30d) — let it expire; do not re-enable the probe

---

### Tail-Sell Position Risk Monitor (2026-05-04 → in progress)

**Plan reference:** `.claude/plans/okay-today-is-april-concurrent-stearns.md` (LOCKED 2026-05-04). This section is the active execution tracker.

**Goal:** ship a read-only risk monitor that classifies every open `pending` tail-sell position as OK/WARN/CRITICAL via city-agnostic + quadrant-aware rules. Cron every 2h. Telegram alerts on level transitions. Surfaces in `/trading-readiness`. Pre-trade shadow screening logs (no behavior change to live signal emission).

**Trigger event:** PHX `KXHIGHTPHX-26MAY04-T81` — forecast dropped 84.2°F → 81°F in 5h post-signal due to 100% cloud cover at peak. Position now CRITICAL but discovered manually. Monitor would have flagged it hours earlier.

**Critical constraint:** zero modifications to `generateTailSellSignals` and friends. Only ADDITIVE log-statement after generation (Phase A.2 shadow). Live cold-side HIGH path UNCHANGED.

#### Phase A — Standalone MVP script

- [x] Create `src/lib/utils/iowaAsos.ts` (refactor `fetchIowaAsosObservations` out of script-local files)
- [x] Skip update of import paths in old probe/analyze scripts (decommissioned/one-shot — leaving duplicated for now; cheap follow-up)
- [x] Create `src/lib/models/positionRiskTracker.ts` with `classifyPositionRisk(snapshot)` pure function + collection helpers
- [x] Create `scripts/monitor-position-risk.ts` — iterate pending tail-sell signals, build refreshed forecast, classify, console-log
- [x] **Sanity check:** PHX `KXHIGHTPHX-26MAY04-T81` classifies as **CRITICAL** post-fix (drift -3.9°F + boundary cross at -0.6°F buffer + cloud 92%) ✓
- [x] Cross-quadrant coverage: 4 quadrants represented in classified positions
- [x] Cross-city coverage: 5 cities (CHI/LA/MIA/BOS/SFO/PHX/etc.) in output

#### Phase A.2 — Pre-trade shadow screening

- [x] `[risk-shadow]` log call added after each `generate*Signals()` call in computeOpportunities.ts
- [x] Verified live cold-side HIGH signal emission UNCHANGED (read-only on signal generation; pure-additive log statement)

#### Phase B — PM2 cron + Mongo persistence + Telegram alerts

- [x] `position_risk_snapshots` collection schema + indexes + TTL (14 days) in `positionRiskTracker.ts`
- [x] `src/lib/utils/telegram.ts` — fail-soft `sendTelegramAlert(text)`, env-gated
- [x] PM2 entry `kardashev-position-monitor` registered (`cron_restart: '0 */2 * * *'`, `autorestart: false`)
- [x] Alert-dedup logic: transition-only, 6h throttle per signalId
- [x] `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` documented in CLAUDE.md
- [x] **User prerequisite (DONE):** Ty supplied bot token + chat ID; Telegram alerts confirmed working as of 2026-05-09.

#### Phase C — `/trading-readiness` UI integration

- [x] `/api/weather/trading-readiness.ts` extended with `openPositionRisks` array
- [x] Cache prefix bumped `trading-readiness:v7` → `v8`
- [x] `useTradingReadiness` hook extended with `OpenPositionRiskRow` type
- [x] "Open Position Risk" panel added to `trading-readiness.tsx` — sorted CRITICAL → WARN → OK, color-coded badges
- [x] Empty-state handling: "No open positions or risk monitor has not run yet"

#### Phase D — Verification + deploy

- [x] `npx tsc --noEmit` clean
- [x] `npm run build` clean (6 pages)
- [x] PHX sanity case CRITICAL after both fixes
- [x] Live cold-side HIGH signal emission unchanged (existing log shows expected `[tail-sell]` lines + new `[risk-shadow]` lines downstream)
- [x] Deployed (commit `f3eb274`)
- [x] **Post-deploy 1h check:** `position_risk_snapshots` populated (5/20 positions classified; 15 hit transient source-rate-limit and skipped via INSUFFICIENT_DATA gate)
- [ ] **Post-deploy 24h check (CRITICAL — 2026-05-05 ~04:00 UTC):** trailing-day cold-side HIGH live volume ≥4/day baseline check from yesterday's deploy. **Rollback if sustained <4/day.**
- [x] Telegram fail-soft verified: env vars unset → no exceptions → console warnings only
- [ ] Once Telegram credentials added: trigger a synthetic CRITICAL to verify message delivery
- [x] `/trading-readiness` Open Position Risk panel renders (5 entries shown, all OK with INSUFFICIENT_DATA notes due to current source-coverage state)

#### Phase E — Memory + post-deploy follow-ups

- [x] Saved `memory/position-risk-monitor-2026-05-04.md`
- [x] Saved `memory/reference-telegram-alert-channel.md`
- [x] Updated `MEMORY.md` index with both new entries
- [x] **2-week follow-up (2026-05-18): DONE — DECISION: EXTEND window, no threshold change.** FP rate 100% (47 flagged WARN/CRITICAL, 0 lost; the only loss of 56 resolved monitored signals was OK-classified — inverted lift). Criterion (>50%→tighten) tripped, but **declined to tighten: sample has exactly 1 loss** (tail-sell wins ~97%); recalibrating on 1 loss = fitting noise. Also 1741/2046 snapshots are INSUFFICIENT_DATA-OK (sourceCount<3). Real issue = alert fatigue (174 CRITICAL, 0 caught) + structural unvalidatability. Re-review at ≥~10-15 accrued losses (~+60-90d, target ~2026-07-17). De-page (suppress Telegram on WARN/CRITICAL transitions, keep audit trail) available as interim if noise bites — not executed unilaterally. Retire candidate if still unvalidatable at re-review. Reusable: `scripts/position-risk-and-atm-gate-review.ts`. See `memory/risk-overlays-unvalidatable-2026-05-18.md`.

#### Known issues + watch items

- **Source rate-limiting during cron runs.** AccuWeather, Tomorrow.io, Google-Weather often return 0 forecasts during the 2h cron cycle. INSUFFICIENT_DATA gate (sourceCount < 3) correctly classifies as OK with a triggers note rather than firing false CRITICAL alerts. Real positions may not be classified on every run; next cron 2h later usually catches them.
- **Two bugs caught in initial deploy** (now fixed): (a) `buildForecastDistribution` requires pre-filtered ensemble — must call `filterEnsembleByDate` first; (b) bracketRegime must match signal-generation regime (T/B-suffix tickers use `'threshold'`).
- **Live cold-side HIGH path mechanically untouched.** Pure-additive code; only new log lines added downstream of signal generation.

---

### Four-quadrant tail-sell paper deployment (2026-05-04 → in progress)

**Plan reference:** `.claude/plans/okay-today-is-april-concurrent-stearns.md` (LOCKED 2026-05-04). Full context, design rationale, and risk assessment live there. This section is the active execution tracker.

**Goal:** ship hot-side HIGH (paper) + cold-tail LOW (paper, conditional on viability) so all four tail-sell quadrants are deployed. Add four-quadrant status display to `/trading-readiness`. Retire Probability-Model Signals section.

**Critical constraint:** ZERO tolerance for changes that regress live cold-side HIGH. Pure-additive code paths only — existing `generateTailSellSignals` + line 72 NOT modified.

#### Pre-deploy verification (BLOCKING — must complete before Phase B)

- [x] Read `src/lib/models/tailSellTracker.ts:289-310` to determine if `MAX_PER_CITY=3` is shared across live + paper or scoped per-mode → **SEPARATE per-mode** (line 254 comment: "separate budgets for live vs paper")
- [x] Cross-check via production query → unresolved signals show 16 cold-side legacy/live + 3 paper across 12 cities; clean separation
- [x] **If separate per-mode:** safe to proceed → confirmed
- [x] **Baseline check:** cold-side HIGH live signal volume — **5.71/day mean** trailing 7d (range 3-8/day). Rollback trigger: sustained <4/day post-deploy.

#### Phase A — LOW cold-tail viability analysis

- [x] Create `scripts/analyze-low-cold-tail-viability.ts` (mirror of `scripts/analyze-hot-side-viability.ts`, flip to `marketType='low'` + below-forecast direction)
- [x] Generate `docs/work/low-cold-tail-viability-2026-05-04.md`
- [x] Apply GO/NO-GO/CONTINUE rules from the script's decision-rule output
- [x] **Decision recorded:** strict gate → NO-GO (sample size n=0, not signal). **OVERRIDE → INCLUDE in Phase B as paper** to gather forward data. Mechanism (LOW-market cold-bias 65.57%) confirmed; failure was historical-sample thinness from low-temp signal-gen being disabled 2026-04-10. Paper deployment is the right tool for unknown-tail data gathering. Real evaluation gate moves to +60-90 days.
- [x] Override decision: include cold-tail LOW in Phase B as paper

#### Phase B — Code changes (single deploy)

- [x] **B.1 — Add NEW signal-generator functions (do NOT modify existing):** added `generateHotTailHighSignals` + `generateColdTailLowSignals` in `computeOpportunities.ts`. Existing `generateTailSellSignals` (cold-side HIGH live) and `generateWarmTailSellSignals` literally unchanged. Per-quadrant blacklists encoded as `HOT_TAIL_HIGH_BLACKLIST` (7 cities) + `LOW_COLD_TAIL_BLACKLIST` (empty initially).
- [x] **B.2 — Mode determination:** extended dispatch in `tailSellTracker.ts:275-292` to handle 4 `(direction, temperatureType)` tuples. Existing `(cold, high) → 'live'` case unchanged.
- [x] **B.3 — Env flags + CLAUDE.md docs:** `HOT_TAIL_HIGH_MODE` and `LOW_TEMP_COLD_TAIL_MODE` added (defaults `'off'`; deployed to droplet as `'paper'`). Documented in CLAUDE.md.
- [x] **B.4 — Unit tests** for new blacklists. 19/19 pass. End-to-end synthetic-input tests deferred (would duplicate live cold-side HIGH path we explicitly don't modify).
- [x] **B.5 — Cache prefix bumps:** `trading-readiness:v6` → `v7`; `opportunities:v2:` → `opportunities:v3:`.
- [x] **B.6 — Paper budget bump:** `MAX_TOTAL_PAPER` 30 → 60. Pre-deploy verification confirmed per-mode budgets are SEPARATE — no isolation work needed.

#### Phase C — `/trading-readiness` four-quadrant display

- [x] **C.1 — API:** `tailSellQuadrants` array shipped, always 4 entries; verified production response includes all four with correct counts and modes.
- [x] **C.2 — UI:** "Tail-Sell Strategy Status" section added with mode badges (live=green / paper=amber-dashed / off=gray). Sparkline deferred — daily-max-drawdown can be derived from existing signal table; bring back if heat-wave drawdown becomes hard to read.
- [x] **C.3 — Public-readability:** left public for now per plan.

#### Phase D — Remove Probability-Model Signals (~30 min)

- [x] **D.1 — API:** `probabilityModel` field + `parseBracketLabel` + `hypotheticalPnlPerContract` + `toProbabilityModelRow` removed.
- [x] **D.2 — UI:** Probability-Model Signals section + `ProbabilityModelTable` + `pmDateFilter`/`filteredPmSignals` state + ProbabilityModelRow type all removed.
- [x] **D.3 — Confirmed preserved:** `signals` + `market_predictions` collections continue writing (no upstream changes); `YES_SIGNALS_ENABLED=true` flag stays; `/audit-brier` and `/check-calibration` skills work unchanged.
- [x] **D.4 — Reminder:** YES moratorium-lift experiment evaluates via `/audit-brier since=2026-05-02` skill in 2-3 weeks (~30+ resolved YES trades).

#### Phase E — Verification

- [x] `npx tsc --noEmit` clean (excluding 3 pre-existing test failures)
- [x] `npm run build` clean (6 pages generated)
- [x] Unit tests pass (53 tests across 3 files: fourQuadrantTailSell + thresholdBlacklist + lowTempBlacklist)
- [x] Local dry-run substituted by post-deploy production verification (skipped local since we're deploying immediately)
- [x] Local dry-run substituted by post-deploy production verification
- [x] **Pre-deploy regression baseline:** cold-side HIGH = 5.71 signals/day (40 over 7 days, range 3-8/day)
- [x] Deploy to droplet (commit `d69fcb0`); env flags `HOT_TAIL_HIGH_MODE=paper` + `LOW_TEMP_COLD_TAIL_MODE=paper` set
- [x] **Post-deploy verification:** `/api/weather/trading-readiness` returns four-quadrant array with all 4 entries; cold-side HIGH still healthy (152 resolved, 94.1% win rate, +$28.18 P&L, 6 signals today vs 5.71 baseline). Probability-model field absent from response. Warm-tail LOW paper unchanged (24 resolved, 91.7%). Hot-side HIGH and cold-tail LOW paper at 0/0 (newly enabled, awaiting first qualifying signals).
- [ ] **Post-deploy 24h check (CRITICAL):** trailing-day cold-side HIGH signal volume vs 5.71/day baseline. **If sustained <4/day, ROLLBACK and investigate.** Re-check 2026-05-05 ~04:00 UTC.
- [x] `execute-tail-sells.ts` skip-paper filter unchanged (line 234 — verified in pre-deploy code review)
- [x] `/trading-readiness` displays four-quadrant section; existing live + paper data tables unaffected

#### Phase F — Memory + checklist updates

- [x] Update `memory/tail-sell-four-quadrant-framework.md` with new deployment statuses + per-quadrant blacklists
- [x] Pre-deploy budget verification result documented (per-mode SEPARATE, line 254 of tailSellTracker.ts)
- [x] Phase A outcome documented (strict NO-GO due to sample, override to paper)
- [x] Final deploy entry: 2026-05-04, HOT_TAIL_HIGH_MODE=paper + LOW_TEMP_COLD_TAIL_MODE=paper + LOW_TEMP_WARM_TAIL_MODE=paper. Commit `d69fcb0` at 03:50 UTC.

#### Watch items post-deploy (until each paper quadrant resolves ≥30 trades)

- [ ] **Daily for first 3 days:** spot-check `tail_sell_signals` collection. New paper signals appearing? Live cold-side HIGH unaffected?
- [ ] **Weekly:** paper-mode P&L trend, win rate trend per quadrant
- [ ] **At ≥30 resolved trades per quadrant:** evaluate paper-mode results; decide flip-to-live per quadrant
- [ ] **Hot-side HIGH special gate:** flip-to-live requires `60-90 days minimum AND ≥30 resolved trades AND covers at least one summer heat-wave week AND 14-day rolling win rate within 5pp of viability prediction (96-97%)`. Spring data alone insufficient for summer regime.

---

### Hot-side high-temp tail-sell viability analysis (2026-05-03) — **GO**

**Outcome: viability confirmed.** All six decision criteria pass. Hot-side high-temp tail-sell deployment scoped (Phase 4 of plan), pending future implementation work.

**Headline numbers (clean era 2026-03-21 → 2026-05-03, n=1265 high-temp events):**

- Cold-bias confirmed: **61.66%** of events had actual warmer than forecast (memory baseline ~60%, matches)
- Hit rate at +6°F bracket distance: **3.00%** (38 hits of 1265 — well below 5% gate)
- Mean per-trade EV across YES bands at +6°F: **+7.29¢** (well above 3¢ gate)
- Sample size at +6°F+: 58 (above 50 minimum)
- 9 of 16 cities pass per-city EV gate (above 3 minimum)

**Worst-day correlated drawdown (with production position caps applied):**

- Worst day in clean era: 2026-03-28 (27 raw hits across NE corridor)
- Cap chain: 27 raw → 8 after per-city → 5 after NE-corridor cap → **5 active positions**
- Drawdown at $20 position: **-$99** (gate: <$200)
- Drawdown at $50 position: **-$247.50** (gate: <$500)

Production position caps (MAX_PER_CITY_TYPE=2, MAX_NE_CORRIDOR=5, MAX_TOTAL=8) are doing real work — without them, the same heat wave would cost $534 at $20 position. Cap discipline is the difference between viability and ruin.

**Per-city signal: 7 cities should be blacklisted at deploy time.**

Cities failing per-city EV gate (hit rate too high or EV negative at YES=10¢): AUS (12.40%), BOS (13.59%), LV (10.87%), DAL (8.77%), DC (7.58%), PHIL (7.23%), SEA (5.88%). These have high enough heat-wave hit rates that hot-side tail-sell is unprofitable specifically for them. Mirror existing threshold-blacklist pattern at signal-gen time.

**Cities passing (9):** CHI, SFO, DEN, PHX, MIA, HOU, LAX (0% hit rate), NY (3.41%), ATL (2.27%).

**Output:** `docs/work/hot-side-viability-2026-05-03.md` (full report)

**Phase 4 implementation scope (NOT EXECUTED — separate work item):**

1. `src/lib/computeOpportunities.ts:72` — generalize `TAIL_SELL_DIRECTION` to support both directions
2. Bracket comparison flips for hot-side branch (lines 325-327, 374-376)
3. New env flag `HOT_TAIL_HIGH_MODE = 'off' | 'paper' | 'live'` (default off, mirror `LOW_TEMP_WARM_TAIL_MODE` pattern)
4. Per-city blacklist for hot-side at signal-gen time (7 cities listed above)
5. Reuse `direction: 'warm'` for hot-side high (existing schema; semantically: above-forecast across both market types)
6. CLAUDE.md env var documentation

**Recommended deployment sequence:**

- Implement Phase 4 (~1-2 days)
- Deploy with `HOT_TAIL_HIGH_MODE=paper` (zero real-money risk during validation)
- Wait for 30+ paper-resolved hot-side trades
- Re-audit paper P&L; if matches viability prediction, flip to `HOT_TAIL_HIGH_MODE=live`

**Caveats to document at deploy:**

- Clean-era data covers spring only — peak summer heat-wave behavior not yet sampled. Re-validate after first summer.
- Position cap discipline is load-bearing. Any future change to MAX_NE_CORRIDOR or MAX_PER_CITY_TYPE must re-run this viability check.
- 7-city blacklist is climate-regime-driven (Texas + NE corridor heat-wave susceptibility); may shift seasonally — re-evaluate per-city gate after summer.

---

### Atmospheric data ingestion — Phase 0 (2026-05-03)

**What shipped:** `SourcePredictionSnapshot` extended with optional `perSourceAtmosphere` field carrying per-source **peak-hour-aggregated** atmospheric features (12-16 local for high markets, 04-08 local for low markets), plus pre-peak 24h cumulative precipitation and 6h pressure delta. New `extractPerSourcePeakHourAtmosphere()` utility in `dailyForecasts.ts`. Persisted by `captureServerSideForecasts()` alongside per-source temps. Pure write-only — no current readers.

**Captured per source (when available):** `cloudCover`, `cloudCoverLow/Mid/High`, `humidity`, `dewPoint`, `pressure`, `windSpeed`, `windGust`, `uvIndex`, `prePeakPrecip24h`, `prePeak6hPressureDelta`, `rowsInWindow`. Hourly forecasts only — daily aggregates excluded to prevent contaminating peak-window means.

**Coverage reality (verified production audit, 9 cities, 2026-05-03):**
- **Open-Meteo:** 100% on every variable (only fully-populated source, blends ECMWF/GFS)
- **NWS:** 100% on cloud/humidity/dewpoint/wind, 12% on pressure, no UV or layered cloud
- **Google-Weather:** 100% on cloud/humidity/wind/UV, 83% on dewpoint, no pressure
- **AccuWeather:** 100% cloud/humidity/wind/UV, **no dewpoint or pressure** — and daily-only data so will yield empty atmospheric snapshots until they expose hourly
- **Tomorrow.io:** intermittent (rate-limited at 25/hr free tier; appears in ~half of capture cycles, fully populated when present)

**Why — testable hypothesis:**

> **H1:** For each source S, the residual error `(forecast_Tmax_S − actual_Tmax)` correlates with one or more **peak-hour atmospheric covariates** (cloud cover, wind, dewpoint, humidity) **OR pre-peak features** (24h cumulative precip, 6h pressure delta) that NWP physics + each source's post-processing did not fully encode. Statistically: |r| > 0.15 at p<0.01, R² ≥ 10%.
>
> **H2:** A regression model trained on `(atmospheric_covariates, source) → residual` produces out-of-sample ensemble-MAE reduction of ≥0.2°F when applied at forecast-issue time **AND** measurably improves tail-sell trigger reliability (volume increase or win-rate lift) on conditionally-biased days.

**Mechanism (per the user's intuition):** A daily Tmax forecast issued at T-24h is the output of an NWP run at T-26 to T-30h. Atmospheric conditions in the **2-4 hours prior to peak temp** (cloud cover at peak insolation, wind speed at peak, recent precipitation) modulate the actual Tmax. NWP models propagate these forward via internal physics, but each source's post-processing layer may leave residual conditional bias. Strongest known drivers in the literature are reference points only — magnitude depends entirely on whether each source's particular post-processing has already absorbed them.

**Profitability connection (modest, not theatrical):** Tail-sell triggers on ≥6°F bracket distance from our point forecast. If atmospheric conditioning reduces ensemble MAE 0.2-0.3°F, expected effects:
- Marginal increase in signal volume on conditionally-biased days (currently-skipped 5.5°F brackets become eligible)
- Win rate movement of 0-1 percentage points (the dominant loss mode is unexpected extreme weather, not 0.3°F forecast error)

Honest expectation: small lift, not transformative. The primary justification is hypothesis validation; tail-sell improvement is a bonus.

**Decision gate — TWO-STAGE design (revised 2026-05-03):**

Power calculation drove the redesign. For univariate r=0.15 detection at p<0.01 with 80% power, we need n≈350-400 observations. Open-Meteo accumulates ~34 rows/day post-deploy → n=350 reached in ~10 days, n=1000 in ~30 days. **Pooled hypothesis testing has power within 30 days.** 60-90 days only matters for stratified analysis (per city × type × lead × covariate quartile).

**Stage 1 — Interim review at 2026-06-02 (deploy + 30 days):**

Pooled univariate EDA. For each (source × atmospheric covariate) pair:
- Compute Pearson r between source residuals and Open-Meteo's atmospheric covariate at the captured peak hour
- Track p-value, n

**Stage 1 outcomes:**
- **Clear positive signal:** |r| > 0.20 at p < 0.01 on 2+ pairs → continue accumulating; full regression refit at **+60 days (2026-07-02), NOT +90**. Saves a month.
- **Clear null:** no pair shows |r| > 0.10 → **drop early, document the null result.** Saves 60 days of waiting.
- **Ambiguous:** any |r| in 0.10-0.20 range → continue to **Stage 2 at +90 days** (2026-08-01) for stratified analysis with full statistical power.

**Stage 2 (only if Stage 1 was ambiguous) — Full review at 2026-08-01:**

1. **Population check:** ≥80% of `source_prediction_snapshots` written since deploy carry non-null `perSourceAtmosphere` for at least Open-Meteo
2. **Per-source coverage check:** ≥30 resolved cells per stratum we plan to test
3. **Stratified EDA:** by city × marketType × leadBucket × covariate quartile
4. **Regression cross-validation gate:** held-out ensemble MAE drops ≥0.2°F **AND** simulated tail-sell trigger reliability improves. Both must pass.

**Decision rules at Stage 2:**
- All gates pass → ship Phase 1 (regime classifier) + Phase 2 (refit μ/σ per regime). 2-3 days of work.
- Population/coverage fail → hold, revisit at +120 days
- Stratified EDA fails → null result, document, drop
- EDA passes but cross-validation fails → signal exists but not enough lift; document partial finding, drop production rollout

**Weekly status check reminders (lightweight — 5 min, not full analysis):**

- [x] **Week 1 — 2026-05-10:** verify writer healthy. Query `source_prediction_snapshots` for snapshots written in last 7 days with `atmosphereCapturedAt`. Confirm Open-Meteo coverage ≥95%, no schema errors in pm2 logs. **Run early 2026-05-09: PASS.** 192 atm-tagged snapshots in last 7d, Open-Meteo 99.0% (190/192), no PM2 schema errors. AW/TI at 0% (expected — daily-only / rate-limited). NWS at 40.6% and GW at 54.2% — lower than the 2026-05-03 baseline (which measured % of variables within an NWS entry, not % of rows containing NWS) but not a Week 1 blocker; revisit at Week 3 per-source coverage spot-check.
- [x] **Week 2 — 2026-05-17: PASS.** Cumulative atm-tagged since deploy = **448 ≥ 384** ✅ (margin +64). Writer healthy: 222 atm-tagged in last 7d (up from Week 1's 192), ~30.9/day; 0 snapshot/schema errors in 1605 PM2 log lines. **7d-vs-7d** (apples-to-apples with Week 1's 7d window): Open-Meteo 100.0% (gate ≥95% ✅), NWS 41.0% (Week 1 40.6% — stable, no regression), GW 50.0% (Week 1 54.2% — 4.2pp soft-watch, not material; API-physics-bounded). AW/TI 0% (structural). Note: the all-rows view shows NWS 31.9% / GW 67.8% — that is the documented metric-mismatch trap (546-row pop incl. 98 pre-deploy rows, 17.7d span); only the 7d-vs-7d cut is comparable to Week 1. Reusable check: `scripts/atm-phase0-health-check.ts` (re-run for Week 3/4). GW 7d-rate is the only soft-watch item for the Week 3 per-source spot-check.
- [x] **Week 3 — 2026-05-25: PASS.** Cumulative atm-tagged since deploy = **704 ≥ 384** ✅ (margin +320). Writer healthy: 222 atm-tagged in last 7d (matches Week 2 exactly), 31.3/day (Week 2: 30.9/day — stable). **7d-vs-7d** (apples-to-apples vs Week 1): Open-Meteo 95.5% (gate ≥95% ✅, slipped from Week 2's 100.0% — first time off the ceiling; watch in Week 4), NWS 38.3% (Week 1 40.6%, Week 2 41.0% — 2.3pp drift, within tolerance), Google-Weather **61.3%** (Week 1 54.2%, Week 2 50.0% — **GW −4.2pp soft-watch RESOLVED**, recovered +11.3pp from Week 2 and +7.1pp above Week 1 baseline). All-rows view (NWS 26.7% / GW 77.6% / OM 97.8%, n=802 over 25.6d) again diverges from the 7d cut — same documented metric-mismatch trap, not a flag. Re-ran `scripts/atm-phase0-health-check.ts` (still untracked in repo — scp'd to droplet for this run; commit pending so Week 4 doesn't need scp).
- [x] **Week 4 — 2026-05-31: PREP DONE.** All 3 deliverables run (read-only). **(1) Sample readiness — READY:** 848 OM-present snapshots since deploy, **2,439 joined residual×OM-atm pairs**; per-source max-n 453–560, all ≥350 power target. The 06-02 review has full pooled power. **(2) EDA dry-run (NO decision):** still tracking **CLEAR POSITIVE** but effects materially weaker than the 2026-05-13 day-10 preview — sample ~tripled and is now multi-regime (exactly day-10 caveat #2). **Humidity (+0.21→+0.34, all 5 sources, p<0.01) and UV (−0.22→−0.40, all 5, p<0.01) are the load-bearing cross-source-consistent dimensions**, both still |r|>0.20. Wind decayed from ~−0.3 into the 0.10–0.20 ambiguous band (GW −0.29 the lone >0.20 survivor); pressure/windGust mostly fell below 0.20 / non-sig; cloudCover/dewPoint null. ~11 pairs still clear the "2+ pairs |r|>0.20" CLEAR-POSITIVE bar (vs 25 at day-10). The shrinkage raises the **Stage-2-null risk** (weaker r → weaker expected held-out-MAE lift vs the +0.2°F bar). Reusable query: `scripts/atm-stage1-eda.ts`. **(3) OM ≥95% soft-watch — gate TECHNICALLY TRIPPED at 94.9% (7d, 203/214), but BENIGN:** all 11 OM-missing 7d rows are degraded single-source captures (only GW or only NWS present; ATL ×4 at capH=16), NOT OM-specific failures — the documented degraded-capture / late-overwrite tail. OM-when-capture-succeeds stays high; OM-missing rows are *excluded-not-corrupting* for the EDA, so the power estimate holds (confirmed by deliverable 1). No OM API drift, no warmup regression. Trajectory 99.0→100.0→95.5→94.9 is decelerating. **Recommendation: proceed to the 2026-06-02 Stage 1 review; the OM breach does not block.**
- [x] **Stage 1 interim review — DONE 2026-06-03: CLEAR POSITIVE, refit DEFERRED to ~2026-07-17.** Formal full-power pooled EDA (run on droplet, n=2,798 joined residual×OM-atm pairs; all 5 sources ≥350 power target). **Verdict: CLEAR POSITIVE** — gate is "≥2 pairs |r|>0.20, p<0.01"; we have **10** (humidity +0.20→+0.33 all 5 sources, uvIndex −0.24→−0.42 all 5, every one significant). Cross-source consistency holds (NWS/AW/TI residuals correlate with OM humidity/UV — not NWP autocorrelation). **But honest read: ~2 collinear dimensions, not 10** — humidity and UV are the same moisture/insolation axis (humid→cloudy→low UV); wind decayed to ambiguous (only GW −0.30 clears 0.20), pressure/cloud/dewpoint null. Effects weakened materially vs the 2026-05-13 day-10 preview (humidity ~+0.4→~+0.25), so H1's R²≥10% bar is now genuinely uncertain. **DECISION (2026-06-03): do NOT trigger the +60d regression refit now.** Rationale: (1) the only earning surface is tail-sell ~97% win; atm's sole trading consumer is the pre-trade atm gate predicting *losses*, which is loss-starved and unvalidatable until ~2026-07-17 (see `memory/risk-overlays-unvalidatable-2026-05-18.md`); (2) the forecast-MAE half feeds deprecated machinery (BMA/inner-bracket/YES); (3) waiting yields ~2× sample spanning summer regimes — a *better* dataset for the regression, and single-regime correlations are the ones that fragment. **Re-time the atm regression refit to ~2026-07-17** to coincide with the position-risk re-review (when a loss sample to validate a profitable consumer matures). Keep the ~free write-only ingestion running. Records: `memory/atm-stage-1-decision-2026-06-03.md`. **HTML-artifact note (2026-05-09):** Stage 1 produces ~20 univariate scatter/regression plots across source × covariate — that's the natural payoff candidate for one-shot HTML artifacts (per `https://thariqs.github.io/html-effectiveness/`). Earlier evaluation: the four-quadrant status panel and weekly Phase 0 health check don't earn HTML — current markdown/page renderings already surface the decision-relevant data. The general HTML-artifact pattern stays parked until a true exploration surface (Stage 1 EDA, future regime-detection scatter, or similar) shows up.

**Caveat — bounded ceiling:** five mature sources each apply MOS-style post-processing internally. The available signal at our aggregation layer is the *residual after their corrections* — plausibly **0-0.3°F MAE reduction**, not the 1-3°F numbers the raw-NWP literature describes. Realistic null-result probability is 50-60%, not 30%. Same falsifiable posture as late-day-arb.

**Lead-time alignment (revised 2026-05-03):** atmospheric data uses `$set` (not `$setOnInsert`) so it refreshes on every warmup. **The latest warmup before resolution captures the freshest atmospheric forecast** — near-peak lead, aligned with the user's hypothesis that "atmospheric conditions a couple hours prior to peak temp" carry the relevant signal.

Temps and metadata stay locked at first insert via `$setOnInsert` (existing pipeline contract — source weights, calibration training, tail-sell triggers all read from these fields). The mismatch is intentional: long-lead temp forecast + near-peak atmospheric forecast = "given a temp forecast made N days ago, do current atmospheric conditions predict the residual?" That is exactly the trade-time question.

`atmosphereCapturedAt` is recorded separately from `timestamp` so Phase 1 analysis can derive `(resolveTime - atmosphereCapturedAt)` to know the atmospheric capture lead per row.

**Caveat — per-source coverage gaps:**
- **AccuWeather:** daily-only data. Hourly-only filter excludes it from atmospheric capture. Will have temps but no AccuWeather atmospheric snapshots. Test approach: use Open-Meteo's atmospheric profile to predict AccuWeather residuals (cross-source).
- **NWS pressure:** 12% population. Pressure-trend hypothesis cannot be tested using NWS pressure data; use Open-Meteo as canonical pressure-trend source.
- **`prePeak6hPressureDelta`:** only fully populated for Open-Meteo (hourly pressure availability).
- **Tomorrow.io:** intermittent due to free-tier 25/hr rate limit. Appears in ~half of captures. Statistically still usable.

**What this does NOT do:** does not feed BMA, μ correction, σ tables, calibration, weights, or any read path. Behavior of `/weather-forecast`, `/trading-readiness`, calibration training, and tail-sell signals is unchanged.

---

### Future investigation — long-lead capture semantics in source_prediction_snapshots (2026-05-03)

**Finding surfaced during Phase 0 review:** `captureServerSideForecasts()` uses `$setOnInsert` so each `(city, date, type)` tuple captures forecasts ONCE, at the longest-lead warmup that first sees the target date in its rolling 5-day window. This means:

- All captured per-source temperature forecasts are at ~60-120h lead on average
- `source_accuracy.error` records long-lead residuals
- Dynamic weights are computed from long-lead skill
- Calibration training data uses long-lead residuals

But trading happens at ~24h lead. Tail-sell triggers, probability-model calls (when active), and the user-facing `/weather-forecast` page all read **short-lead** forecasts that are never captured into snapshots. **Source weights derived from long-lead skill are being applied to short-lead trade-time forecasts.** Source ranking can vary with lead time — this misalignment may be costing accuracy.

**Investigation scope (NOT committed; separate project):**
1. Quantify the misalignment: pull short-lead vs long-lead per-source MAE across the same set of resolved markets. Does NWS rank 1st at both lead horizons or only one?
2. If meaningful divergence exists: design a focused change that captures forecasts at multiple lead-time buckets (e.g., add `leadBucket` to the synthetic signalId, accept that we'd have N×5 snapshots instead of N).
3. Validate that switching to short-lead-derived weights doesn't break the existing tail-sell trigger reliability (this IS the one strategy that's earning).

**Why deferred:** changing capture semantics affects source weights, calibration training, and tail-sell. Bundling with Phase 0 (write-only atmospheric ingestion) would couple two unrelated systemic changes and accrue real tech debt. Investigate as its own focused project once Phase 0 has run for a few weeks.

---

### Update 2026-05-02 (final) — `/weather-analytics` retired

**What changed:** Deleted the `/weather-analytics` page, `useAnalytics` hook, and three chart components (`ReliabilityDiagram`, `ROICurve`, `EdgeDistribution`). Removed nav link from `Layout.tsx`. Updated README. Net ~1,050 LOC removed.

**Why:** The page was probability-model calibration diagnostics for a model whose outputs we just retired from `/weather-forecast`. The actual diagnostic workflow runs through skills (`/audit-brier`, `/check-calibration`) which produce equivalent or richer text-form metrics. The page hadn't been our reference during today's diagnostic work — we ran the skills.

**Workflow forward:** When we need calibration diagnostics — Brier scores, reliability binning, decay status, per-bucket P&L — run `/audit-brier [since-date]` or `/check-calibration [since-date]`. Both skills produce markdown reports, accept time-window arguments, and don't require maintaining a UI surface.

**What stays:** `/api/weather/performance` endpoint (consumed by tests, documented in README). The `?view=analytics` branch in its handler is now dead code — flagged for a future hygiene sweep.

---

### Update 2026-05-02 (evening, later still) — `/weather-forecast` trading overlay retired

**What changed:** Stripped probability-model trading recommendations from the user-facing `/weather-forecast` page. Removed `MarketOpportunitiesTable`, `TradingStrategiesTable`, `SignalsDisclaimer`, the "Trading Opportunities" section divider, and the bias-correction annotations on `WeatherHeroCard` + `TemperatureGraph`. The forecast itself (5-source ensemble, hourly, 7-day, atmospheric variables, temperature graph) is unchanged.

**Why:** the probability-model pipeline is unprofitable (-$297 hypothetical P&L on 179 resolved NO bets). Surfacing buy/sell recommendations from a model that loses money is misleading even to ourselves. The forecast is a perfectly fine product on its own — the broken piece was the probability-derivation step, not the forecasts. Page bundle size shrunk 32.4 → 25.6 kB (-21%).

**What stays running:** `/api/weather/opportunities` endpoint still serves the `/trading-readiness` audit-trail data, still writes to `signals` + `market_predictions` for the YES moratorium-lift experiment. Probability model + calibration + BMA + bias-correction pipelines all still execute internally — just not displayed on the user-facing page. Components themselves (`MarketOpportunitiesTable.tsx`, etc.) kept in the repo for potential future admin/debug view.

**Out-of-scope follow-ups:**
- Surface real `tail_sell_signals` (the proven, profitable strategy) on `/weather-forecast` as "Today's Tail-Sell Candidates" — separate scope.
- Build a `/admin/opportunities` view (or `?debug=1` query param) reusing the now-unconsumed components — separate scope.
- Hygiene: delete the unconsumed component files in 1-2 weeks if no admin view emerges.

---

### Update 2026-05-02 (later) — Sweet Spot retired + hypothetical P&L wired

**Sweet Spot Strategy section removed** from `/trading-readiness`. Designed in late April as the "Phase 3 inner-bracket automation" go-live gate, but Phase 3 was never queued and probability-model signals remained advisory-only — the gate had nothing to inform. Final state was 0 trades in 20-30¢ (regime absent) + 63 trades in 30-50¢ at BSS -0.385 / 41.3% win / -$13.72 net (`viable=false`). Cache prefix bumped `trading-readiness:v5` → `:v6`. Spec file `docs/work/sweet-spot-gates-refresh-spec.md` left in repo with retirement marker (historical record). The unrelated `MarketOpportunitiesTable.tsx` SWEET_SPOT_* filter constants stay (24-36h/20-50¢ NO opportunity-table chip is independent UX).

**Hypothetical P&L added** to Probability-Model Signals. New formula `hypotheticalPnlPerContract(direction, marketPrice, outcome)` generalizes tail-sell's pricing to both YES and NO directions: `cost = direction==='YES' ? marketPrice : (1-marketPrice)`; `won` flag depends on direction; `pnl = won ? (1-cost)*(1-fee) : -cost`. Position size $10 flat. New API summary fields: `totalPnl`, `yesPnl`, `noPnl`, `positionSize`. UI: 8 summary cards now include YES P&L / NO P&L (replacing redundant Wins/Losses cards), calendar shows colored $P&L per day instead of win-rate %, audit table has P&L column at right. Banner updated to clarify P&L is hypothetical, not executed.

**Watch-item refinement.** The 40% / 20-40% / <20% YES win-rate decision rules (added earlier today) may be too coarse once P&L data is visible. Breakeven win rate depends on the marketPrice distribution — YES at ~20¢ needs ~22% win rate to break even after fees, YES at ~40¢ needs ~52%. After 30+ resolved YES, re-evaluate thresholds against actual hypothetical P&L. Out of scope for this batch.

---

## Warm-tail paper-mode launch + Daily P&L Calendar (DEPLOYED 2026-04-29, env flipped same day)

**Origin:** User asked "are we paper-trading low-temps right now or capturing that information?" Audit revealed forecast/snapshot data was capturing for low-temp markets, but no paper-trade record existed. Paper-mode infrastructure shipped commit `731e0b9` then env flipped to `paper` evening of Apr 29. Daily P&L Calendar shipped commit `1895fab` to address user's "scrolling every trade" UX complaint.

### What's now live

- **`LOW_TEMP_WARM_TAIL_MODE=paper`** on droplet — warm-tail signals generate, tag `mode='paper'` on the record, naturally resolve via `resolve-markets` cron, get computed (would-have) P&L. `execute-tail-sells.ts` skips them entirely; no Kalshi orders placed.
- **Separate live/paper budgets** — paper signals respect MAX_PER_CITY_TYPE=2 / MAX_PER_CITY=3 / MAX_TOTAL=8 caps independently. Paper does NOT displace live; live circuit breaker doesn't suppress paper.
- **Paper P&L formula** — same as live: `bracketHit ? -(1 - yesPrice) : yesPrice * (1 - DEFAULT_FEE_RATE)`. `actualF`/`actualFKind` derivation works for paper records (inherits the `ccf6afd` fix).
- **UI** — dedicated "Paper Trades — Warm-Tail Shadow" section on `/trading-readiness` with summary cards + amber-bordered audit table. Daily P&L Calendar appears above both live + paper audit trails (last 14 days, click to filter).

### First captured (2026-04-30 morning)

8 paper signals, all warm direction, all targeting Apr 29 daily-low resolutions:
- HOU `72-73°F` ±3, `≥73°F` ±4 (forecast 66.5°)
- DAL `≥60°F` ±3 (forecast 55.6°)
- SF `≥54°F` ±2 (forecast 50.2°)
- MIA `≥73°F` ±3 (forecast 68.4°)
- AUS `66-67°F` ±4 (forecast 59.2°)
- CHI `≥42°F` ±3 (forecast 37.6°)
- NY `50-51°F` ±3 (forecast 44.2°)

YES prices 6-19¢ — all in the 5-20¢ strategy band.

### Watch item — first 10 paper trade resolutions

- [ ] **Today (Apr 30)** — verify the 10:00 / 16:00 / 22:00 UTC `resolve-markets` crons resolve the Apr 29 events and update paper records correctly. Expected post-resolution state per record:
  - `result` = 'win' or 'loss'
  - `pnl` non-zero (paper P&L computed via the new `isPaper` branch)
  - `actualF` set (exact midpoint when inner-winner, `bracketCapF`/`bracketFloorF` bound when threshold-winner)
  - `actualFKind` matches the kind: 'exact' | 'le' | 'ge'
- [ ] After resolution, query: `db.tail_sell_signals.find({ mode: 'paper', result: { $in: ['win', 'loss'] } }).forEach(r => print(r.cityCode, r.result, 'pnl=' + r.pnl, 'actualF=' + r.actualF, 'kind=' + r.actualFKind))`. Spot-check ≥5 rows for sanity.
- [ ] Confirm UI renders correctly — Daily P&L Calendar should populate Apr 29 column with the resolved W-L counts + colored P&L. Audit table rows should show `≥X°F` for warm-tail losses.
- [ ] **Anomaly trigger:** if any paper record has `pnl=0` post-resolution while `result≠pending`, the `isPaper` branch isn't firing — investigate immediately.

### Forward path (gated on validation)

After ~10-20 paper trades resolve cleanly, decision options:

1. **Continue paper-only** — accumulate sample for the eventual flip-to-live decision. Default path.
2. **Tighten warm-tail filters** — if early paper signals show concerning loss patterns, may want to raise the inner distance threshold from 5°F or tighten YES price band.
3. **Flip to live** — requires (a) ≥30 paper resolutions with credible win rate, (b) `scripts/execute-tail-sells.ts` POSITION_SIZE hardcode fix (filed gap, ~3 LOC), (c) explicit user approval. Not on near-term timeline.

---

## Item B follow-on phases — SUPERSEDED 2026-05-04

The following sections were removed when BMA went into maintenance-only mode (see `memory/bma-deprecation-decision-2026-05-04.md` and BMA deprecation tracker section below):

- **Phase 1.5: σ retune to debiased values** — debiased σ refit (NWS -4% / AW -12% / OM -12% / GW -40% / TI -25% on 24to48h:high inner, per `memory/item-b-summary-2026-04-14.md`). Tuning a system slated for deletion.
- **Shadow validation period (warm-tail)** — superseded by `LOW_TEMP_WARM_TAIL_MODE=paper` deployment 2026-04-29; paper-mode IS the validation surface now.
- **Limited city rollout (ATL/MIA/LAX)** + **All-cities rollout at $5** + **Position size raise to $10** — entire warm-tail rollout chain was premised on the shadow→live promotion path; paper-mode replaced it. Live promotion (if any) will be a separate decision driven by paper-mode results, not via this preset chain.
- **Phase 3: Calibration retrain** — calibration model is part of BMA; deletion plan Phase 4 (~2026-06-04 onward) handles single-Normal recalibration on the post-BMA stack.
- **Final evaluation (Item B retrospective)** — Item B program closed; retrospective folded into the BMA deprecation decision memory.

If any of this needs to be revived, recover from git history (commits before 2026-05-09).

---

## Deferred work (NOT on this checklist's timeline)

- **Phase 4:** Per-city σ multipliers — **DEPRECATED 2026-05-04 — NOT PURSUING.** Orphaned tuning for a retired strategy. See `memory/bma-deprecation-decision-2026-05-04.md`. Reference: `memory/item-b3-per-city-sigma-2026-04-14.md` (archived).
- **Phase 5:** Inner weight rebalance to empirical inverse-MAE — **DEPRECATED 2026-05-04 — NOT PURSUING.** Orphaned tuning for a retired strategy. See `memory/bma-deprecation-decision-2026-05-04.md`. Reference: `memory/item-b4-regime-weights-2026-04-14.md` (archived).
- **Phase 2b:** Atmospheric variable storage schema — superseded by atmospheric Phase 0 ingestion (LIVE 2026-05-03; +30-day interim review on 2026-06-02).
- **Phase 3 (atmos):** Atmospheric variable bias correction model — replaced by feature-conditional model decision pending Phase 0 EDA outcome. BMA-extension path is dead.
- **API + x402:** Strategic conversation about forecast product — independent track, no Item B dependency.

---

## BMA deprecation tracker (LIVE 2026-05-04)

**Decision:** BMA in maintenance-only mode. Deletion scheduled post-experiments (~2026-06-04 onward). See plan `.claude/plans/okay-today-is-april-concurrent-stearns.md` and `memory/bma-deprecation-decision-2026-05-04.md`.

### Today (zero code)
- [x] Cancel Item B Phase 4-5 (marked DEPRECATED above)
- [x] CLAUDE.md note: BMA maintenance-only
- [x] Memory file documenting decision

### Pre-deletion gates — ALL CLEARED 2026-06-03 → BMA DELETION IS GO
- [x] **YES moratorium-lift: 30+ resolved YES trades — CLEARED (~200×).** Verified 2026-06-03: **6,129 resolved YES-side trades** since the 2026-05-02 flip (STRONG_YES 4,174 + YES 1,955 in `market_predictions` by `tradeSignal`, resolved). NB: prior timelines read "0 resolved/STALLED" — that was a collection error (resolution lives in `market_predictions`, not `signals`). Outcome documented + confirmatory-NEGATIVE: μ corrections did not fix the YES asymmetry (BSS ~−0.50; 0.9-1.0 bin 92% predicted/20% actual). See `memory/yes-experiment-early-signal-2026-05-06.md`.
- [x] **Atmospheric Phase 0 +30-day interim review — DONE 2026-06-03.** CLEAR POSITIVE but refit deferred to ~2026-07-17 (see Phase 0 section above). **Critically: atm positivity does NOT block BMA deletion** — the next model class is feature-conditional regression (XGBoost/quantile on residuals), NOT a BMA extension; the BMA bones don't transfer (per `memory/bma-deprecation-decision-2026-05-04.md`).
- [x] No new BMA-consuming experiments started in the interim — confirmed.
- [ ] Run `/audit-brier` and `/check-calibration` weekly; do not tune

### Deletion phase (~2026-06-04 onward) — CLEAR TO PROCEED (all gates above met 2026-06-03)
- [ ] Phase 1 — equivalence proof: new `pointForecast.ts` (weighted mean + spread) parallel to BMA, verify byte-equivalent on 10×3 sample
- [ ] Phase 2 — feature flag flip + 24h monitor (cold-side HIGH live ≥4/day, /trading-readiness unchanged)
- [ ] Phase 3 — delete `forecastDistribution.ts`, BMA-specific code in `weatherProbability.ts` + `distributions.ts`, BMA tests
- [ ] Phase 4 — calibration retrain on single-Normal probabilities; document new BSS baseline in `memory/post-bma-deprecation-baseline.md`

---

## Pre-Trade Atmospheric Risk Gate (LIVE 2026-05-04 in shadow)

**Branch:** `feat/pre-trade-atm-gate`
**Plan:** `.claude/plans/okay-today-is-april-concurrent-stearns.md` (LOCKED 2026-05-04)
**Env flag:** `PRE_TRADE_ATM_GATE_MODE` — `off` (default) | `shadow` | `active`

### Implementation summary

- `classifyPositionRisk` extended with optional `AtmosphericRiskInputs` (peakCloudCoverMean, peakHumidityMean, peakWindGustMax, prePeakPrecip24hMean) — backward-compatible, post-trade monitor unaffected.
- Pre-trade gate in `src/lib/computeOpportunities.ts` runs AFTER all four `generate*Signals()` calls but BEFORE `logTailSellSignals`. Single decision point, fail-open on classifier exceptions.
- Live cold-side HIGH (cold + high tuple) is NEVER suppressed — mechanical protection, shadow log only.
- Paper quadrants suppressed when mode=`active`; shadow-logged only when mode=`shadow`/`off`.
- Trigger metadata persisted to `tail_sell_signals.atmosphericTriggers` for emitted signals (forensic join with resolution outcomes).
- Drift classifier bug fixed in same commit (line 148: `-rawDriftF * sign` → `rawDriftF * sign`).

### Trigger thresholds (initial, literature-derived)

| Quadrant | Trigger | Threshold |
|---|---|---|
| Cold-side HIGH (live) | peak cloud > X% | 70 |
| Cold-side HIGH (live) | pre-peak precip > X in | 0.25 |
| Hot-side HIGH (paper) | peak cloud < X% (primary) | 20 |
| Hot-side HIGH (paper) | cloud < 30% AND precip < 0.05in (confirmatory) | combo |
| Warm-tail LOW (paper) | peak cloud > X% | 70 |
| Cold-tail LOW (paper) | peak cloud < X% | 20 |

Two WARN flags on the same signal → CRITICAL via existing multi-warn rule.

### Rollout sequence

- [x] Phase A: Extend `classifyPositionRisk` + drift bug fix + 22 unit tests passing
- [x] Phase B: Env flag reader + `getPreTradeAtmGateMode()`
- [x] Phase C: Pre-trade filter loop with fail-open + atmospheric inputs aggregator
- [x] Phase D: Persist `atmosphericTriggers` to `tail_sell_signals` collection
- [x] Phase E: CLAUDE.md + working-checklist + branch ready
- [ ] Deploy as `PRE_TRADE_ATM_GATE_MODE=off` first (zero behavior change beyond drift bug fix)
- [ ] After 24h confirming no regression on cold-side HIGH live volume (≥4/day baseline 5.71/day): flip to `shadow`
- [ ] Monitor `[risk-shadow]` log lines for 24-48h: confirm trigger rate <30% paper signals
- [ ] **+14 days minimum** in shadow before considering `active` for paper quadrants
- [x] Phase F: Validation (2026-05-18, +14d) — **DECISION: NO FLIP, all paper quadrants stay shadow.** No quadrant clears ≥2x. n=122 resolved paper since 2026-05-04; tagging actually began 2026-05-08 (off→shadow ramp) so effectively +10d. warm/low triggered 1/13 (8%) vs clean 3/55 (5%) = 1.4x (<2x). warm/high 0/5 vs 0/15 (no losses). cold/low triggered 1/4 (25%) vs clean 0/30 — directional but n=4 anecdote. Same structural problem as the monitor: ~4 losses total can't measure a 2x effect. Regression checks green: 0 `[risk-gate]` exceptions, cold-side HIGH live 4.43/day (>4 floor; ~22% below 5.71 baseline = benign seasonality), `[risk-shadow]` actively logging. **Re-run forensic at +30d (~2026-06-07)** when more losses accrue. Reusable: `scripts/position-risk-and-atm-gate-review.ts`.
- [ ] ~~If triggered signals lose at >2x rate → flip paper to `active`~~ — NOT met at +14d (see above). Live cold-side HIGH stays shadow-only forever (unchanged).

### Regression checks (post-deploy)

- [ ] `tail_sell_signals` write rate ≥4/day for cold-side HIGH live (5.71/day baseline)
- [ ] No uncaught exceptions in PM2 logs from `[risk-gate]` lines
- [ ] `atmosphericTriggers` field populated on emitted signals where atm triggers fired

### Validation commands

#### 1. Cold-side HIGH live volume — 24h regression check (run +24h post-deploy)

Rollback trigger: sustained <4/day. Baseline 5.71/day.

```bash
ssh root@104.248.223.48 "cd /var/www/kardashev && MONGODB_URI=\$(grep '^MONGO_CONNECTION_STRING=' .env.local | cut -d= -f2-) && mongosh \"\$MONGODB_URI\" --quiet --eval '
const kdb = db.getSiblingDB(\"kardashev\");
const dayMs = 86400000;
const since = Date.now() - dayMs;
const liveCH = kdb.tail_sell_signals.countDocuments({
  direction: \"cold\", temperatureType: \"high\",
  \$or: [{ mode: \"live\" }, { mode: { \$exists: false } }],
  timestamp: { \$gte: since }
});
print(\"cold-side HIGH live last 24h: \" + liveCH + \" (baseline 5.71/day; rollback if <4)\");
'"
```

#### 2. `[risk-gate]` exception count (fail-open path) — should be 0

```bash
ssh root@104.248.223.48 "pm2 logs kardashev-web --nostream --lines 2000 2>/dev/null | grep -c '\[risk-gate\]' || echo 0"
```

Non-zero = classifier threw on at least one signal. Investigate the log line to find which call site / which signal failed.

#### 3. Drift bug fix activation check (off mode)

The drift fix means the post-trade monitor's drift WARN/CRITICAL triggers will fire on cold-side adverse drift — they were silently broken before. Expect to see new drift triggers in PM2 logs and Telegram alerts.

```bash
ssh root@104.248.223.48 "pm2 logs kardashev-position-monitor --nostream --lines 500 2>/dev/null | grep -E 'drift.*adverse'"
```

Empty result before 2026-05-04 was the bug. Now should populate as cold-side positions drift.

#### 4. Trigger rate on paper signals (run +24-48h after `shadow` flip)

```bash
ssh root@104.248.223.48 "pm2 logs kardashev-web --nostream --lines 5000 2>/dev/null | grep -E '\[risk-(shadow|suppress)\]' | awk '
/would-have-suppressed/ { triggered++ }
/risk-shadow/ && /paper|warm|cold-tail|hot-tail/ { paperSeen++ }
END {
  if (paperSeen > 0) printf(\"trigger rate: %d/%d (%.0f%%) — want <30%%\\n\", triggered, paperSeen, 100*triggered/paperSeen);
  else print \"no paper signals seen in window\";
}'"
```

Trigger rate >50% → thresholds too aggressive; tighten before considering active. <5% → not enough signal to validate; widen window.

#### 5. `atmosphericTriggers` field population spot-check

**Note:** filter MUST use `$type: 'array'` + `$not: $size: 0` because plain `$ne: []` also matches `null` field values (Mongo treats `null != []`). Pre-fix-2026-05-06 records may have `atmosphericTriggers: null` from undefined-as-null persistence; those should NOT count as real trigger firings.

```bash
ssh root@104.248.223.48 "cd /var/www/kardashev && MONGODB_URI=\$(grep '^MONGO_CONNECTION_STRING=' .env.local | cut -d= -f2-) && mongosh \"\$MONGODB_URI\" --quiet --eval '
const kdb = db.getSiblingDB(\"kardashev\");
const realFilter = { atmosphericTriggers: { \$exists: true, \$type: \"array\", \$not: { \$size: 0 } } };
const tagged = kdb.tail_sell_signals.countDocuments(realFilter);
const recent = kdb.tail_sell_signals.find(realFilter).sort({ timestamp: -1 }).limit(3).toArray();
print(\"signals with REAL (non-empty array) atm triggers: \" + tagged);
for (const r of recent) {
  print(\"  \" + new Date(r.timestamp).toISOString().slice(0,16) + \" \" + r.ticker + \" \" + r.direction + \"/\" + r.temperatureType + \" — \" + (r.atmosphericTriggers || []).join(\"; \"));
}
// Also report null contamination so we know if the writer fix has fully landed.
const nullContamination = kdb.tail_sell_signals.countDocuments({ atmosphericTriggers: { \$type: \"null\" } });
print(\"null-contamination (legacy pre-fix records): \" + nullContamination + \" (expected to drift toward 0 as legacy records resolve via TTL)\");
'"
```

#### 6. +14 day forensic analysis — triggered vs untriggered paper loss rates

The Phase F validation question. Run +14 days minimum after shadow flip. Promotion to `active` requires triggered signals losing at ≥2x the untriggered rate within the same quadrant.

```bash
ssh root@104.248.223.48 "cd /var/www/kardashev && MONGODB_URI=\$(grep '^MONGO_CONNECTION_STRING=' .env.local | cut -d= -f2-) && mongosh \"\$MONGODB_URI\" --quiet --eval '
const kdb = db.getSiblingDB(\"kardashev\");
// Set shadowStart to the timestamp of PRE_TRADE_ATM_GATE_MODE=shadow flip
const shadowStart = new Date(\"2026-05-XX\").getTime();
const rows = kdb.tail_sell_signals.find({
  result: { \$in: [\"win\", \"loss\"] },
  mode: \"paper\",
  timestamp: { \$gte: shadowStart }
}).toArray();
print(\"resolved paper signals since shadow start: \" + rows.length);
const groups = {};
for (const r of rows) {
  const q = r.direction + \"/\" + r.temperatureType;
  const tagged = (r.atmosphericTriggers || []).length > 0;
  const k = q + \" \" + (tagged ? \"TRIGGERED\" : \"clean\");
  if (!groups[k]) groups[k] = { total: 0, losses: 0 };
  groups[k].total++;
  if (r.result === \"loss\") groups[k].losses++;
}
print(\"\\nQuadrant            | Total | Losses | Loss rate\");
for (const [k, g] of Object.entries(groups).sort()) {
  print(k.padEnd(20) + \"| \" + String(g.total).padEnd(6) + \"| \" + String(g.losses).padEnd(7) + \"| \" + (100 * g.losses / g.total).toFixed(0) + \"%\");
}
print(\"\\nDecision rule: if TRIGGERED loss rate >= 2x clean loss rate within a quadrant → flip that quadrant'\\''s gate to active. Live cold-side HIGH stays shadow forever.\");
'"
```

### Rollback

Single env flag flip: `echo 'PRE_TRADE_ATM_GATE_MODE=off' >> .env.local && pm2 reload kardashev-web --update-env`. Drift bug fix is benign — no rollback needed for that piece.

