# Late-Day Arbitrage — Forward-Data Analysis

Generated: 2026-05-03T18:16:19.565Z

## Sample summary

- Total snapshots: **11,154**
- Decided (obs locks bracket): **5,367** (48.1%)
- Time range: 2026-05-02T21:47:45.925Z → 2026-05-03T18:15:22.832Z
- Span: 20.5h
- Unique tickers: 300
- Unique events: 50
- Cities × types: 25

## Analysis 1 — Gap distribution by minutes-to-window-end

Tests whether mispricings widen or narrow as resolution approaches.
`gap = midPrice − obsImpliedYesProb_sigma2`. Positive = market priced higher than obs implies.

| Min-to-window-end | n | mean gap | median |gap| | p95 |gap| | ≥5¢ count |
|---|---:|---:|---:|---:|---:|
| 0-30 | 1807 | +1.83¢ | +0.50¢ | +22.50¢ | 140 |
| 30-60 | 1273 | +0.48¢ | +0.50¢ | +1.79¢ | 34 |
| 60-120 | 1712 | +0.28¢ | +0.50¢ | +0.69¢ | 60 |
| 120-240 | 301 | +0.23¢ | +0.50¢ | +3.34¢ | 14 |
| 240-360 | 257 | +5.95¢ | +0.50¢ | +40.29¢ | 45 |
| past-window | 10 | +8.55¢ | +0.50¢ | +94.00¢ | 3 |

## Analysis 2 — Decided-bracket pricing accuracy

For snapshots where observation locks the outcome, where does the market price?
Efficient market: P(midPrice) → 1 when obs implies YES, → 0 when obs implies NO.

- **Obs implies YES (P ≥ 0.95)** — n=247
  - mean=+67.78¢ | median=+99.00¢ | range=[+0.50¢, +99.50¢]
  - within 3¢ of $1.00 (efficient): 135 (54.7%)
- **Obs implies NO (P ≤ 0.05)** — n=5120
  - mean=+2.82¢ | median=+0.50¢ | range=[+0.50¢, +99.50¢]
  - within 3¢ of $0.00 (efficient): 4860 (94.9%)

## Analysis 3 — Hypothetical EV simulation after fees

Strategy: at each snapshot where bracket is decided AND |gap| ≥ 3¢, take the side that observation predicts.
Fees: 10% of profit on winning trades only. Loss = -cost (full stake at risk).
Outcome proxy: when obs-implied prob ≥ 0.95, treat outcome as YES; ≤ 0.050000000000000044, treat as NO.

- **Per-snapshot (every minute, every ticker)**
  - n=329 (BUY_YES=111, SELL_YES=218)
  - Win rate: 100.0% (proxy outcome)
  - Total P&L: $165.99 per contract-equivalent
  - **Mean P&L per trade: +50.45¢**
  - Mean fill price: +43.94¢ | Mean |gap|: +58.23¢

- **Per-ticker (one trade per ticker, latest decided snapshot)**
  - n=32 (BUY_YES=8, SELL_YES=24)
  - Win rate: 100.0% (proxy outcome)
  - Total P&L: $10.97 per contract-equivalent
  - **Mean P&L per trade: +34.28¢**
  - Mean fill price: +61.91¢ | Mean |gap|: +41.33¢

> ⚠️  Outcome here is proxied from `obsImpliedYesProb_sigma2`. Both BUY_YES and SELL_YES legs always "win" by construction (obs implies the side we take). Real-world deviation comes from σ-model error: cases where σ-implied 0.99+ confidence is wrong. Validating against actual `resolvedOutcome` requires waiting for snapshot tickers to resolve and joining via `market_predictions` or Kalshi resolution feed.

### EV by gap magnitude (per-snapshot)

| |gap| range | n | win rate | mean P&L/trade |
|---|---:|---:|---:|
| 3-5¢ | 55 | 100.0% | +2.31¢ |
| 5-10¢ | 15 | 100.0% | +4.80¢ |
| 10-25¢ | 40 | 100.0% | +10.42¢ |
| 25-50¢ | 39 | 100.0% | +27.72¢ |
| 50-100¢ | 180 | 100.0% | +82.79¢ |

## Analysis 4 — Orderbook context at large gaps

For snapshots with |gap| ≥ 5¢, is the book thin (mechanical mispricing) or stacked (informed disagreement)?

- Total large-gap snapshots: **298**
- Thin (min side <10 contracts): 114 (38.3%) → mechanical mispricing
- Medium (10-100): 3 (1.0%)
- Stacked (≥100): 181 (60.7%) → informed disagreement
- Mean YES book depth: 1455 contracts
- Mean NO book depth: 16526 contracts

## Analysis 5 — σ-heuristic consistency

Brier score on decided cases, treating each σ heuristic as the prediction and the σ2-decided side as the proxy outcome.
Lower Brier = more accurate. If all three σ values converge to identical 0/1 outputs at decision time, all three Briers will be near-zero (saturated).

- n=5367
- σ1 Brier: 0.0000
- σ2 Brier: 0.0000 (reference)
- σ3 Brier: 0.0001
- σ1/σ2/σ3 directional agreement: 5367 / 5367 (100.0%)

> If agreement → 100%, the three σ heuristics differ only in the *near-boundary* cases (which are excluded from `bracketDecided=true`). This is expected and means σ choice is irrelevant for the late-day arb question — it only matters mid-window.

## Phase 2a — Resolution-joined validation

Of 300 unique tickers, **150** have actual Kalshi resolutions (status finalized/settled).
Of those, **144** were classified `bracketDecided=true` at probe time.

- Overall match rate (obs-implied direction = actual outcome): **91.7%** (132/144)
- When obs implies YES (P ≥ 0.95): actual YES rate 77.3% (17/22)
- When obs implies NO  (P ≤ 0.050000000000000044): actual NO  rate 94.3% (115/122)
- **Brier score (obs-implied σ2 vs actual outcome): 0.0833**

### Phase 2a EV — actual outcomes

- n=17
- **Real win rate: 29.4%** (5/17)
- Total P&L: $-1.99 per contract-equivalent
- **Mean P&L per trade (real): -11.73¢**

## Phase 2b — Settlement-source alignment (Iowa ASOS vs Kalshi)

For each resolved ticker with completed window, compare Iowa-observed extreme to Kalshi `expected_expiration_value`.
If the two sources diverge by ≥0.5°F on boundary cases, our "decided" classification can be wrong.

- Events compared: **11** (66 resolved tickers, deduped to one per event)
- Mean Δ (Kalshi − Iowa): +0.18°F
- Mean |Δ|: 0.55°F
- |Δ| range: [-1.00, 2.00]°F
- p50 |Δ|: 0.00°F
- p95 |Δ|: 2.00°F
- Cases with |Δ| ≥ 1°F: **5** (45.5%)

### Drift cases (|Δ| ≥ 1°F)

| City | Type | Iowa extreme | Kalshi value | Δ |
|---|---|---:|---:|---:|
| NY | temperature-high | 60.00°F | 61.00°F | +1.00°F |
| CHI | temperature-high | 54.00°F | 56.00°F | +2.00°F |
| CHI | temperature-low | 33.00°F | 32.00°F | -1.00°F |
| DEN | temperature-low | 38.00°F | 37.00°F | -1.00°F |
| LV | temperature-high | 85.00°F | 86.00°F | +1.00°F |

## Recommendation

### Proxy outcomes (σ2-derived; tautological)
- Per-snapshot mean P&L: +50.45¢ (n=329)
- Per-ticker mean P&L: +34.28¢ (n=32)

### Real outcomes (Kalshi-resolved; load-bearing)
- n=17
- Win rate: 29.4%
- **Mean P&L per trade: -11.73¢**

> **KILL** — real-outcome EV is negative after fees. The σ2-implied "decided" classification overstates confidence; on YES-side cases especially, ground-truth disagrees often enough to wipe out the gap. Hypothesis disproven.

### Caveats
- Sample window is short — data spans a single late-window cycle. Re-run after another 24h for stability check.
- Per-snapshot column overstates throughput: in practice you cannot trade every minute on every ticker simultaneously.
- Fees modeled at flat 10% of profit on wins. Kalshi's actual fee schedule has tier breakpoints that may differ at small contract sizes.
- Settlement-source: Kalshi resolves on NWS Climatological Report (city-specific station); our σ-implied prob uses Iowa Mesonet ASOS for the same station. Phase 2b quantifies any drift.
