[retro] candidate markets in 4-24h pre-resolution window: 27
[retro] unique city-days to fetch obs for: 23
[retro] obs fetch failed for ATL 20260423: IowaMesonet HTTP 429 for KATL
[retro] obs fetch failed for BOS 20260423: IowaMesonet HTTP 429 for KBOS
[retro] obs fetch failed for SEA 20260423: IowaMesonet HTTP 429 for KSEA
[retro] obs fetch failed for SFO 20260423: IowaMesonet HTTP 429 for KSFO
[retro] obs fetch failed for SFO 20260418: IowaMesonet HTTP 429 for KSFO
[retro] obs fetch failed for SEA 20260416: IowaMesonet HTTP 429 for KSEA
[retro] obs fetch failed for DAL 20260415: IowaMesonet HTTP 429 for KDFW
[retro] processed 10/23 city-days; results=2
[retro] obs fetch failed for ATL 20260414: IowaMesonet HTTP 429 for KATL
[retro] obs fetch failed for CHI 20260413: IowaMesonet HTTP 429 for KMDW
[retro] obs fetch failed for BOS 20260413: IowaMesonet HTTP 429 for KBOS
[retro] obs fetch failed for SFO 20260412: IowaMesonet HTTP 429 for KSFO
[retro] obs fetch failed for DC 20260410: IowaMesonet HTTP 429 for KDCA
[retro] obs fetch failed for BOS 20260410: IowaMesonet HTTP 429 for KBOS
[retro] obs fetch failed for SFO 20260410: IowaMesonet HTTP 429 for KSFO
[retro] obs fetch failed for CHI 20260409: IowaMesonet HTTP 429 for KMDW
[retro] obs fetch failed for MIA 20260409: IowaMesonet HTTP 429 for KMIA
[retro] processed 20/23 city-days; results=3
[retro] obs fetch failed for BOS 20260409: IowaMesonet HTTP 429 for KBOS
[retro] obs fetch failed for SFO 20260409: IowaMesonet HTTP 429 for KSFO
[retro] obs fetch failed for PHIL 20260409: IowaMesonet HTTP 429 for KPHL
[retro] total results: 4
# Late-Day Arbitrage — Mid-Day Retrospective (Phase 2)

**Generated:** 2026-05-02T21:47:07.185Z
**Lookback:** last 30 days resolved markets
**Snapshot window:** 4–24h before resolution
**σ heuristic:** σ_2 (medium — 2°F/h, cap 5°F)

## Sample sizes

- Candidate markets in pre-resolution window: 27
- Successfully joined with observation data: 4
- "Decided" by observation (obs-implied YES <3% or >97%): 0
- Undecided (obs-implied between 3-97%): 4

## Headline finding

No markets in the sample met the "decided" criterion at the 4–24h window.

## Predictive accuracy

- Kalshi mid-day price (≥0.5 → YES) agrees with outcome (all cases): 50.0% of 4

## By city (top 10 by sample size)

| City | Total | Decided | Mean |gap| |
|---|---|---|---|
| SFO | 2 | 0 | 0.181 |
| LV | 1 | 0 | 0.228 |
| BOS | 1 | 0 | 0.466 |

## Caveats

- **Survivorship bias:** `market_predictions` rows only exist for markets where our pipeline emitted a non-HOLD signal. HOLDs are filtered. So this sample over-represents markets with clear forecasts (one direction dominant) and under-represents the most-uncertain markets — exactly where late-day arb might appear most.
- **Inner brackets excluded:** the marketId regex skips inner-bracket events (no -B/-T suffix). Phase 1 forward instrumentation captures these via the structured Kalshi response.
- **σ heuristic is a guess:** σ=2°F/h cap 5°F is one of three candidates. Phase 1 captures all three; this retro uses only σ_2.
- **Pre-resolution snapshot is at least 4h before settlement, often 8-24h.** Late-day-arb hypothesis is most relevant in the LAST few hours; this retro tests a much weaker version. A null finding here doesn't rule out a strong late-window edge.

