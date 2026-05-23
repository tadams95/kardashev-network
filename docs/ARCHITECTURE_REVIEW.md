# Kardashev Network — Architecture Review (Current State)

> Phase 1 of the VPP evolution study. Companion doc: [`VPP_STRATEGY.md`](./VPP_STRATEGY.md).
> Snapshot date: 2026-05-21. Verified against the repo (source of truth per `CLAUDE.md`).

## 1. What this codebase is

A Next.js 14 **Pages Router** app that fuses two product surfaces over one backend:

1. **Solar potential** — Google Solar API roof insights + Open-Meteo irradiance, turned
   into an "uncaptured dollar value" of sunlight hitting a roof, with an x402-gated
   premium data tier.
2. **Weather ensemble trading** — a 6-source temperature forecast ensemble (Open-Meteo,
   NWS, AccuWeather, Tomorrow.io, Google Weather, METAR) with BMA, isotonic calibration,
   and dynamic source weighting, feeding **tail-sell signals** on Kalshi temperature
   markets. This is the actively-maintained, revenue-generating path.

The two halves share infrastructure: a uniform L1(in-memory `Map`) + L2(Redis `kn:` prefix)
cache, MongoDB time-indexed collections, dual-chain x402 micropayments, and a small
PM2 process group.

```
                          ┌────────────────────────────────────────────┐
                          │            Next.js (Pages Router)            │
   Browser  ──────────▶   │  15 API routes  ·  SWR hooks  ·  R3F + Maps  │
                          └───────┬───────────────────────┬─────────────┘
                                  │                        │
                  ┌───────────────▼──────┐      ┌──────────▼──────────────┐
                  │ External data sources │      │  State / persistence    │
                  │ Google Solar API      │      │  L1 Map  → L2 Redis(kn:) │
                  │ Open-Meteo (solar+wx) │      │  MongoDB (6 collections) │
                  │ NWS/AccuWx/Tomorrow.io│      │                          │
                  │ Google Weather/METAR  │      └──────────┬───────────────┘
                  │ Kalshi · Nominatim    │                 │
                  └───────────────────────┘      ┌──────────▼───────────────┐
                                                 │ PM2 processes             │
   x402 facilitator (x402.org) ◀── payments ──▶  │ web (fork, instances:1)   │
   EVM Base Sepolia · Solana Devnet              │ resolve-markets cron (4h) │
                                                 │ position-monitor cron(2h) │
                                                 └───────────────────────────┘
```

## 2. Key data flows

**Solar flow** (`src/pages/index.tsx` / `dashboard.tsx`):
```
address → GET /api/geocode/search (Nominatim, per-IP rate limit)
        → lat/lng
        → parallel:
            GET /api/solar/irradiance      (Open-Meteo; free vs x402-premium)
            GET /api/solar/building-insights (Google Solar; 24h cache)
            GET /api/solar/data-layers      (Google GeoTIFF → PNG heatmap overlay)
        → calculateWastedValue() in src/lib/calculations/solarValue.ts
        → UI: current kW, today's $, monthly estimate, roof heatmap
```

**Weather/trading flow** (`src/pages/weather-forecast.tsx`, crons):
```
GET /api/weather/opportunities?city=NYC   (fully server-side)
   ├─ load city coords + calibration model + dynamic weights
   ├─ fetch 6 forecast sources (each L1+L2 cached)
   ├─ build ensemble → BMA distribution → bracket probabilities
   ├─ apply calibration (inner brackets only; thresholds bypass)
   ├─ vs Kalshi order books → edge → tail-sell signals
   └─ persist signal lineage to MongoDB
resolve-markets cron (4h)  → ground-truth residuals → source_accuracy / calibration
position-monitor cron (2h) → classify open positions OK/WARN/CRITICAL → Telegram
```

## 3. Subsystem assessment

### 3.1 Solar irradiance & forecasting pipeline
**Strengths**
- Clean two-tier caching with geo-hashed (~1km) keys; graceful Google-coverage 404 handling.
- Thoughtful GeoTIFF→PNG rendering (`data-layers.ts`): mask resampling, palette
  interpolation, alpha blending; 5MB response cap.
- `calculateWastedValue()` is a tidy, testable physics model (panel η 20%, system loss
  14%, thermal derating 0.4%/°C).

**Weaknesses / debt**
- `data-layers.ts` box-blur is O(n²) per pass and buffers the whole PNG in memory.
- `DEFAULT_ELECTRICITY_PRICE = 0.16` is hardcoded national-average (`solarValue.ts:7`);
  no location/TOU-aware tariff — a real gap for any value/economics claim, and a blocker
  for VPP bill-savings math.
- Solar API routes (`irradiance`, `building-insights`, `data-layers`) have **no tests**.

### 3.2 Weather ensemble (BMA / calibration / weights)
**Strengths** — this is the genuine technical moat.
- Multi-source consensus with inverse-MAE dynamic weighting, isotonic calibration with
  segmented routing, and disciplined invariants (fail-closed on missing data, timezone via
  `Intl.DateTimeFormat`, calibration applied only within its training domain).
- Strong test coverage of the math (BMA, distributions, calibration, source accuracy,
  four-quadrant tail-sell).
- Operational maturity: maintenance-only BMA decision, brier audits, position-risk
  monitoring, atmospheric-gate shadow mode — engineering that knows where its edges are.

**Weaknesses / debt**
- BMA is slated for deletion (~2026-06) in favor of a simpler weighted-mean + single-Normal
  model; a transition with migration risk to manage.
- Forecast sources are fetched without per-source timeout/circuit-breaker; one slow API
  can stall the ensemble.

### 3.3 Payments / x402
**Strengths**
- End-to-end dual-chain flow works; multi-layer replay protection (in-flight Redis lock +
  7-day consumed-tx marker + tx-hash binding); HMAC-signed session tokens; no private keys
  in frontend.

**Weaknesses / security**
- `X402_SESSION_SECRET` falls back to `CRON_SECRET` if unset (`src/lib/x402/session.ts`) —
  key reuse risk; production must set it explicitly.
- The x402.org facilitator is **fully trusted**: the backend acts on `verify()`/`settle()`
  results with no independent signature check (defense-in-depth gap).
- No rate limit on `/api/solar/irradiance` — invalid-payment spam costs lock contention.
- Solana signer bridge (`useX402Solana.ts`) manually constructs wire-format bytes — fragile.
- Testnet-only (Base Sepolia + Solana Devnet); mainnet is an env-flip with no guardrails.

### 3.4 Frontend UX
**Strengths**
- Exemplary, recently-migrated design system: surface tokens, `<Card>` primitive, 6-token
  type scale, "amber budget" discipline (`docs/DESIGN_STATE.md`).
- R3F sun globe + dial overlay, Google Maps GroundOverlay heatmap, polished payment modal
  (focus trap, chain detection, tx-explorer links).
- Pragmatic SWR + Context + localStorage state; `preload()` on hover for snappy nav.

**Weaknesses / debt**
- Manual payment state machine (6 `useState`s) in `usePremiumSolarData` — candidate for
  `useReducer`/state machine.
- Dead code in bundle: `MarketOpportunitiesTable.tsx` (retired strategy), and the retired
  Kalshi-markets UI hook still polling every 30s.
- `SolarGlobe.tsx` is 17KB of largely-uncommented GLSL — brittle, flagged "do not touch."
- **Zero UI/component tests** (vitest runs in `node` env — no jsdom).

### 3.5 Backend / API structure & scalability
**Strengths** — uniform response shape, fail-closed auth helpers (`apiAuth.ts`), unified
Redis client with graceful in-memory fallback (`redis.ts`), Redis-backed rate limiting via
`rincr`, PM2 cron orchestration already in place.

**Weaknesses / debt**
- No shared API middleware: the L1+L2 cache pattern is hand-rolled in 5+ routes (DRY
  violation, TTL-mismatch risk); no request-validation layer.
- No request deduplication — N concurrent identical requests = N external API calls.
- No circuit breaker / bulkhead for the 6 weather sources.
- **Single web instance** (`ecosystem.config.js`: `instances: 1`, `exec_mode: 'fork'`) —
  no horizontal scale path documented.
- **No streaming / queue / WebSocket / time-series store** — the architecture is entirely
  pull-based.

### 3.6 Smart contract / wallet
- Dual-chain wallet orchestration (`useMultiChainX402` composing `useX402` + `useX402Solana`)
  is clean and well-separated.
- `contracts/KardashevNetwork.sol` is a **vestigial ERC20** — not referenced by any payment
  path. Recommend explicitly deprecating/archiving it to avoid implying it's live.

## 4. Cross-cutting

### Technical debt (prioritized)
| Issue | Location | Impact | Effort |
|---|---|---|---|
| No shared API/cache middleware | all `/api/*` | duplication, subtle TTL bugs | ~1–2d |
| No request dedup | distributed | Nx external-API quota waste | ~4h |
| No per-source timeout/circuit breaker | weather fetch path | ensemble stalls | ~2h |
| Single web instance | `ecosystem.config.js` | ~100-user ceiling | ~3h |
| Hardcoded `$0.16/kWh` | `solarValue.ts:7` | wrong economics, VPP blocker | ~4h |
| Zero UI tests / no jsdom | `vitest.config.ts` | silent UI/payment regressions | ~1–2d |
| Dead code (retired tables/hooks) | `src/components/weather/*` | bundle bloat | ~2h |

### Security
- Set `X402_SESSION_SECRET` distinctly in prod; never reuse `CRON_SECRET`.
- Keep `CRON_SECRET` out of any committed `.env*`; inject via deploy pipeline.
- Add independent payment signature verification (don't blindly trust the facilitator).
- Add CSP / `X-Frame-Options` / `nosniff` headers (`next.config.js`).
- Rate-limit `/api/solar/irradiance` per IP/wallet.

### Performance bottlenecks
- O(n²) box-blur on GeoTIFF render; sequential 6-source fetch; FIFO (not LRU) L1 eviction
  causing thrash under non-uniform traffic; no pre-aggregated rollups for analytics queries.

### Test gaps
26 tests, all backend/logic. **Missing**: every React component, the solar API routes, the
full payment flow (`usePremiumSolarData` state machine, chain switching), Maps integration,
and any E2E journey. Adding jsdom + ~10–15 PaymentGate/Card tests is a one-config-line unlock.

## 5. Real-time aggregation readiness — the central verdict

Today the system comfortably serves ~100 concurrent users across ~15 cities in a
**pull-based** model: clients request, the server fetches/caches, responds. There is **no
infrastructure to ingest continuous telemetry from many devices** — no message queue, no
Redis Streams, no WebSocket gateway, no time-series collections, no horizontal scale.

For a VPP — which is fundamentally *ingest telemetry from thousands of batteries/inverters
→ aggregate → optimize → dispatch* — this is the single biggest gap. The good news: the
**hard part (calibrated probabilistic forecasting) already exists and is the differentiator.**
The missing pieces (ingestion, time-series, optimization, dispatch) are well-understood
plumbing. That asymmetry is the thesis of the companion VPP strategy doc.
