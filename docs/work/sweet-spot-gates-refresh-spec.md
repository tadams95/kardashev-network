# Sweet Spot Gate Refresh — Spec

Companion to `docs/working-checklist.md` (Tech debt cleanup → Sweet Spot UI refresh build).
Spec only — implementation deferred to next week, after Apr 27 `/audit-brier`.

## Dependency on Apr 27 audit-brier

This spec is **diagnostic infrastructure**: per-bucket cumulative +
rolling-7d BSS gates that surface whether the post-Phase-2 model is
viable for inner-bracket automation. The gates are useful regardless
of the audit outcome — they make the model state legible — but the
*priority* of building this depends on what the audit shows.

The Apr 27 `/audit-brier` is scheduled to evaluate post-Phase-2
performance in the 30-50¢ NO bucket. As of Phase 2 Day 5 (Apr 25),
active-model BSS was -0.27 with mixed signals. The audit will produce
one of three verdicts:

| Audit verdict | Implication for this spec |
|---|---|
| Some sign of life: at least one bucket has BSS ≥ -0.20 with positive trajectory | **PROCEED** — build per the spec. Gates will render meaningful state and converge on viable as the corpus grows. |
| Both buckets stuck at BSS ∈ [-0.30, -0.20] with no movement | **PROCEED but lower priority** — gates will render "underperforming" indefinitely; build is still useful as instrumentation but not a near-term unlock. |
| Catastrophic regression: BSS < -0.30 sustained, μ correction made things worse | **DEFER** — the model question dominates, gates are premature. Re-prioritize in favor of Phase 1.5 σ retune or partial μ rollback. |

The spec assumes the first or second verdict. If the third lands,
this work moves behind model-fix work in the queue.

**What "DEFER" actually entails.** A partial μ rollback isn't just a
config flip. The active calibration model `cal_1775184454578` was
trained on the post-normalization-fix corpus that already contained
the in-flight Phase 2 distortion (predictions logged from
`2026-04-20 23:15 UTC` onward used the new μ table). Rolling μ
correction back invalidates a slice of that training corpus and
forces a calibration retrain on the rebuilt clean-era. Practically:
DEFER means (a) shelve this spec, (b) flip
`MU_CORRECTION_ENABLED=false` via PM2 reload, (c) re-establish a
clean-era epoch in `memory/normalization-fix-2026-03-21.md`-style
boundary, (d) wait for ~200 new resolved predictions, (e) retrain
calibration. ETA on (d) is roughly 2-3 weeks at current cadence.
Worth being explicit so DEFER doesn't get treated as "low-effort
shelving."

## Context

The current `/trading-readiness` page renders three Go-Live gates for the
Sweet Spot strategy at `src/pages/trading-readiness.tsx:497-510` →
`SweetSpotSection` (line 261). Two findings from Apr 24-25 invalidate
the existing gate definitions:

1. **Regime mismatch.** The `bssAboveZero` gate counts BSS across the
   whole 20-40¢ NO range. Per the Apr 24 `/audit-brier` finding (working
   checklist line 411-419), the post-Phase-2 4-day window had **57
   predictions, all in 30-50¢, zero in 20-30¢**. The 20-30¢ regime is
   seasonally absent in late-April mild weather. The single-bucket gate
   silently averages two regimes that aren't both producing trades, and
   it never differentiates "20-30¢ ready" from "30-50¢ ready."
2. **Sample contamination.** The gate counts ALL clean-era trades
   (post-2026-03-21). Pre-Phase-2 trades are a different model (no μ
   correction). Mixing them masks the post-Phase-2 signal — the only
   sample that's actually decision-relevant once Phase 2 ships.
3. **No recency.** A cumulative BSS can stay positive for weeks while
   the rolling 7-day decays into negative territory. The gate has no
   way to surface late-stage decay.
4. **Dead `signalGeneration` gate.** Currently always `met: false` with
   manual-assessment placeholder text. Provides no information.

The viability monitoring section of `working-checklist.md` (line 442-447)
already names the correct trigger criteria for inner-bracket automation:

- 20-40¢ NO-side BSS > 0 on **30+ resolved trades since Phase 2 deploy**
- **Rolling 7-day** BSS in the active bucket also positive
- No regression on tail-sell

The gates on the page should mirror these criteria 1:1 so the UI is the
canonical place to read "are we ready to automate inner-bracket."

## Goals

- Per-bucket Go-Live gates: separate gates for **20-30¢ NO** and
  **30-50¢ NO**, each with its own BSS-positive criterion. Bucket
  labels match working-checklist usage (lines 411-447); see
  [Bucket boundaries](#bucket-boundaries) for filter details.
- **NO-only filter applied at gate evaluation.** Working-checklist
  viability criterion (line 442) is unambiguously NO-side. Per-bucket
  filter is `marketPrice ∈ bucket && direction === 'NO' && timestamp >=
  PHASE_2_DEPLOY_MS`. The trading hot-path does not pre-filter the
  historical `BacktestResult` corpus — the gate must filter explicitly.
- **Viability policy: either-clears AND no-other-actively-losing.**
  This is a deliberate softening of the working-checklist viability
  criterion (line 442: "20-40¢ NO-side BSS > 0 on 30+ resolved
  trades") — we split into per-bucket gates for diagnosis but, to
  avoid green-lighting automation while one bucket is actively
  bleeding money, we require the *other* bucket to either be
  sample-insufficient (regime absent or new) or not in deep
  underperformance.
  - `viable = (bucket20to30.bothMet || bucket30to50.bothMet) && !anyActivelyLosing`
  - `anyActivelyLosing = bucket.cumulativeMet === false && bucket.trades >= MIN_CUMULATIVE && bucket.cumulativeBSS < ACTIVELY_LOSING_THRESHOLD`
    where `ACTIVELY_LOSING_THRESHOLD = -0.05` (initially, see Decisions).
  - Inner-bracket trading hot-path doesn't perfectly partition by
    these buckets — there's likely some leakage at the 30¢ boundary
    from price drift between filter time and execution time. A bucket
    cleared by +0.024 BSS on 38 trades does not cleanly imply
    immunity if the adjacent bucket is at -0.18 on 47 trades.
  - `bothViable: boolean` (both `bothMet=true`) is exposed as an
    informational badge for stronger-conviction signaling.
  - `anyActivelyLosing: boolean` is exposed so the UI can render a
    distinct warning state when one bucket cleared but the other is
    actively losing — the rendered status differs from "viable" or
    "not ready."
- All gate evaluations filter to `timestamp >= PHASE_2_DEPLOY_MS` —
  the post-Phase-2 corpus is the only sample that decides the
  question.
- Add a **rolling 7-day BSS** gate per bucket — surfaces late-stage
  decay that cumulative-since-Phase-2 BSS would mask.
- Replace the dead `signalGeneration` gate with a meaningful
  **active-bucket signal** gate that reports which bucket(s) are
  currently producing trades and flags 0-trade buckets as "regime
  absent" rather than "not ready."
- Sample-size threshold raised to **30 post-Phase-2 trades per bucket**
  (matches working-checklist viability criterion). The original 50
  threshold was for cumulative clean-era samples; 30 post-Phase-2 is
  the correct floor for this strictly more recent corpus.

## Scope

### In scope

- New `SweetSpotGates` shape with per-bucket cumulative + rolling-7-day
  fields plus a regime-status field. See [Data model](#data-model) below.
- New `PHASE_2_DEPLOY_MS` constant in
  `src/pages/api/weather/trading-readiness.ts` (or shared constants
  module if there's a clean home — TBD during implementation; one-line
  decision). Defined as **`Date.UTC(2026, 3, 21, 0, 0, 0)`** —
  `2026-04-21 00:00 UTC`. Month is 0-indexed in JS (`3 = April`).
  - **Do NOT pre-bake the numeric epoch in this spec.** Both reviewers
    and authors of earlier drafts made arithmetic errors converting
    between the symbolic form and the millisecond literal. The source
    of truth is the symbolic `Date.UTC(...)` expression; the literal
    must be derived by the implementation runtime.
  - **Implementation prerequisite**: at the top of the constant's
    definition, add an `assert`-style check that
    `new Date(PHASE_2_DEPLOY_MS).toISOString()` returns
    `'2026-04-21T00:00:00.000Z'`. Fail loudly at module load if it
    doesn't. This prevents silent epoch drift from typos.
  - Phase 2 commit `8886f1f` was authored at `2026-04-20 23:15:40 UTC`.
    The deploy (pull + `npm install` + build + PM2 reload) typically
    lands within an hour of commit, so the actual cutover for new
    predictions is between 23:15 UTC Apr 20 and ~01:00 UTC Apr 21.
  - Rounding the boundary up to next UTC midnight (`2026-04-21
    00:00`) keeps the buffer simple and unambiguous. The first hour
    of Apr 21 may cost a few legitimate post-deploy trades if the
    deploy slipped past midnight; this is acceptable because the
    cumulative window is ≥6 days and a few-trade boundary fuzz
    doesn't move BSS materially.
  - **Implementation must verify the boundary catches no pre-Phase-2
    leakage.** Query the earliest `market_predictions` row where the
    Phase-2 μ-correction code path was active (identifiable by
    `correctedProbability` differing from `rawProbability` in a way
    consistent with the μ table — or, more simply, by
    `policyVersion`/`calibrationModelId` if a fingerprint was set at
    deploy). The check is one-directional: if that earliest row is
    **before** `00:00 Apr 21 UTC`, the constant is too high and
    pre-deploy data is leaking in — lower the constant to the
    earliest Phase-2 row. If the earliest row is **after** `00:00
    Apr 21 UTC` (e.g., `2026-04-21 00:42 UTC`), that's expected and
    acceptable — leave the constant at `Date.UTC(2026, 3, 21, 0, 0,
    0)`. The buffer is intentional; tightening it for a few extra
    trades isn't worth the precision-vs-clarity tradeoff. Document
    the verification result in the implementation PR description.
- Update `SweetSpotGates` interface in
  `src/hooks/useTradingReadiness.ts:50-54` to match new shape.
- Update `SweetSpotSection` component at
  `src/pages/trading-readiness.tsx:261-297` to render new gates.
- Bump trading-readiness cache key from `trading-readiness:v1` to
  `trading-readiness:v2` in
  `src/pages/api/weather/trading-readiness.ts:51` (response shape change).
- The gate **labels** must explicitly call out "post-Phase-2" in the
  text — without it, viewers will assume cumulative.

### Out of scope (deferred)

- Backend automation of inner-bracket trades when gates clear (separate
  workstream, only meaningful once gates actually clear).
- Tail-sell gate changes — the `TailSellGates` are independent and
  validated; this refresh touches Sweet Spot only.
- YES-side performance tracking. The viability criterion is NO-only;
  YES-side trades exist in the historical corpus but are not part of
  the trigger conditions for inner-bracket automation work. Filtered
  out at gate evaluation, see [Per-bucket filtering](#per-bucket-filtering).

### Bucket boundaries

Bucket labels in this spec match the working-checklist's usage
(`docs/working-checklist.md:411-447`): **20-30¢** and **30-50¢**.
The filter ranges are:

- 20-30¢ bucket: `marketPrice ∈ [0.20, 0.30)`
- 30-50¢ bucket: `marketPrice ∈ [0.30, 0.50]`

Two notes on the 30-50¢ range:

1. The Apr 24 hard-gate audit (`computeOpportunities.ts:698-700`)
   filters new signal generation at `midPrice <= 0.10 || midPrice >
   0.40`. **All post-Phase-2 trades therefore land in [0.30, 0.40] in
   practice** — the upper half of the 30-50¢ filter is empty for the
   post-Phase-2 corpus.
2. The 30-50¢ filter is kept (not tightened to 30-40¢) for two
   reasons: (a) consistency with working-checklist references, which
   are the source of truth for monitoring the watch item at line 444;
   (b) future-proofing if the >40¢ hard gate is ever loosened, the
   gate logic doesn't need a corresponding update.

## Data model

### New `SweetSpotGates` shape

Replaces the 3-field structure at
`src/hooks/useTradingReadiness.ts:50-54`.

```ts
export interface SweetSpotBucketGate {
  // Trade counts in this bucket since Phase 2 deploy.
  // All counts are NO-only (per viability criterion).
  trades: number               // total post-Phase-2 NO trades in bucket
  recentTrades: number         // post-Phase-2 NO trades in last 7 days

  // Cumulative-since-Phase-2 metrics
  cumulativeBSS: number | null    // null if trades < MIN_CUMULATIVE
  cumulativeWinRate: number | null
  cumulativeNetPnl: number

  // Rolling 7-day metrics
  rolling7dBSS: number | null     // null if recentTrades < MIN_ROLLING_7D
  rolling7dWinRate: number | null

  // Gate verdicts
  cumulativeMet: boolean        // trades >= 30 && cumulativeBSS > 0
  rolling7dMet: boolean         // recentTrades >= 20 && rolling7dBSS > 0
  bothMet: boolean              // cumulativeMet && rolling7dMet
}

export interface SweetSpotGates {
  // Per-bucket gates
  bucket20to30: SweetSpotBucketGate
  bucket30to50: SweetSpotBucketGate

  // Activity / regime status (replaces dead signalGeneration gate)
  activity: {
    activeBuckets: Array<'20-30' | '30-50'>  // buckets with >=1 post-Phase-2 NO trade
    description: string  // e.g., "Only 30-50¢ active (20-30¢ regime absent)"
  }

  // Composite verdicts (computed from per-bucket gates)
  viable: boolean              // either bucket bothMet AND !anyActivelyLosing
  bothViable: boolean          // both buckets bothMet — stronger conviction
  anyActivelyLosing: boolean   // any bucket has trades >= 30 && cumulativeBSS < -0.05

  // Phase 2 deploy reference (so UI can render "since YYYY-MM-DD")
  phase2DeployMs: number
}
```

### Named thresholds

| Constant | Value | Why |
|---|---|---|
| `MIN_CUMULATIVE` | 30 | Working-checklist viability criterion (line 442) |
| `MIN_ROLLING_7D` | 20 | See statistical justification below |
| `ACTIVELY_LOSING_THRESHOLD` | -0.05 | BSS floor below which a non-cleared bucket vetoes the `viable` flag — see Goals for rationale |

All three defined at top of `trading-readiness.ts` as named consts so
they can be tuned without code-pattern hunting.

**`MIN_ROLLING_7D=20` justification.** Per-trade Brier variance is on
the order of 0.25 (binary outcomes near p≈0.5). The standard error on
the mean Brier across n trades scales as `~1/√n`, so doubling the
sample roughly halves the noise on the rolling-7d Brier estimate.

The rigorous SE-on-BSS calculation depends on the joint distribution
of model and market predictions and isn't cleanly derivable from
Brier-only inputs. The qualitative argument is what matters: at n=10
the rolling-7d BSS sign would flicker week-to-week even when the
underlying skill is stable (false signals in both directions); at n=20
the noise floor is roughly halved and the gate only fires when BSS is
reliably > 0.

Tradeoff: a bucket with low daily volume may not accumulate 20
rolling-7d trades, in which case `rolling7dMet=false`
(sample-insufficient, not failure). That's correct behavior — we
don't want the gate to clear on weak evidence.

**Implementation may want to bootstrap-validate** the threshold
choice once there's enough post-Phase-2 data: take the existing
post-Phase-2 corpus, resample 1000× at n=10 vs n=20, count the
fraction of resamples where BSS sign disagrees with the full-sample
BSS sign. If n=20 doesn't materially reduce the disagreement rate
relative to n=10, the threshold should be raised further.

### Gate verdicts

Three composite verdicts at the gate level:

- **`viable`** — eligible to trigger inner-bracket automation work.
  Requires *either* bucket has `bothMet: true` (cumulative-since-Phase-2
  BSS > 0 on 30+ NO trades AND rolling 7-day BSS > 0 on 20+ NO trades),
  AND no bucket is `anyActivelyLosing`. See Goals for rationale on the
  no-other-losing constraint.
- **`bothViable`** — both buckets have `bothMet: true`. Informational
  badge for stronger-conviction signaling. Strictly stronger than
  `viable`: `bothViable === true` implies `viable === true`, because
  if both buckets have `bothMet=true` then both have
  `cumulativeMet=true` (a precondition of `bothMet`), so neither
  bucket can be `anyActivelyLosing` (which requires
  `cumulativeMet=false`), so the `!anyActivelyLosing` clause of
  `viable` is satisfied automatically.
- **`anyActivelyLosing`** — at least one bucket has
  `trades >= MIN_CUMULATIVE && cumulativeBSS < ACTIVELY_LOSING_THRESHOLD`
  (-0.05 initially). Suppresses `viable` even when the other bucket
  cleared. Informational on its own; UI uses it to differentiate
  "viable but watch the other bucket" from "viable, both healthy."

**`ACTIVELY_LOSING_THRESHOLD` rationale.** Working-checklist line 446
flags Phase 2 as having "may have hurt this bucket → investigate
before Phase 1.5" if 30-50¢ post-Phase-2 BSS stabilizes at ≤ -0.30 on
50+ trades. -0.05 is a much tighter threshold — the difference between
"slightly worse than the market" (acceptable to keep watching) and
"meaningfully worse" (not a green light for automation). Set as a
named constant so it's easily tunable without recompile-style change.

`activeBuckets` is informational, not gating. A bucket with zero
post-Phase-2 NO trades isn't a failure — it's the regime being absent.
The UI must distinguish "0 trades, regime absent" from "20 trades,
underperforming" rather than rolling them into a single gate.

## UI changes

### `SweetSpotSection` at `src/pages/trading-readiness.tsx:261`

Replace the 3-row `<GateRow>` rendering with a stacked per-bucket
layout. Mock structure:

```
Sweet Spot Strategy        [20-30¢ + 30-50¢ NO post-Phase-2]    [2/4 gates]

  ┌─ 20-30¢ NO ────────────────────────────────────────┐
  │ ✓ Cumulative BSS > 0       BSS +0.024 on 38 trades │
  │ ✓ Rolling 7d BSS > 0       BSS +0.05 on 22 trades  │
  │   42% win rate cumulative · +$3.20 net P&L         │
  └────────────────────────────────────────────────────┘

  ┌─ 30-50¢ NO ────────────────────────────────────────┐
  │ ✗ Cumulative BSS > 0       BSS -0.18 on 47 trades  │
  │ ◯ Rolling 7d BSS > 0       Need 20+ trades (n=14)  │
  │   55% win rate cumulative · -$8.40 net P&L         │
  └────────────────────────────────────────────────────┘

  Activity: both buckets producing trades.

  Status: Viable in 20-30¢ NO; 30-50¢ underperforming (BSS -0.18).
```

Visual conventions:
- ✓ green check = met
- ✗ red X = not met (sample sufficient, BSS not above 0)
- ◯ gray neutral = sample insufficient (n < threshold)

The existing `GateRow` component handles 2 of these states (met /
not-met). Add a third "neutral / pending" state — pass a tri-state
signal instead of boolean `met`. One-time component change, see
implementation notes below.

### Header chip

Top of section, at line 506:
- Old: `${Object.values(ss.gates).filter(g => g.met).length}/${Object.keys(ss.gates).length} gates`
- New: count cumulative + rolling7d gates met across both buckets (out
  of 4: `bucket20to30.cumulativeMet`, `bucket20to30.rolling7dMet`,
  `bucket30to50.cumulativeMet`, `bucket30to50.rolling7dMet`)

### Status string

Generated by API. Evaluated in order — first matching state wins:

| Order | State | When | Status text |
|---|---|---|---|
| 1 | Both buckets viable (`bothViable`) | Both `bothMet=true` | `Inner-bracket automation viable in 20-30¢ AND 30-50¢ NO` |
| 2 | One cleared, other actively losing — **NOT VIABLE** | One `bothMet=true`, other has ≥30 trades and `cumulativeBSS < ACTIVELY_LOSING_THRESHOLD` (-0.05) | `Not viable — {X}¢ cleared but {Y}¢ actively losing (BSS {z} on {N} trades)` |
| 3 | One viable, other underperforming but not actively losing | One `bothMet=true`, other has ≥30 trades and `cumulativeBSS ∈ [-0.05, 0]` | `Viable in {X}¢ NO; {Y}¢ underperforming (BSS {z} on {N} trades)` |
| 4 | One viable, other sample-insufficient | One `bothMet=true`, other has <30 trades | `Viable in {X}¢ NO; {Y}¢ sample-insufficient ({N}/30)` |
| 5 | Both buckets active, neither viable | Both have ≥30 trades, neither cleared | `Both buckets underperforming — 20-30¢ BSS {v1}, 30-50¢ BSS {v2}` |
| 6 | Only one bucket active | Other has 0 NO trades | `Only {X}¢ active ({status}); {Y}¢ regime absent` |
| 7 | Both buckets sample-insufficient | Both `trades < 30`, both > 0 | `Need 30+ post-Phase-2 NO trades per bucket — {N1}/{N2} so far` |
| 8 | Zero post-Phase-2 NO trades | Phase 2 just deployed, no signals yet | `No post-Phase-2 NO trades yet — gate window opens after first signal` |

Rows #2 and #3 distinguish the two ways a single-bucket clearance can
play out. Row #2 (`anyActivelyLosing=true`) means `viable` is false
even though one bucket cleared — the other bucket's loss vetoes
automation. Row #3 (`anyActivelyLosing=false`) means `viable` is true
because the underperforming bucket isn't deeply enough underwater to
trigger the veto. The status string must match the `viable` flag's
truth value — that's the consistency check the row split enforces.

## Implementation pointers

### File-level changes

| File | Change | Rough LOC |
|---|---|---|
| `src/lib/models/performanceTracker.ts` | Extend `BacktestResult` to carry `timestamp: number` and `direction: 'YES' \| 'NO'`. Wire both in the `trades.push({...})` call inside `getPnLBreakdown` (line ~705). Direction is already derived locally at `const direction = modelProb > s.marketPrice ? 'YES' : 'NO'` — just expose it on the result. | ~6 net |
| `src/pages/api/weather/trading-readiness.ts` | New `PHASE_2_DEPLOY_MS` const, `MIN_CUMULATIVE`/`MIN_ROLLING_7D` thresholds, rewrite `sweetSpot` block lines 210-275 to compute per-bucket cumulative + rolling-7d BSS, NO-only filtered. Bump cache key v1→v2. | ~80 net |
| `src/hooks/useTradingReadiness.ts` | Replace `SweetSpotGates` interface with new shape. | ~25 net |
| `src/pages/trading-readiness.tsx` | Rewrite `SweetSpotSection` (line 261), add tri-state to `GateRow` or add new `BucketGateCard` component, update header chip count. | ~100 net |

Total: ~210 LOC. Build estimate: half-day with proper testing.

**Downstream `BacktestResult` consumer audit.** Adding two fields is
non-breaking for existing readers. Verified consumers as of spec
authoring:
- `src/pages/api/weather/performance.ts` — passes `trades` straight to
  the analytics response; new fields just flow through, harmless.
- `src/hooks/useAnalytics.ts` (interface `AnalyticsData.trades`) —
  declared via `BacktestResult[]`; gets the new fields automatically.
- `src/pages/weather-analytics.tsx` — renders city/type/lead breakdowns;
  doesn't read `timestamp` or `direction` directly.

**`BacktestResult` is computed, not persisted.** It's constructed
fresh inside `getPnLBreakdown` on every call (from
`market_predictions` reads — see `performanceTracker.ts:719-762`) and
never written to MongoDB or any persistent cache that would require
schema migration. The only persistence boundary is the per-API
`analytics:snapshot:v6` and `trading-readiness:v1` Redis caches,
both of which we invalidate via cache-key bump. No backfill needed.

No call site needs updating beyond the trading-readiness sweet-spot
block.

**`signalGeneration` field removal.** The new shape drops the
`signalGeneration` field from `SweetSpotGates`. Audit:
`grep -r 'gates\.signalGeneration\|signalGeneration:' src/` confirms
the only references are in `useTradingReadiness.ts` (interface) and
`trading-readiness.tsx` (the line-287 GateRow we're rewriting anyway).
No other consumers; the removal is safe.

### BSS computation

**Critical: Brier is computed against the YES-side EVENT INDICATOR
(did the bracket resolve true?), NOT against `t.outcome` (did the
bet win?).** These are not the same thing for NO trades:

| direction | outcome | bracket resolved | event indicator |
|---|---|---|---|
| YES | true (won) | true | 1 |
| YES | false (lost) | false | 0 |
| NO  | true (won) | false | 0 |
| NO  | false (lost) | true | 1 |

Using `t.outcome ? 1 : 0` would invert the indicator for every NO
trade and silently flip the BSS sign across the whole gate. The
original code at `trading-readiness.ts:222-225` reconstructs the
indicator correctly via `(bettingYes ? t.outcome : !t.outcome)`,
where `bettingYes` is re-derived from `modelProbability > marketPrice`.

With `direction` now explicit on `BacktestResult`, the implementation
should use the direction-aware form (no re-derivation needed):

```ts
// YES-side event indicator: did the bracket resolve true?
// Reconstructed from (direction, outcome) on each trade.
const eventIndicator = (t: BacktestResult): number =>
  (t.direction === 'YES' ? t.outcome : !t.outcome) ? 1 : 0

const modelBrier = trades.reduce(
  (s, t) => s + (t.modelProbability - eventIndicator(t)) ** 2, 0
) / n
const marketBrier = trades.reduce(
  (s, t) => s + (t.marketPrice - eventIndicator(t)) ** 2, 0
) / n
const bss = marketBrier > 0 ? 1 - (modelBrier / marketBrier) : 0
```

Win rate is a separate, simpler computation:

```ts
const wins = trades.filter(t => t.outcome).length
const winRate = wins / n
```

Apply BSS twice per bucket (cumulative + rolling-7d filter). Win rate
once per bucket per window.

**Sanity-check at build time:** for the existing 20-40¢ aggregate
gate, the new per-bucket implementation summed across both buckets
should produce roughly the same BSS as the existing (correct)
implementation at `trading-readiness.ts:222-232`. If the new BSS is
inverted (i.e., positive where the old was negative or vice versa),
the indicator reconstruction is wrong.

### Per-bucket filtering

```ts
const phase2NoTrades = pnlData.trades.filter(
  (t: BacktestResult) =>
    t.timestamp >= PHASE_2_DEPLOY_MS &&
    t.direction === 'NO'
)

// Bucket 20-30¢: marketPrice in [0.20, 0.30)
const b20to30 = phase2NoTrades.filter(t => t.marketPrice >= 0.20 && t.marketPrice < 0.30)
// Bucket 30-50¢: marketPrice in [0.30, 0.50]
//   (post-Phase-2 trades all land in [0.30, 0.40] due to the >40¢
//    hard gate at computeOpportunities.ts:698; range is widened
//    to 0.50 for working-checklist consistency and future-proofing)
const b30to50 = phase2NoTrades.filter(t => t.marketPrice >= 0.30 && t.marketPrice <= 0.50)

// Rolling 7d
const sevenDaysAgo = Date.now() - 7 * 86400000
const b20to30Recent = b20to30.filter(t => t.timestamp >= sevenDaysAgo)
const b30to50Recent = b30to50.filter(t => t.timestamp >= sevenDaysAgo)
```

Once `BacktestResult` carries `timestamp` and `direction`, all filter
expressions are direct property reads — no nullish-coalesce needed.

## Decisions

These were open in the first draft; resolved during pre-submission
review.

- **Either-bucket vs both-bucket viability.** Either suffices. See
  Goals.
- **Phase 2 deploy timestamp.** Pinned to `Date.UTC(2026, 3, 21, 0, 0,
  0)` — see [In scope](#in-scope) for rationale.
- **Bucket boundaries.** Kept at **20-30¢** and **30-50¢** to match
  working-checklist usage; see [Bucket boundaries](#bucket-boundaries).
- **`MIN_ROLLING_7D` value.** Set to 20 with statistical justification
  in [Sample thresholds](#sample-thresholds).
- **Cache key bump risk.** Bumping `trading-readiness:v1` to `v2`
  invalidates the server-side L1+L2 cache. Client-side caches:
  `useTradingReadiness` is an SWR hook — SWR's default cache is
  in-memory and not persisted to localStorage/IndexedDB
  (verify with `grep -r 'localStorageProvider\|persistMutex\|persisted' src/`
  before shipping). React Query is not used in this codebase. No
  external API consumers. **Defensive measure:** add a guard at the
  top of `SweetSpotSection` for the new shape:
  `if (!gates.bucket20to30 || !gates.bucket30to50) return null` (or
  render a one-line loading shimmer). This guard catches edge cases
  where a still-mounted client briefly holds the old shape during
  a soft refresh.

## Remaining open questions

- [ ] **Should rolling-7d be configurable?** A 7-day window makes
  sense given roughly daily-to-weekly trade cadence. If we want to
  parameterize, the `since` query param already exists for the
  performance API; same pattern could land here. Skipping for now —
  tighten only if signal cadence shifts.

## Verification

End-to-end test plan once built:

1. **Backend**: `curl /api/weather/trading-readiness` with
   `Authorization: Bearer $CRON_SECRET`. Inspect `data.sweetSpot.gates`:
   - Has `bucket20to30`, `bucket30to50`, `activity`, `bothViable`,
     `phase2DeployMs` keys
   - `phase2DeployMs` should round-trip to `2026-04-21T00:00:00.000Z`
     when passed through `new Date(phase2DeployMs).toISOString()`.
     Per the In-scope notes, the constant is defined symbolically as
     `Date.UTC(2026, 3, 21, 0, 0, 0)`; do not assert against a
     pre-baked numeric epoch (both authors and reviewers have made
     arithmetic errors here on prior drafts).
   - `bucket30to50.trades` agrees with the same `getPnLBreakdown(500)`
     result the API uses internally — i.e., spot-check by reproducing
     the function's filter (last 500 resolved trades within 180 days,
     `isTrade: true`, `resolvedOutcome ∈ {0,1}`), then applying
     `timestamp >= PHASE_2_DEPLOY_MS && direction === 'NO' &&
     marketPrice ∈ [0.30, 0.50]`. **Don't** run a raw
     `db.market_predictions.countDocuments` — that query bypasses the
     500-row cap and 180-day cutoff, will count more rows, and will
     not match. Mirror the function's filter chain or compare against
     the function's output directly.
2. **Frontend**: open `/trading-readiness` in dev. Sweet Spot section:
   - Renders two bucket cards
   - Header chip shows "{N}/4 gates"
   - Activity description matches data (e.g., "Only 30-50¢ active" if
     `bucket20to30.trades = 0`)
   - Tri-state icons render correctly for sample-insufficient buckets
   - Status string picks the right row from the [Status string](#status-string)
     table for the observed bucket states
3. **Cache invalidation**: First refresh after deploy returns fresh
   data (cache-key `v2` doesn't exist yet). Subsequent within 5 min
   should hit cache. After 5 min, recompute. No other downstream
   caches reference Sweet Spot data — verified via
   `grep -r 'trading-readiness' src/lib/cache/`.
4. **Regression**: tail-sell gates section unchanged; `summary` cards
   unchanged; signal audit trail unchanged. `weather-analytics` page
   continues rendering correctly (it consumes `BacktestResult[]` via
   `useAnalytics` — the new `timestamp` and `direction` fields flow
   through harmlessly).

## References

- `docs/working-checklist.md:411-419` — regime mismatch finding
- `docs/working-checklist.md:439-447` — viability trigger criteria
- `docs/working-checklist.md:638-642` — tech debt audit row that
  surfaced this work
- `src/pages/trading-readiness.tsx:497-510` — current Sweet Spot UI
- `src/pages/trading-readiness.tsx:261-297` — current
  `SweetSpotSection` component
- `src/pages/api/weather/trading-readiness.ts:206-275` — current
  Sweet Spot computation
- `src/hooks/useTradingReadiness.ts:50-54` — current
  `SweetSpotGates` interface
- `memory/product-readiness-criteria-2026-03-21.md` — original viability
  criteria (BSS > 0 in 20-40¢ on 30+ trades)
- `memory/trading-sweet-spot-2026-03-23.md` — analysis that produced
  the Sweet Spot strategy framing
