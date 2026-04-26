# Sweet Spot Gate Refresh — Spec

Companion to `docs/working-checklist.md` (Tech debt cleanup → Sweet Spot UI refresh build).
Spec only — implementation deferred to next week, after Apr 27 `/audit-brier`.

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
  **30-50¢ NO**, each with its own BSS-positive criterion. Either
  bucket can trigger viability independently.
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
  decision). Value: `Date.UTC(2026, 3, 20, 18, 0, 0)` ≈ Phase 2 deploy
  on 2026-04-20 ~18:00 UTC. Exact ms value extracted from commit
  `8886f1f` deploy timestamp.
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
- Per-direction (YES vs NO) split inside each bucket. NO-only is
  already enforced upstream by the trading filter; the gate evaluation
  doesn't need to re-derive direction from `t.modelProbability >
  t.marketPrice`.
- Adjusting the 30-50¢ ceiling. The Apr 24 hard-gate audit established
  ≤10¢ / >40¢ filter. The 30-50¢ sweet-spot bucket overlaps the hard
  gate at 40¢. The viability section calls the trading window
  "20-40¢ NO" because it's bounded by the hard gate. For the gate UI,
  bucket boundaries follow the trading filter: **20-30¢** and
  **30-40¢** (NOT 30-50¢ — the >40¢ hard gate makes 40-50¢ a no-trade
  zone). Naming corrected here vs the working-checklist's casual
  "30-50¢" mention. Tighten to 30-40¢ in code.

## Data model

### New `SweetSpotGates` shape

Replaces the 3-field structure at
`src/hooks/useTradingReadiness.ts:50-54`.

```ts
export interface SweetSpotBucketGate {
  // Trade counts in this bucket since Phase 2 deploy
  trades: number               // total post-Phase-2 trades in bucket
  recentTrades: number         // trades in last 7 days

  // Cumulative-since-Phase-2 metrics
  cumulativeBSS: number | null    // null if trades < minSample
  cumulativeWinRate: number | null
  cumulativeNetPnl: number

  // Rolling 7-day metrics
  rolling7dBSS: number | null     // null if recentTrades < minSampleRecent
  rolling7dWinRate: number | null

  // Gate verdicts
  cumulativeMet: boolean        // trades >= 30 && cumulativeBSS > 0
  rolling7dMet: boolean         // recentTrades >= 10 && rolling7dBSS > 0
  bothMet: boolean              // cumulativeMet && rolling7dMet
}

export interface SweetSpotGates {
  // Per-bucket gates
  bucket20to30: SweetSpotBucketGate
  bucket30to40: SweetSpotBucketGate

  // Activity / regime status (replaces dead signalGeneration gate)
  activity: {
    activeBuckets: Array<'20-30' | '30-40'>  // buckets with >=1 post-Phase-2 trade
    description: string  // e.g., "Only 30-40¢ active (20-30¢ regime absent)"
  }

  // Phase 2 deploy reference (so UI can render "since YYYY-MM-DD")
  phase2DeployMs: number
}
```

### Sample thresholds

| Threshold | Value | Why |
|---|---|---|
| `MIN_CUMULATIVE` | 30 | Working-checklist viability criterion (line 442) |
| `MIN_ROLLING_7D` | 10 | Statistically meaningful weekly check; tighter would push the gate to flicker; looser would mask 1-2 day swings |

Both thresholds defined at top of `trading-readiness.ts` as named consts.

### Gate verdicts

A bucket is **viable** (eligible to trigger inner-bracket automation
work) when `bothMet: true` — i.e., cumulative-since-Phase-2 BSS > 0 on
30+ trades AND rolling 7-day BSS > 0 on 10+ trades. Either bucket can
clear independently.

`activeBuckets` is informational, not gating. A bucket with zero
post-Phase-2 trades isn't a failure — it's the regime being absent.
The UI should distinguish "0 trades, regime absent" from "20 trades,
underperforming" rather than rolling them into a single gate.

## UI changes

### `SweetSpotSection` at `src/pages/trading-readiness.tsx:261`

Replace the 3-row `<GateRow>` rendering with a stacked per-bucket
layout. Mock structure:

```
Sweet Spot Strategy        [20-30¢ + 30-40¢ NO post-Phase-2]    [2/4 gates]

  ┌─ 20-30¢ NO ────────────────────────────────────────┐
  │ ◯ Cumulative BSS > 0       BSS +0.024 on 38 trades │
  │ ✓ Rolling 7d BSS > 0       BSS +0.05 on 12 trades  │
  │   42% win rate cumulative · +$3.20 net P&L         │
  └────────────────────────────────────────────────────┘

  ┌─ 30-40¢ NO ────────────────────────────────────────┐
  │ ✗ Cumulative BSS > 0       BSS -0.18 on 47 trades  │
  │ ◯ Rolling 7d BSS > 0       Need 10+ trades (n=6)   │
  │   55% win rate cumulative · -$8.40 net P&L         │
  └────────────────────────────────────────────────────┘

  Activity: 30-40¢ producing trades; 20-30¢ regime absent (0 trades).

  Status: Not ready — 30-40¢ underperforming, 20-30¢ no sample yet.
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
  of 4: bucket20to30.cumulativeMet, bucket20to30.rolling7dMet,
  bucket30to40.cumulativeMet, bucket30to40.rolling7dMet)

### Status string

Generated by API. States:

| State | When | Status text |
|---|---|---|
| Either bucket viable (`bothMet`) | At least one bucket cleared all | `Inner-bracket automation viable in {bucket}¢ NO` |
| Both buckets active, neither viable | Both have trades, none cleared | `Not ready — {bucket} BSS {value}, {bucket} BSS {value}` |
| Only one bucket active | Other has 0 trades | `Only {bucket}¢ active — {viable/not-yet} ({BSS} on {N} trades)` |
| Both buckets sample-insufficient | Both `trades < 30` | `Need 30+ post-Phase-2 trades per bucket — {N1}/{N2} so far` |
| Zero post-Phase-2 trades | Phase 2 just deployed | `No post-Phase-2 trades yet — gate window opens after first signal` |

## Implementation pointers

### File-level changes

| File | Change | Rough LOC |
|---|---|---|
| `src/pages/api/weather/trading-readiness.ts` | New `PHASE_2_DEPLOY_MS` const, `MIN_CUMULATIVE`/`MIN_ROLLING_7D` thresholds, rewrite `sweetSpot` block lines 210-275 to compute per-bucket cumulative + rolling-7d BSS. Bump cache key v1→v2. | ~80 net |
| `src/hooks/useTradingReadiness.ts` | Replace `SweetSpotGates` interface with new shape. | ~25 net |
| `src/pages/trading-readiness.tsx` | Rewrite `SweetSpotSection` (line 261), add tri-state to `GateRow` or add new `BucketGateCard` component, update header chip count. | ~100 net |

Total: ~200 LOC. Build estimate: half-day with proper testing.

### BSS computation

Reuse the existing pattern from
`src/pages/api/weather/trading-readiness.ts:222-232`:

```ts
const marketActual = (t: any): number => {
  const bettingYes = t.modelProbability > t.marketPrice
  return (bettingYes ? t.outcome : !t.outcome) ? 1 : 0
}
const modelBrier = trades.reduce((s, t) => s + (t.modelProbability - marketActual(t)) ** 2, 0) / n
const marketBrier = trades.reduce((s, t) => s + (t.marketPrice - marketActual(t)) ** 2, 0) / n
const bss = marketBrier > 0 ? 1 - (modelBrier / marketBrier) : 0
```

Apply twice per bucket (cumulative + rolling-7d filter).

### Per-bucket filtering

```ts
const phase2Trades = pnlData.trades.filter(
  (t: any) => (t.timestamp ?? 0) >= PHASE_2_DEPLOY_MS
)

// Bucket 20-30¢: marketPrice in [0.20, 0.30)
const b20to30 = phase2Trades.filter(t => t.marketPrice >= 0.20 && t.marketPrice < 0.30)
// Bucket 30-40¢: marketPrice in [0.30, 0.40]
const b30to40 = phase2Trades.filter(t => t.marketPrice >= 0.30 && t.marketPrice <= 0.40)

// Rolling 7d
const sevenDaysAgo = Date.now() - 7 * 86400000
const b20to30Recent = b20to30.filter(t => (t.timestamp ?? 0) >= sevenDaysAgo)
const b30to40Recent = b30to40.filter(t => (t.timestamp ?? 0) >= sevenDaysAgo)
```

Note: `BacktestResult` from `getPnLBreakdown` has `date: string` not
`timestamp: number`. Implementation needs to either (a) extend
`BacktestResult` to carry `timestamp`, or (b) re-filter the underlying
`docs` in `getPnLBreakdown` and pass timestamps through. Option (a) is
~3 lines and avoids changing the function contract for other consumers
(`weather-analytics.tsx`).

## Open questions

- [ ] **Should both buckets need to clear, or does either suffice?**
  Current spec: either bucket clearing is "viable" because they're
  different regimes. Alternative: require both, treating them as a
  composite test. Recommendation: either, with a separate optional
  "both clear" badge for stronger conviction.
- [ ] **Phase 2 deploy timestamp precision.** Looking up the exact
  commit timestamp before implementation; rough value `Date.UTC(2026,
  3, 20, 18, 0)` is accurate to within ~1 hour, which is fine for
  filter-bucket purposes but should be pinned exactly during build.
- [ ] **Cache key bump risk.** Bumping `trading-readiness:v1` to `v2`
  means clients holding the old shape briefly get the new shape on
  refresh. Old shape consumers: only `useTradingReadiness` and the
  `/trading-readiness` page. Both are simultaneously updated. Low risk.
- [ ] **Should rolling-7d be configurable?** A 7-day window makes
  sense given roughly daily-to-weekly trade cadence. If we want to
  parameterize, the `since` query param already exists for the
  performance API; same pattern could land here. Skipping for now —
  tighten only if signal cadence shifts.

## Verification

End-to-end test plan once built:

1. **Backend**: `curl /api/weather/trading-readiness` with
   `Authorization: Bearer $CRON_SECRET`. Inspect `data.sweetSpot.gates`:
   - Has `bucket20to30`, `bucket30to40`, `activity`, `phase2DeployMs` keys
   - `phase2DeployMs` matches `Date.UTC(2026, 3, 20, ...)`
   - `bucket30to40.trades` matches `db.market_predictions.countDocuments({ resolvedOutcome: { $in: [0,1] }, isTrade: true, timestamp: { $gte: PHASE_2_DEPLOY_MS }, marketPrice: { $gte: 0.30, $lte: 0.40 } })` from a manual MongoDB query.
2. **Frontend**: open `/trading-readiness` in dev. Sweet Spot section:
   - Renders two bucket cards
   - Header chip shows "{N}/4 gates"
   - Activity description matches data (e.g., "Only 30-40¢ active" if
     bucket20to30.trades = 0)
   - Tri-state icons render correctly for sample-insufficient buckets
3. **Cache invalidation**: First refresh after deploy returns fresh
   data (cache-key `v2` doesn't exist yet). Subsequent within 5 min
   should hit cache. After 5 min, recompute.
4. **Regression**: tail-sell gates section unchanged; `summary` cards
   unchanged; signal audit trail unchanged.

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
