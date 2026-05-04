# Hot-Side High-Temp Tail-Sell Viability Analysis

Generated: 2026-05-04T02:07:31.077Z
Clean-era epoch: 2026-03-21
Fee model: 10% of profit on wins (Kalshi standard)

Fetched 1265 clean-era temp_bias docs (high markets only).

Coverage: 2026-03-21 → 2026-05-03
Cities: ATL, AUS, BOS, CHI, DAL, DC, DEN, HOU, LAX, LV, MIA, NY, PHIL, PHX, SEA, SFO


## Analysis 1 — Directional asymmetry baseline

Total events: 1265
- Actual COLDER than forecast (signedDist < 0): 114 (9.01%)
- Actual SAME bracket as forecast (signedDist = 0): 371 (29.33%)
- Actual WARMER than forecast (signedDist > 0): 780 (61.66%)

**Asymmetry sanity check:** if forecasts are unbiased, cold ≈ warm.
Observed warm/cold ratio: 6.84
Memory baseline (audit-tail-sell-ev.ts): warm-side at ~60% of cohort due to cold-bias of sources.

> Pattern matches: actuals run hotter than forecast more often than colder. Foundation for the hot-side tail-sell hypothesis is intact.

## Analysis 2 — Hot-side bracket hit rate by distance (signedDist === +D)

Hit rate at distance +D = fraction of events where actual landed in the bracket exactly +D above the forecast bracket.
A hot-side tail-sell at distance +D LOSES when this hit occurs.

| Distance (above forecast) | °F equivalent | Events | Hit rate |
|---|---|---:|---:|
| +1 | +2°F | 459 | 36.28% |
| +2 | +4°F | 263 | 20.79% |
| +3 | +6°F | 38 | 3.00% |
| +4 | +8°F | 7 | 0.55% |
| +5 | +10°F | 13 | 1.03% |
| +6 | +12°F | 0 | 0.00% |
| +7 | +14°F | 0 | 0.00% |

## Analysis 3 — Cold-side baseline (sanity control)

Mirror of hot-side hit rate but for cold-side. Should match `memory/tail-sell-viability-2026-03-28.md` baseline.
Memory baseline: 0.24% cold-side hit rate at ±3.

| Distance (below forecast) | °F equivalent | Events | Hit rate |
|---|---|---:|---:|
| -1 | -2°F | 100 | 7.91% |
| -2 | -4°F | 12 | 0.95% |
| -3 | -6°F | 2 | 0.16% |
| -4 | -8°F | 0 | 0.00% |
| -5 | -10°F | 0 | 0.00% |
| -6 | -12°F | 0 | 0.00% |
| -7 | -14°F | 0 | 0.00% |

## Analysis 4 — Per-trade EV table — hot-side (selling YES at price P)

Per-trade EV for selling YES at price P on a hot-side bracket at distance +D from forecast.
Formula: EV = (1 - hitRate) × P × (1 - 0.1) - hitRate × (1 - P)
Fee model: 10% of profit on winning trades only (Kalshi standard).

| Distance | °F | Hit rate | YES=5¢ | YES=7¢ | YES=10¢ | YES=15¢ | YES=20¢ |
|---|---|---:|---:|---:|---:|---:|---:|
| +3 | +6°F | 3.00% | +1.51¢ | +3.32¢ ✓ | +6.03¢ ✓ | +10.54¢ ✓ | +15.06¢ ✓ |
| +4 | +8°F | 0.55% | +3.95¢ ✓ | +5.75¢ ✓ | +8.45¢ ✓ | +12.95¢ ✓ | +17.46¢ ✓ |
| +5 | +10°F | 1.03% | +3.48¢ ✓ | +5.28¢ ✓ | +7.98¢ ✓ | +12.49¢ ✓ | +16.99¢ ✓ |
| +6 | +12°F | 0.00% | +4.50¢ ✓ | +6.30¢ ✓ | +9.00¢ ✓ | +13.50¢ ✓ | +18.00¢ ✓ |
| +7 | +14°F | 0.00% | +4.50¢ ✓ | +6.30¢ ✓ | +9.00¢ ✓ | +13.50¢ ✓ | +18.00¢ ✓ |

Breakeven YES price by distance (where EV crosses 0 ignoring fees):
  +3: hit rate 3.00% → breakeven YES = 3.33¢
  +4: hit rate 0.55% → breakeven YES = 0.61¢
  +5: hit rate 1.03% → breakeven YES = 1.14¢
  +6: hit rate 0.00% → breakeven YES = 0.00¢
  +7: hit rate 0.00% → breakeven YES = 0.00¢

## Analysis 5 — Per-city hot-side hit rate at ≥+6°F

Hit rate at ≥+6°F (any hot-side outcome that would have closed a tail-sell at distance ≥3).
Per the GO criteria, ≥3 cities must pass the per-city EV gate.

| City | Events | ≥+6°F hits | Hit rate | EV at YES=10¢ | Pass? |
|---|---:|---:|---:|---:|---|
| CHI | 217 | 0 | 0.00% | +9.00¢ | ✓ |
| SFO | 177 | 0 | 0.00% | +9.00¢ | ✓ |
| AUS | 121 | 15 | 12.40% | -3.27¢ | ✗ |
| BOS | 103 | 14 | 13.59% | -4.46¢ | ✗ |
| NY | 88 | 3 | 3.41% | +5.63¢ | ✓ |
| PHIL | 83 | 6 | 7.23% | +1.84¢ | ✗ |
| SEA | 68 | 4 | 5.88% | +3.18¢ | ✗ |
| DC | 66 | 5 | 7.58% | +1.50¢ | ✗ |
| DAL | 57 | 5 | 8.77% | +0.32¢ | ✗ |
| DEN | 47 | 0 | 0.00% | +9.00¢ | ✓ |
| LV | 46 | 5 | 10.87% | -1.76¢ | ✗ |
| PHX | 45 | 0 | 0.00% | +9.00¢ | ✓ |
| ATL | 44 | 1 | 2.27% | +6.75¢ | ✓ |
| MIA | 40 | 0 | 0.00% | +9.00¢ | ✓ |
| HOU | 34 | 0 | 0.00% | +9.00¢ | ✓ |
| LAX | 29 | 0 | 0.00% | +9.00¢ | ✓ |

Passing cities: 9 / 16 (gate requires ≥3)

## Analysis 6 — Correlated blowup risk (heat-wave drawdown)

Hot-side tails are MORE correlated than cold-side because heat waves are regional and persistent.

Production position caps applied:
- MAX_PER_CITY_TYPE = 2 (per (city, temperatureType=high))
- MAX_NE_CORRIDOR = 5 (NY+DC+BOS+PHIL+PHI cap)
- MAX_TOTAL_LIVE = 8

On a heat-wave day, cold-side high wouldn't fire (forecasts running cold ≠ heat wave). So the 2-per-(city,type) cap is effectively all available to hot-side.

| Metric | Value |
|---|---|
| Worst single day | 2026-03-28 |
| Raw hits on worst day | 27 |
| Active positions after caps | 5 (cities: NY, DC, BOS) |
| Cap chain | 27 raw hits → 8 after per-city cap → 5 after NE-corridor cap → 5 after total cap |
| Worst-day P&L drawdown @ $20 position | -$99.00 |
| Worst-day P&L drawdown @ $50 position | -$247.50 |

Top 5 worst days (by capped active positions):
| Date | Raw hits | Capped active | Cities |
|---|---:|---:|---|
| 2026-03-28 | 27 | 5 | NY, DC, BOS |
| 2026-04-12 | 10 | 2 | AUS |
| 2026-04-19 | 4 | 2 | DAL |
| 2026-04-03 | 4 | 2 | AUS |
| 2026-03-21 | 4 | 2 | SEA |

## Decision Rules — GO / NO-GO / CONTINUE

| Check | Result | Detail |
|---|---|---|
| Hit rate at +6°F < 5% | ✓ PASS | Observed: 3.00% |
| Mean per-trade EV at +6°F across YES bands ≥ 3¢ | ✓ PASS | Observed: +7.29¢ |
| Worst-day drawdown at $20 position < $200 | ✓ PASS | Observed: -$99.00 |
| Worst-day drawdown at $50 position < $500 | ✓ PASS | Observed: -$247.50 |
| Sample n at +6°F+ ≥ 50 | ✓ PASS | Observed: 58 |
| ≥3 cities pass per-city EV gate | ✓ PASS | Observed: 9 |

## **VERDICT: GO**

All decision criteria pass. Proceed to Phase 4 (hot-side high-temp tail-sell deployment scope).
Recommended initial deployment: `HOT_TAIL_HIGH_MODE=paper` for 30 days, then evaluate flip-to-live.

## Caveats

- Coverage window is clean era (2026-03-21 onwards). May not include peak summer heat-wave months.
- YES price bands assumed (5-20¢) match cold-side observed range. Hot-side actual price distribution requires `kalshi_market_snapshots` join for full validation. This analysis tests structural EV at canonical price points.
- `temp_bias` retention is 180 days; sample beyond that is excluded.
- Hit-rate computation uses 2°F bracket convention. Kalshi threshold brackets (T-suffix) and inner brackets are bucketed identically.
- Correlated blowup analysis applies production position caps (MAX_PER_CITY_TYPE=2, MAX_NE_CORRIDOR=5, MAX_TOTAL_LIVE=8). Without caps, the worst-day raw-loss number would be much higher; capping is the realistic risk view.
- On a heat-wave day, cold-side high wouldn't fire (cold-side requires actual < forecast - 6°F, the opposite condition). So cold-side does not consume the 2-per-(city,type) budget on hot-side disaster days. Budget contention only matters on mild-bias days, which by definition are low-loss.
