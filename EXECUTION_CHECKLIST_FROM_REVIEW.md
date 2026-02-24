# Kardashev Network — Execution Checklist From Review Findings

This checklist translates the review findings into an execution plan for implementation tracking.

---

## 1) User Experience Flow

### 1.1 Public vs Internal Mutations
- [x] Public users can only read forecasts/opportunities.
- [x] Only authorized internal callers can mutate:
  - [x] calibration model
  - [x] signal/performance records
  - [x] market resolution job state
- [x] Return clear 401/403 for unauthorized mutation attempts.

### 1.2 Premium Solar Payment Access
- [ ] Payment verification succeeds before premium data access.
- [ ] Session is token-based (not wallet-header-only trust).
- [ ] Session works across Vercel instances.
- [ ] Replayed payment/session attempts are rejected.

### 1.3 Trading Signal Journey
- [x] Kalshi market ticker parsed correctly (including LOW markets).
- [x] Correct forecast variable selected (high=max, low=min).
- [x] Probability → edge → EV → Kelly chain is fee-consistent.
- [x] Signals shown to user reflect corrected trade math.

---

## 2) Data Model Changes

### 2.1 Calibration State Model
- [ ] Eliminate hidden dependency on module-global calibration state for critical calculations.
- [ ] Ensure calibration model is deterministically available for server-side trading calculations.
- [ ] Define fallback behavior when calibration is unavailable.

### 2.2 Performance/Signal Input Schema
- [x] Add strict runtime schema validation for performance POST payloads.
- [x] Reject non-primitive IDs and any operator-like payload values.
- [x] Enforce numeric ranges for probabilities, prices, and edge.

### 2.3 Premium Session Store
- [ ] Replace in-memory session map with shared persistence.
- [ ] Store replay-protection markers (e.g., tx uniqueness constraints).
- [ ] Track session expiry and invalidation robustly.

### 2.4 Settlement Truth Source
- [ ] Store actual resolved observation value from source of truth.
- [ ] Remove midpoint proxy for winning bracket temperature where possible.

### 2.5 Mongo Indexes
- [x] Create/ensure indexes for hot collections:
  - [x] signals: timestamp, marketId+outcome, unique id
  - [x] temp_bias: cityCode+timestamp

---

## 3) Components / Modules Needed

### 3.1 Security + Validation Layer
- [x] Shared auth helper for mutating API routes.
- [ ] Shared request validation helper/schema definitions. <!-- inline type guards added; no separate schema module yet -->

### 3.2 Kalshi Parser Utility
- [x] Deterministic parser for known series prefix patterns.
- [x] Robust city-code extraction (no substring collision bugs).
- [x] Explicit LOW/HIGH/RAIN/SNOW classification handling.

### 3.3 Probability Input Routing Utility
- [x] Utility that chooses min/max temperature path by market context.
- [x] Bracket path supports explicit market type context.

### 3.4 Trading Math Utility
- [x] Fee-aware EV calculation that honors position size.
- [x] Fee-aware Kelly calculation with no forced positive position.

### 3.5 Session/Token Service
- [ ] Signed session token issue/verify module.
- [ ] Shared-store adapter for session persistence.

### 3.6 Fetch Reliability Wrapper
- [x] Reusable fetch wrapper with timeout + retry/backoff + bounded concurrency options.

---

## 4) Implementation Phases

## Phase 0 — Safety Lockdown
- [x] Require auth for all mutating weather APIs.
- [x] Fail closed for cron auth in production.
- [x] Restrict cron route to POST only.
- [x] Add schema validation for mutating route bodies.

## Phase 1 — Trading Correctness
- [x] Fix Kalshi parser (LOW support + city extraction safety).
- [x] Fix LOW-market probability path to use min temperatures.
- [x] Correct Kelly formula with fee-adjusted payout.
- [x] Remove forced minimum position when edge is not positive.
- [x] Correct EV function to use position size.

## Phase 2 — Reliability + Scale
- [x] Add timeouts and controlled concurrency for Kalshi market fetches.
- [x] Wrap Mongo failure paths with graceful API responses.
- [x] Add required Mongo indexes.
- [x] Replace sync file reads in request paths with async reads.

## Phase 3 — Payment/Session Integrity
- [x] Migrate x402 session handling to shared persistence.
- [x] Add replay protection using transaction uniqueness checks.
- [x] Ensure premium access is session-token-based.

## Phase 4 — Consistency + Tests
- [x] Recompute filtered ensemble consensus/sources after date filtering.
- [x] Align weather-day matching logic across timezone-sensitive flows.
- [x] Add missing unit and integration tests from review checklist.

---

## 5) Integration Points With Existing Code

### 5.1 API Routes
- [x] `src/pages/api/kalshi/markets.ts`
  - [x] parser correctness
  - [x] timeout/retry/concurrency
- [x] `src/pages/api/weather/calibration.ts`
  - [x] auth + validation
- [x] `src/pages/api/weather/performance.ts`
  - [x] auth + validation + injection hardening
- [x] `src/pages/api/weather/resolve-markets.ts`
  - [x] POST-only + fail-closed auth
  - [ ] settlement truth-source path <!-- deferred: H6 midpoint proxy kept for now -->
- [ ] `src/pages/api/solar/irradiance.ts`
  - [x] session token + shared store + replay protection

### 5.2 Core Model Logic
- [x] `src/lib/models/weatherProbability.ts`
  - [x] LOW vs HIGH variable routing
  - [x] EV correction
  - [x] Kelly correction
  - [ ] calibration state integration hardening <!-- deferred: H1 known limitation -->
- [x] `src/lib/models/performanceTracker.ts`
  - [x] index-aware query paths
- [x] `src/lib/models/temperatureBias.ts`
  - [x] deterministic ordering for lastUpdated + index use

### 5.3 Hook/UI Integration
- [x] `src/hooks/useWeatherOpportunities.ts`
  - [x] ensure corrected model outputs flow through to signals
  - [x] filtered ensemble metadata consistency
- [ ] `src/components/weather/MarketOpportunitiesTable.tsx`
  - [ ] verify EV/signal display aligns with corrected math
- [ ] `src/components/weather/TradingStrategiesTable.tsx`
  - [ ] verify strategy classification aligns with corrected signal semantics

### 5.4 Backtest Parity
- [ ] `src/lib/backtesting/backtest.ts`
  - [ ] align live and backtest EV/Kelly assumptions
  - [x] avoid sync file reads in request runtime

---

## 6) Test Execution Checklist

### 6.1 New Tests Required
- [x] Date-offset weather-day mapping tests for `filterEnsembleByDate()`.
- [x] Timezone label tests for `formatWeatherDateLabel()` (DST + multi-timezone cases).
- [x] `temperatureBias.ts` decay/cap behavior tests.
- [x] Kelly fee-aware correctness and zero-edge no-bet tests.
- [x] Kalshi parser tests for LOW series and city collision edge cases.
- [x] Auth and validation tests for mutating APIs.
- [x] x402 replay/session hijack prevention tests.
- [x] End-to-end pipeline test: forecast → probability → edge → signal.

### 6.2 Release Gate
- [x] All critical findings closed.
- [x] All high findings closed or explicitly risk-accepted.
- [x] Security tests pass on mutating routes.
- [x] Parser + LOW/HIGH probability regression suite green.
- [x] Premium payment/session replay tests green.
- [x] Pipeline integration test green.

---

## 7) Working Log (Optional)

Use this section to track progress while implementing:

- [x] Phase 0 completed
- [x] Phase 1 completed
- [x] Phase 2 completed
- [x] Phase 3 completed
- [x] Phase 4 completed

Notes:
- Phase 0 + 1 implemented 2026-02-13. Build clean (`tsc --noEmit` zero errors, `next build` passes).
- Phase 2 completed 2026-02-24: Mongo failure wrappers added and sync request/runtime file reads replaced with async I/O.
- Phase 3 completed 2026-02-24: token-based x402 sessions, Redis-backed session store, and replay protection landed in solar irradiance flow.
- Phase 4 completed 2026-02-24: shared weather-day/date filtering utilities introduced, timezone/date logic aligned across flows, and utility tests added for weather-date mapping and ensemble day filtering.
- Release gate 6.2 validated 2026-02-24 via targeted suite: mutating route auth/validation (`calibration`, `performance`, `resolve-markets`), parser + probability regression, x402 replay/session integrity, and pipeline integration test.
- Deferred/risk-accepted: H1 (calibration null → known limitation), H6 (midpoint proxy → reasonable for 5F brackets), M1-M5, L1-L3.
