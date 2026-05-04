# LOW Cold-Tail Tail-Sell Viability Analysis

Generated: 2026-05-04T03:24:47.566Z
Low-temp epoch: 2026-04-03
Fee model: 10% of profit on wins

Fetched 61 temp_bias docs (LOW markets, since 2026-04-03).

Coverage: 2026-04-04 → 2026-04-11
Cities: BOS, CHI, DC, HOU, LV, MIA, NYC, SEA, SFO


## Analysis 1 — Directional asymmetry baseline (LOW markets)

Total events: 61
- Actual COLDER than forecast (signedDist < 0): 40 (65.57%)
- Actual SAME bracket as forecast (signedDist = 0): 9 (14.75%)
- Actual WARMER than forecast (signedDist > 0): 12 (19.67%)

**Memory baseline for LOW markets** (`memory/low-temp-phase-a-2026-04-03.md`): forecast bias is REVERSED from highs — sources tend to be warm-biased on low forecasts (predict warmer than actual), meaning actuals run COLDER than forecast more often than warmer.
Observed cold/warm ratio: 3.33

> Pattern matches the LOW-market cold-bias: actuals run COLDER than forecast more often. This is the foundational asymmetry that powers cold-tail-LOW (deep-cold) tail-sell.

## Analysis 2 — Cold-tail-LOW bracket hit rate by distance (signedDist === -D)

Hit rate at distance -D = fraction of events where actual landed in the bracket exactly -D below the forecast bracket.
A cold-tail-LOW tail-sell at distance -D LOSES when this hit occurs.

| Distance (below forecast) | °F equivalent | Events | Hit rate |
|---|---|---:|---:|
| -1 | -2°F | 33 | 54.10% |
| -2 | -4°F | 7 | 11.48% |
| -3 | -6°F | 0 | 0.00% |
| -4 | -8°F | 0 | 0.00% |
| -5 | -10°F | 0 | 0.00% |
| -6 | -12°F | 0 | 0.00% |
| -7 | -14°F | 0 | 0.00% |

## Analysis 3 — Warm-tail-LOW control (currently paper-mode)

Mirror of cold-tail hit rate but for warm-side. This is the existing paper-mode quadrant; numbers should match its observed paper performance.

| Distance (above forecast) | °F equivalent | Events | Hit rate |
|---|---|---:|---:|
| +1 | +2°F | 4 | 6.56% |
| +2 | +4°F | 2 | 3.28% |
| +3 | +6°F | 6 | 9.84% |
| +4 | +8°F | 0 | 0.00% |
| +5 | +10°F | 0 | 0.00% |
| +6 | +12°F | 0 | 0.00% |
| +7 | +14°F | 0 | 0.00% |

## Analysis 4 — Per-trade EV table — cold-tail-LOW (selling YES at price P)

Formula: EV = (1 - hitRate) × P × (1 - 0.1) - hitRate × (1 - P)

| Distance | °F | Hit rate | YES=5¢ | YES=7¢ | YES=10¢ | YES=15¢ | YES=20¢ |
|---|---|---:|---:|---:|---:|---:|---:|
| -3 | -6°F | 0.00% | +4.50¢ ✓ | +6.30¢ ✓ | +9.00¢ ✓ | +13.50¢ ✓ | +18.00¢ ✓ |
| -4 | -8°F | 0.00% | +4.50¢ ✓ | +6.30¢ ✓ | +9.00¢ ✓ | +13.50¢ ✓ | +18.00¢ ✓ |
| -5 | -10°F | 0.00% | +4.50¢ ✓ | +6.30¢ ✓ | +9.00¢ ✓ | +13.50¢ ✓ | +18.00¢ ✓ |
| -6 | -12°F | 0.00% | +4.50¢ ✓ | +6.30¢ ✓ | +9.00¢ ✓ | +13.50¢ ✓ | +18.00¢ ✓ |
| -7 | -14°F | 0.00% | +4.50¢ ✓ | +6.30¢ ✓ | +9.00¢ ✓ | +13.50¢ ✓ | +18.00¢ ✓ |

Breakeven YES price by distance (where EV crosses 0):
  -3: hit rate 0.00% → breakeven YES = 0.00¢
  -4: hit rate 0.00% → breakeven YES = 0.00¢
  -5: hit rate 0.00% → breakeven YES = 0.00¢
  -6: hit rate 0.00% → breakeven YES = 0.00¢
  -7: hit rate 0.00% → breakeven YES = 0.00¢

## Analysis 5 — Per-city cold-tail-LOW hit rate at ≥-6°F

| City | Events | ≥-6°F hits | Hit rate | EV at YES=10¢ | Pass? |
|---|---:|---:|---:|---:|---|
| NYC | 12 | 0 | 0.00% | +9.00¢ | ✓ |
| SEA | 12 | 0 | 0.00% | +9.00¢ | ✓ |
| HOU | 12 | 0 | 0.00% | +9.00¢ | ✓ |
| DC | 10 | 0 | 0.00% | +9.00¢ | ✓ |
| CHI | 7 | 0 | 0.00% | +9.00¢ | ✓ |
| BOS | 4 | 0 | 0.00% | +9.00¢ | ✓ |
| MIA | 2 | 0 | 0.00% | +9.00¢ | ✓ |
| LV | 1 | 0 | 0.00% | +9.00¢ | ✓ |
| SFO | 1 | 0 | 0.00% | +9.00¢ | ✓ |

Passing cities: 9 / 9 (gate requires ≥3)

## Analysis 6 — Correlated blowup risk (cold-snap drawdown)

Cold snaps are regional; multiple cities can see deep-cold lows simultaneously.

No cold-tail-LOW ≤-6°F events in clean era. Cold snaps too rare in current sample window.

## Decision Rules — GO / NO-GO / CONTINUE

| Check | Result | Detail |
|---|---|---|
| Hit rate at -6°F < 5% | ✓ PASS | Observed: 0.00% |
| Mean per-trade EV at -6°F across YES bands ≥ 3¢ | ✓ PASS | Observed: +10.26¢ |
| Worst-day drawdown at $20 position < $200 | ✓ PASS | Observed: -$0.00 |
| Worst-day drawdown at $50 position < $500 | ✓ PASS | Observed: -$0.00 |
| Sample n at -6°F+ ≥ 50 | ✗ FAIL | Observed: 0 |
| ≥3 cities pass per-city EV gate | ✓ PASS | Observed: 9 |

## **VERDICT: NO-GO**

At least one fatal criterion failed. Drop cold-tail-LOW from this work; ship hot-side-HIGH only.
Mechanism: cold snaps either too common in this regime OR YES pricing too efficient at deep-cold tails. Warm-tail-LOW (already paper) remains the deployed low-temp quadrant.

## Caveats

- Low-temp data starts 2026-04-03; sample window is roughly 1 month, smaller than the high-market clean-era sample.
- LOW market source rankings are REVERSED from highs (memory: GW best 2.65°F MAE, NWS 4th 4.38°F). Bias direction may differ.
- Cold snaps are seasonal — May-October sample under-represents winter regime. Re-evaluate after first cold snap if deployed in paper.
- Position caps applied per production tailSellTracker.ts logic (MAX_PER_CITY_TYPE=2, MAX_NE_CORRIDOR=5, MAX_TOTAL=8).
- YES price bands assumed 5-20¢; cold-tail-LOW actual price distribution unverified without kalshi_market_snapshots join.
