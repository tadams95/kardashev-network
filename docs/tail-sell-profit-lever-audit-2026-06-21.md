# Tail-Sell Profitability Lever Audit — 2026-06-21

**Author:** Quant audit (5-agent fan-out: selection / execution / breadth / sizing / empirical data)
**Scope:** Identify every lever to make the live Kalshi weather tail-sell book more profitable, and state honestly where it's already optimized.
**Status:** Findings verified against booking code + raw MongoDB documents. Recommendations pending independent review.

---

## 0. Headline P&L correction (read this first)

A prior audit reported **$2.80** realized live P&L and concluded the strategy "barely beats a high-yield savings account." **That was a unit bug.** The `pnl` field in `tail_sell_signals` is stored **per-contract** (`win ≈ +yesPrice`, `loss ≈ −(1 − yesPrice)`); total dollars require `pnl × filledCount`. The audit script (`scripts/audit-tail-sell-fills.ts`) and the recompute both summed `pnl` alone.

Corrected and verified (`tailSellTracker.ts:467-471` confirms per-contract booking; raw docs e.g. `pnl=−0.93, filledCount=10 → −$9.30`):

| Metric | Value |
|---|---|
| Real live P&L | **$53.55** over 65 days (Mar 29 – Jun 22) |
| Filled + resolved trades | 234 |
| Filled contracts | 4,425 |
| Win rate | 93.2% (218 W / 16 L) |
| Net edge | $0.0121 / contract |
| Annualized on ~$240 account | ~125% |
| Annualized on deployed capital | ~284% (if continuously cycled) |

**Caveats on the headline rate:** 65 days = one spring→early-summer regime; small absolute base (~$300/yr at current size); high-variance payoff (rare ~−$9 losses). Treat ~125% as "real and excellent, but a streak not yet regime-tested."

The audit script bug is **fixed** (now computes `pnl × filledCount`; re-run confirms $53.55).

---

## 1. The reframing finding: profit is concentrated in one city

The empirical dive surfaced the most important structural fact:

> **CHI alone ≈ +$63. The entire book = +$53.55. Ex-Chicago, the live book is roughly breakeven-to-negative.**

The book's profitability is effectively a single-city bet. This is simultaneously an opportunity (if structural) and a fragility (if luck), and it reframes every other lever — scaling up amplifies the CHI exposure before we know whether CHI's edge is repeatable.

### Per-city realized P&L (LIVE, filled)

| City | Net P&L | n | Win% | Note |
|---|---|---|---|---|
| **CHI** | **+$63** | 46 | 98% | carries the entire book |
| LV / SF / HOU | small + | <13 each | — | noisy, positive |
| NY | −$14 | 30 | 90% | soft loser |
| DAL | −$12 | 19 | — | soft loser |
| PHX | −$5 | 16 | — | marginal |
| **AUS** | **−$20** | 30 | 90% | consistent loser — prune candidate |
| **ATL** | **−$27** | 16 | 81% | consistent loser — prune candidate |

*Skeptic's hedge:* only 16 losses exist book-wide, so per-city loss attribution is fragile. Direction is clear (ATL/AUS negative on total, per-contract, and win-rate) but warrants shadow-demotion + re-confirmation rather than hard deletion.

---

## 2. Ranked levers

### Tier 1 — do now (free / near-free EV)

1. **Prune loser cities (ATL, AUS).** Negative on total AND per-contract AND win rate. Use the existing hot-tail blacklist mechanism. Shadow-demote → re-confirm over 2–3 weeks before hard blacklist.
2. **Resolve the CHI concentration question before scaling.** Structural edge (Lake Michigan microclimate → repeatable forecast bias) or 65-day variance? Highest-leverage *analysis* task. Gates Tier 2.

### Tier 2 — real levers, after Tier 1

3. **Position sizing.** Now genuinely justified at ~125%/yr (was wrongly dismissed at the buggy $2.80). Biggest *dollar* lever; scales ~linearly. Bound it: ruin scenario = 8 correlated losses ≈ −$160 on $240; don't amplify CHI before understanding it. Raise flat size *gradually* post-prune/post-CHI-check, watching fill rate + the $80 daily-loss breaker. **Skip edge-weighted/Kelly** — win rate is structural (cold bias), not edge-discriminated; ~10% upside at best, not worth complexity.
4. **Flip low/cold paper → live ($5).** Best paper quadrant per-contract (**+$0.062/ctr, 98.8% win, n=83**) and diversifies *away* from CHI-heavy high/cold. Run a fill-haircut screen first (prior Phase-A NO-GO; hypothetical fills). low/warm already live (n=257, +$0.040). **Skip high/warm** — paper breakeven (−$0.14, n=65).

### Tier 3 — execution (smaller / uncertain)

5. **Fill leak on best band.** Highest-EV entries (5–8¢, +$0.017/ctr) fill *worst* (~62%) vs ~75% at 13¢+. Clean win: **stale-signal age guard** (+5–10% fill, free). Avoid: aggressive pricing (EV-neutral-to-negative) and removing `post_only` (reintroduces stale-chase).
6. **Fee assumption is conservative** (books 10% vs Kalshi maker ~0%) → real net is *slightly higher* than $53.55. Confirm against a real `/portfolio/fills` statement. Not a lever, just upside.

---

## 3. Already optimal / EXHAUSTED — do not retread

- **TAIL_YES_MAX = 0.15** — validated twice; 15¢+ band loses **−$33** in live data. Don't loosen.
- **Market window 20–40¢** — validated (40–50¢ coin-flip, BSS −0.65).
- **Atmospheric edge** — demoted, no capturable trading edge (3 reviews + backtest).
- **YES-side signals** (13.8% win) and **BMA probability model** (deprecated/maintenance-only) — both dead. Don't tune.
- **Edge-weighted sizing, bracket-distance retune, min-source / ensemble-age knobs** — low priority; selection is well-tuned.

---

## 4. Capacity note

Breadth is **not** the binding constraint — `MAX_TOTAL=8` live has slack (0–2 open at audit), account ~56% idle. The constraint is per-day signal supply × per-bracket Kalshi liquidity (~low-thousands deployable). Levers are **prune → understand → size → diversify**, not "trade more cities/markets" (precip/wind untraded, no proven edge, thin liquidity).

---

## 5. Verdict — are we optimized?

- **Signal selection + dead-end elimination: yes, heavily.** No easy alpha left in knob-tuning.
- **Portfolio construction: no — and that's where the money is.** Built/tuned as a signal generator, never audited as a portfolio. It's a one-city bet wearing a fifteen-city coat. Remaining alpha = **prune losers → confirm Chicago is structural → scale the cleaned-up book** (with low/cold flipped in for diversification). That's the "compound, don't just accumulate" switch, now with data to justify throwing it.

---

## 6. Independent review + reconciliation (added 2026-06-21, supersedes §1–2 recommendations)

An independent Opus review challenged the audit and forced a data-universe reconciliation. Outcome: **the per-city "prune ATL/AUS" recommendation (§2 Tier-1 item 1) is RETRACTED, and "scale position size" (§2 Tier-2) is DEFERRED.** What actually held up:

**Universe reconciliation (all rows exact-fill-reconciled — no phantom fills):**

| Universe | n | Losses | Total $ | ex-CHI |
|---|---|---|---|---|
| Recent era (`mode='live'`, ~May→) | 162 | 9 | +$85.64 | +$32.48 |
| Early era (`mode=null`, ~April) | 72 | 7 | −$32.09 | — |
| **Full live history** | **234** | **16** | **+$53.55** | −$9.92 |

- The full-history **$53.55** is the honest number; the early-live month was a **−$32 net loser**. The strategy has only been strongly positive since ~May.
- **Per-city loser attribution is NOT robust** — it flips sign by era. ATL/AUS losses are ALL early-era; recently ATL=6W/0L, AUS=23W/2L. **Do not prune any city.**
- CHI carries the book in both eras (+$53–63), but CHI has 0–1 losses → **favorable variance, not a demonstrated structural edge** (P(0 losses in 34 | book rate) ≈ 14%).
- Whole-book bootstrap 95% CI on total-$ **crosses zero**. With ~16 losses across one spring→summer regime, no per-city or scaling conclusion is statistically supportable yet.

**Revised recommended path forward:**
1. **Do NOT prune cities** — attribution is era-contaminated + noise (16 losses book-wide).
2. **Do NOT scale yet** — book CI includes zero; CHI (the profit engine) is ~1 loss from mean-reverting; one regime only.
3. **Resolve the early-vs-recent regime shift** (−$32 → +$85.64): did a real change land (tuning / fill-recon fix / `post_only`) making recent data the better forward estimate, or is it variance? This is the key analytical question — bigger than CHI-vs-rest.
4. **Promote fill-reconciliation hygiene to Tier 1** — 20% of resolved orders never fill; reconciliation state drove the entire audit disagreement.
5. **Keep the book small**; let it accrue 20–30 real losses across the summer regime, then re-test per-city + per-era attribution.
6. §3 exhausted list stands.

## 7. Resolution of the two open questions (added 2026-06-21)

Both §6 open questions are now answered with data. They converge on **"let it run as-is."**

### 7a. The April→May regime shift is STRUCTURAL (a real fix), not variance
Split at 2026-05-07 (`TAIL_YES_MAX` 0.20→0.15 cut):
- BEFORE: 87 trades, 8 losses, **−$33.42**
- AFTER: 147 trades, 8 losses, **+$86.97**
- The early loss was the band that got cut: the **>15¢ band alone = −$48.33** (4 of 8 early-era losses). **Counterfactual: early era minus the >15¢ band = +$14.91** (vs actual −$33.42).
- Conclusion: the owner correctly recalled pruning a price band heading into May. The regime shift is explained by that prune — the recent +$86.97 era is the trustworthy forward rate, NOT a lucky streak. *Residual:* a few `avgFillYesPrice` >15¢ rows persist (last 2026-06-19) — these are execution slippage / stale-fill taker chases (e.g. the documented 6/19 NY 15→35¢ incident), already addressed by the `post_only` fix; confirm none recur.

### 7b. The ~33% non-fill is a PROTECTIVE FEATURE, not a thin-book defect (independent Opus, REFUTED the partial-fill hypothesis)
- Fills are **96% all-or-nothing** (only 3.9% true partials) → not a thin-depth/partial-fill story.
- Thin-book signature FAILS: bigger (standard ~21-lot) orders fill BEST (76%), small odd orders worst — opposite of a depth ceiling.
- **Decisive: zero-fill orders have a 4.3% win rate vs 93.2% on filled orders.** A taker only lifts our resting sell-YES when the tail is actually coming in — i.e. exactly the events we'd LOSE. The book refusing to fill us is **selecting our losers out.**
- Cost of non-fills ≈ break-even (+$10 gross = missed cheap-band winners ≈ cancelled by dodged cheap-band losers). Chasing fills (taker orders, crossing spread, bigger size) would **import 4.3%-win-rate losers**, not capture missed premium. **Do NOT chase fills.**
- Zero-fill rate is improving (Apr 54% → May 22% → Jun 18%), consistent with the V2 + `post_only` cutover settling.

### 7c. Final conclusion
**Let the system run in its current state.** Recent profitability is structurally explained, the fill behavior is protective, and every studied lever is either exhausted or premature-to-pull on one regime / ~16 losses. The next decision point is a re-audit after the summer regime adds 20–30 real losses — then re-test scaling + per-city/per-era attribution. No code or config change recommended now beyond committing the audit-script P&L fix.

## Appendix — source references

- P&L unit bug + corrected figures: `memory/tail-sell-fill-reconciliation-gap-2026-06-21` section
- Lever roadmap: `memory/tail-sell-profit-levers-2026-06-21.md`
- Booking logic: `src/lib/models/tailSellTracker.ts:448-471`
- Sizing: `scripts/execute-tail-sells.ts:80`, `tailSellTracker.ts:34-38`
- Entry/window knobs: `src/lib/computeOpportunities.ts` (TAIL_YES_MIN/MAX ~88-89, market threshold ~1087-1088)
- Audit tool (fixed): `scripts/audit-tail-sell-fills.ts`
