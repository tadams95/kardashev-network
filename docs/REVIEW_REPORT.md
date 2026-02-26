## Critical (will cause incorrect trades or data loss)

### C1: Kalshi market parser drops LOW markets and can map city codes incorrectly
**File:** `src/pages/api/kalshi/markets.ts` lines 124-126, 142-173

**Issue:**
```ts
for (const code of Object.keys(CITY_COORDS)) {
  if (ticker.includes(code)) {
    cityCode = code
    break
  }
}

if (ticker.includes('HIGH') || ticker.includes('TEMP') || ticker.includes('HOT')) {
  marketType = 'temperature'
  ...
}
```
1) `ticker.includes(code)` with unsorted keys can misclassify (`DAL` contains `LA`, etc.).
2) `KXLOW*` tickers are queried (`WEATHER_SERIES_PREFIXES` includes `KXLOW`) but never classified as temperature because the condition only checks `HIGH|TEMP|HOT`.

**Impact:** Wrong city weather attached to market and LOW temp markets silently excluded; both can produce missed/incorrect trades.

**Fix:**
```ts
const sortedCodes = Object.keys(CITY_COORDS).sort((a, b) => b.length - a.length)
for (const code of sortedCodes) {
  if (ticker.includes(code)) { cityCode = code; break }
}

if (ticker.includes('HIGH') || ticker.includes('LOW') || ticker.includes('TEMP') || ticker.includes('HOT')) {
  marketType = 'temperature'
  ...
}
```
Also prefer explicit regex extraction by known series prefix (`/^KX(HIGH|HIGHT|LOW|RAIN|SNOW)([A-Z]+)$/`).

---

### C2: LOW-temperature probability is computed from max temperatures
**File:** `src/lib/models/weatherProbability.ts` lines 452-455, 531-534

**Issue:**
```ts
const filteredForecasts = forecastsOnly.filter(... f.temperature.max ...)
const maxTemps = filteredForecasts.map(f => f.temperature.max)
```
Both `calculateTemperatureProbability()` and `calculateBracketProbability()` always use `temperature.max`, even when the market direction is `below` (LOW market).

**Impact:** LOW-market probabilities can be materially wrong, creating false signals and real money loss.

**Fix:**
```ts
const isLowMarket = direction === 'below' // for threshold markets
const values = filteredForecasts.map(f => isLowMarket ? f.temperature.min : f.temperature.max)
```
For brackets, pass explicit market type (`'high' | 'low'`) from caller and use min for LOW brackets.

---

### C3: Kelly sizing formula is incorrect, ignores fees, and forces non-zero bet size
**File:** `src/lib/models/weatherProbability.ts` lines 923-966

**Issue:**
```ts
kellyFraction = edge / odds
...
return Math.max(positionSize, 0.50)
```
- Uses `edge/odds` instead of full Kelly form.
- Does not account for fee-adjusted payout.
- Always returns at least `$0.50`, even when edge is zero/negative.

**Impact:** Systematic under/over-betting and forced negative-EV trades.

**Fix:**
```ts
// YES side example with fee-adjusted net odds bEff
const p = modelProbability
const q = 1 - p
const bEff = ((1 - marketPrice) * (1 - feeRate)) / marketPrice
const k = (bEff * p - q) / bEff
const capped = Math.max(0, k) * dynamicFraction
if (capped <= 0) return 0
return Math.min(capped * bankroll, bankroll * 0.10, oiCap)
```
Do not enforce a minimum position when Kelly <= 0.

---

### C4: Public endpoints allow unauthorized model and performance-data poisoning
**File:** `src/pages/api/weather/calibration.ts` lines 59-80; `src/pages/api/weather/performance.ts` lines 44-108

**Issue:**
- `POST /api/weather/calibration` accepts arbitrary model writes.
- `POST /api/weather/performance` accepts arbitrary log/resolve writes.
- No auth and no schema validation.

**Impact:** Attackers can manipulate calibration, edge thresholds, and resolved outcomes -> false signals and capital loss.

**Fix:**
```ts
// Require secret for mutating ops
if (req.method === 'POST') {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json(...)
  }
}
```
Add strict runtime validation (zod/io-ts) for body shape and numeric ranges.

---

### C5: Premium session hijack risk in x402 flow
**File:** `src/pages/api/solar/irradiance.ts` lines 25, 157-170, 232-238

**Issue:**
```ts
const sessions = new Map<string, { expires: number; txHash: string }>()
...
const walletAddress = req.headers['x-wallet-address']
const session = sessions.get(walletAddress) || sessions.get(walletAddress.toLowerCase())
if (session) return servePremiumData(...)
```
Session access is granted by claimed header value only; ownership is not re-proven for session reuse.

**Impact:** Anyone who knows an address with an active session can replay that address and receive premium data.

**Fix:**
- Bind session to signed nonce/JWT, not raw wallet address header.
- Store `txHash` uniqueness and reject replayed settlements.
- Persist session store in Redis (multi-instance safe) with secure session token.

---

## High (significant bugs or security issues)

### H1: Calibration model can stay null in active trading flow after startup/race
**File:** `src/lib/models/weatherProbability.ts` lines 32-54; `src/pages/_app.tsx` lines 37-49; `src/pages/api/weather/forecasts.ts` (no calibration load path)

**Issue:** Calibration is module-global mutable state loaded asynchronously in client startup. Opportunity calculations can run before calibration fetch completes.

**Fix:** Load calibration deterministically before probability use (or pass model explicitly to calculators). Avoid hidden global mutable state.

---

### H2: Cron auth can be unintentionally disabled and endpoint allows GET
**File:** `src/pages/api/weather/resolve-markets.ts` lines 175, 191

**Issue:**
```ts
if (!cronSecret) return true
if (req.method !== 'POST' && req.method !== 'GET') ...
```
Missing `CRON_SECRET` opens endpoint; allowing GET increases accidental/public triggering surface.

**Fix:** Fail closed in production and allow POST only.

---

### H3: Kalshi markets fetch has no timeout and runs sequentially
**File:** `src/pages/api/kalshi/markets.ts` lines 326-379, especially 336

**Issue:** Nested loops await each fetch sequentially; no `AbortController` timeout.

**Impact:** Slow/hanging external calls can delay or fail route under Vercel limits; stale opportunities.

**Fix:** Batch with controlled concurrency + timeout per request; retry 429 with backoff for same request.

---

### H4: Mongo failure paths can throw uncaught errors in APIs
**File:** `src/lib/db/mongodb.ts` lines 10-11; `src/pages/api/weather/performance.ts` and `src/pages/api/weather/bias.ts` entire handlers

**Issue:** `getDb()` throws when env/DB unavailable; some routes do not wrap handler logic in try/catch.

**Fix:** Wrap handlers and return structured `503` degradation response.

---

### H5: EV function ignores `positionSize` argument
**File:** `src/lib/models/weatherProbability.ts` lines 877-905

**Issue:** `positionSize` is accepted but unused; returns unit EV while callers display dollar EV for `$100`.

**Fix:** multiply expected unit return by `positionSize` (or rename API to `calculateUnitEV`).

---

### H6: Market resolution uses midpoint of winning bracket as actual temperature (risk/needs validation)
**File:** `src/pages/api/weather/resolve-markets.ts` lines 105-107

**Issue:**
```ts
const actualTemp = (winner.floor_strike + winner.cap_strike) / 2
```
This is not the true observed settle value; it is a proxy.

**Impact:** Bias tracker and model performance diagnostics can drift from reality.

**Fix:** Pull official resolved observation from source of truth (NWS station value used by market rules), store actual observed value.

---

### H7: Mongo query-operator injection risk from unvalidated request body
**File:** `src/pages/api/weather/performance.ts` lines 45-96

**Issue:** `signalId`, `marketId`, and other fields are taken directly from `req.body` and used in Mongo filters.

**Fix:** Enforce strict type guards (`typeof === 'string'`) and reject objects/arrays; schema-validate whole payload.

---

## Medium (correctness improvements)

### M1: KDE bandwidth constant differs from required Silverman form (risk/needs validation)
**File:** `src/lib/models/distributions.ts` lines 70, 92

**Issue:** Implementation uses `0.9 * min(std, IQR/1.34) * n^-1/5`, while prompt requests checking `1.06 * sigma * n^-1/5`.

**Fix:** Decide explicitly between robust Silverman variant vs strict sigma rule; document and test choice against calibration/Brier results.

---

### M2: Date matching may still misalign in some timezone/timestamp shapes (risk/needs validation)
**File:** `src/hooks/useWeatherOpportunities.ts` lines 118-125

**Issue:** Forecast timestamps are normalized via `toISOString().slice(0,10)` (UTC date key). For source timestamps near local-midnight boundaries this can shift expected weather-day matching.

**Fix:** Normalize using source/local timezone date key (same strategy as display logic) rather than raw UTC day extraction.

---

### M3: No explicit indexes for hot Mongo queries
**File:** `src/lib/models/performanceTracker.ts` lines 66, 281; `src/lib/models/temperatureBias.ts` line 40

**Issue:** Frequent sort/filter on `signals.timestamp`, `signals.marketId`, `temp_bias.cityCode` without index creation.

**Fix:** Create indexes on startup/migration:
- `signals: { timestamp: -1 }`, `{ marketId: 1, outcome: 1 }`, `{ id: 1 } unique`
- `temp_bias: { cityCode: 1, timestamp: -1 }`

---

### M4: Repeated sync file reads block event loop in API paths
**File:** `src/lib/backtesting/backtest.ts` line 54; `src/lib/backtesting/dataLoader.ts` line 30

**Issue:** `fs.readFileSync` in request-time code.

**Fix:** Switch to async `fs.promises.readFile` and cache parsed result.

---

### M5: `filterEnsembleByDate()` returns filtered forecasts but stale `consensus`/`sources`
**File:** `src/hooks/useWeatherOpportunities.ts` lines 113-168

**Issue:** Returned ensemble keeps original consensus/agreement while forecasts are date-filtered.

**Fix:** Recompute per-date consensus (or at minimum recompute `sources` and agreement for filtered subset).

---

## Low (robustness, performance, maintainability)

### L1: Geocode rate limiting is global in-memory, not per-client and not multi-instance safe
**File:** `src/pages/api/geocode/search.ts` lines 22-35

**Fix:** use per-IP/token limiter in shared store (Redis).

### L2: Several external fetches in API routes lack explicit timeout wrappers
**File:** `src/pages/api/solar/building-insights.ts` line 51; `src/pages/api/solar/data-layers.ts` line 285

**Fix:** standardize `AbortController` + retry policy.

### L3: `getCityBias()` computes `lastUpdated` from unsorted query order
**File:** `src/lib/models/temperatureBias.ts` lines 55-75

**Fix:** query with sort by timestamp descending/ascending before selecting `lastUpdated`.

---

## Test Recommendations

- [ ] Add unit tests for date-offset/weather-day mapping in `filterEnsembleByDate()` -> `src/hooks/__tests__/useWeatherOpportunities.test.ts`
- [ ] Add unit tests for `formatWeatherDateLabel()` timezone edge cases (ET/PT, DST boundaries) -> `src/lib/utils/__tests__/dailyForecasts.test.ts`
- [ ] Add unit tests for `temperatureBias.ts` decay weighting and correction capping -> `src/lib/models/__tests__/temperatureBias.test.ts`
- [ ] Add Kelly correctness tests against closed-form fee-adjusted cases (including zero/negative edge => zero size) -> `src/lib/models/__tests__/weatherProbability.test.ts`
- [ ] Add parser tests for `KXLOW*` and city-code extraction collisions (`LA` vs `DAL`) -> `src/pages/api/kalshi/__tests__/markets.test.ts`
- [ ] Add API auth tests for mutating endpoints (`/api/weather/calibration`, `/api/weather/performance`, `/api/weather/resolve-markets`) -> route tests
- [ ] Add replay/session-hijack tests for `/api/solar/irradiance` session path -> route tests
- [ ] Add integration test: forecast -> probability -> edge -> signal for HIGH and LOW markets -> `src/lib/models/__tests__/pipeline.integration.test.ts`

---

## Architecture Observations

1. **Hidden mutable global model state** (`activeCalibrationModel`) makes correctness timing-dependent. Pass calibration model explicitly through calculation calls to remove race behavior.
2. **Mutating APIs are not isolated** from public traffic. Separate internal/admin routes or require service auth on all write paths.
3. **Trading-critical parsing and probability logic are tightly coupled to string heuristics.** Strongly typed parser + fixtures from real Kalshi payloads will prevent silent drift.
4. **In-memory state for paid access and caches is fragile on Vercel multi-instance.** Move session/rate-limit/stateful controls to shared backing store.

---

## Suggested Remediation Plan (priority-ordered)

1. **Immediate (same day):** lock down mutating endpoints, fix Kalshi parser (`KXLOW`, city extraction), disable forced Kelly minimum when edge <= 0.
2. **Next 1-2 days:** fix LOW-market probability inputs (`min` vs `max`), correct Kelly + EV formulas, add timeout+concurrency controls to Kalshi route.
3. **Next 3-5 days:** move x402 session state to Redis with signed session token, add tx replay protections, add Mongo indexes.
4. **Next sprint:** remove global calibration state, add integration/date-edge tests, replace midpoint proxy with true settlement observation source.
