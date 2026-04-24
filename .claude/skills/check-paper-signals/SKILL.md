# Check Paper Inner-Bracket Signals

Retroactive paper-trade analysis for the Sweet Spot inner-bracket viability question. Applies the qualification criteria from `src/lib/models/paperSignals.ts` to historical `market_predictions` rows (no production wiring needed) and computes paper BSS, win rate, hypothetical $10/pos P&L, per-lead-bucket slices, and Go-Live gate readiness.

## Arguments

- Optional: a `since` date (ISO string like `2026-04-02` or epoch ms). Filters paper signals to predictions after that timestamp. Useful for isolating post-Phase-2 performance or post-deploy windows.

## Critical: Database Access

- **Env var:** `MONGO_CONNECTION_STRING` (NOT `MONGODB_URI`)
- **Extract with grep** — do NOT `source .env.local` (multiline PEM keys break shell parsing)
- **Database:** `kardashev` — connection string defaults to `test`, must use `db.getSiblingDB("kardashev")`
- **Collections:** `market_predictions`
- **Quoting:** Use heredoc `<<'REMOTE_SCRIPT'` to pipe the SSH command — avoids `!` escaping issues in zsh double-quoted strings

## Criteria reference

These thresholds MUST stay in sync with `src/lib/models/paperSignals.ts`. Update both places when criteria change.

```
PAPER_LEAD_MIN_HOURS  = 12   (inclusive)
PAPER_LEAD_MAX_HOURS  = 48   (exclusive)
PAPER_PRICE_MIN       = 0.20 (inclusive)
PAPER_PRICE_MAX       = 0.40 (exclusive)
PAPER_MIN_EDGE        = 0.05 (5pp gap, market - corrected)
Direction             = NO-side only (corrected < market)
Bracket regime        = inner only (excluded via marketId regex /-T\d/)
```

## Steps

1. SSH into the droplet and run the audit query. If a `since` argument was provided, set `sinceEpoch` to that value. Otherwise set to 0 to include all qualifying predictions.

```bash
ssh root@104.248.223.48 bash <<'REMOTE_SCRIPT'
cd /var/www/kardashev
MONGODB_URI=$(grep '^MONGO_CONNECTION_STRING=' .env.local | cut -d= -f2-)
mongosh "$MONGODB_URI" --quiet --eval '
const kdb = db.getSiblingDB("kardashev");

// SINCE_FILTER: set to a specific epoch when a since argument is given
const sinceEpoch = 0;
const HYPOTHETICAL_POSITION = 10;
const KALSHI_FEE_RATE = 0.07;

// Apply paper criteria to predictions; exclude threshold brackets (-T\d) and require resolved outcomes for metrics
const baseMatch = {
  resolvedOutcome: { $in: [0, 1] },
  correctedProbability: { $gte: 0, $lte: 1 },
  marketPrice: { $gte: 0.20, $lt: 0.40 },
  hoursToResolution: { $gte: 12, $lt: 48 },
  marketId: { $not: /-T\d/ },
};
if (sinceEpoch > 0) baseMatch.timestamp = { $gte: sinceEpoch };

const all = kdb.market_predictions.find(baseMatch).toArray();

// Apply direction + edge filters in JS (mongo $expr would work but JS is clearer)
const paper = all.filter(p =>
  p.correctedProbability < p.marketPrice &&
  (p.marketPrice - p.correctedProbability) >= 0.05 - 1e-9
);

print("=== 1. PAPER SAMPLE ===");
print("Total predictions in qualifying band: " + all.length);
print("Paper signals (NO + 5pp edge): " + paper.length);
if (sinceEpoch > 0) print("Window: since " + new Date(sinceEpoch).toISOString().slice(0,10));
if (paper.length > 0) {
  const ts = paper.map(p => p.timestamp).sort();
  print("Date range: " + new Date(ts[0]).toISOString().slice(0,10) + " to " + new Date(ts[ts.length-1]).toISOString().slice(0,10));
}

if (paper.length === 0) {
  print("\n>> No paper signals in window. Cannot compute metrics.");
  quit();
}

// Lead bucket assignment (matches paperSignals.ts leadBucket function)
function leadBucket(h) {
  if (h < 24) return "12to24h";
  if (h < 36) return "24to36h";
  return "36to48h";
}

// Hypothetical pnl for a NO-side bet:
//   contracts = floor(POSITION / (1 - marketPrice))   // collateral per contract
//   if outcome === 0 (NO wins): contracts * (1 - 0.07)  net premium kept
//   if outcome === 1 (NO loses): -contracts * marketPrice  collateral burned proportional
// Closer approximation to Kalshi binary settlement:
//   cost  = contracts * (1 - marketPrice)
//   payoff if NO wins = contracts * 1.0
//   gross profit = contracts * marketPrice
//   net profit (after fee on profit only) = grossProfit * (1 - fee)
//   loss = -cost
function hypotheticalPnl(p) {
  const noPrice = 1 - p.marketPrice;
  if (noPrice <= 0) return 0;
  const contracts = Math.floor(HYPOTHETICAL_POSITION / noPrice);
  if (contracts <= 0) return 0;
  const cost = contracts * noPrice;
  if (p.resolvedOutcome === 0) {
    const gross = contracts * p.marketPrice;
    return gross * (1 - KALSHI_FEE_RATE);
  } else {
    return -cost;
  }
}

print("\n=== 2. PAPER BSS vs MARKET ===");
const modelB = paper.reduce((s,p) => s + Math.pow(p.correctedProbability - p.resolvedOutcome, 2), 0) / paper.length;
const marketB = paper.reduce((s,p) => s + Math.pow(p.marketPrice - p.resolvedOutcome, 2), 0) / paper.length;
const bss = marketB > 0 ? (1 - modelB / marketB) : NaN;
const wins = paper.filter(p => p.resolvedOutcome === 0).length; // NO wins on outcome=0
print("Paper trades: " + paper.length);
print("Win rate (NO): " + (wins / paper.length * 100).toFixed(1) + "%");
print("Model Brier: " + modelB.toFixed(3));
print("Market Brier: " + marketB.toFixed(3));
print("Paper BSS: " + bss.toFixed(3) + (bss > 0 ? " ✓ POSITIVE" : ""));

const totalPnl = paper.reduce((s,p) => s + hypotheticalPnl(p), 0);
print("Hypothetical $10/pos total P&L: $" + totalPnl.toFixed(2));
print("Per-trade EV: $" + (totalPnl / paper.length).toFixed(3));

print("\n=== 3. PER-LEAD-BUCKET SLICE ===");
const buckets = ["12to24h", "24to36h", "36to48h"];
print("Bucket   | Trades | Win% | BSS    | $ P&L");
for (const b of buckets) {
  const grp = paper.filter(p => leadBucket(p.hoursToResolution) === b);
  if (grp.length === 0) { print(b.padEnd(8) + " | 0"); continue; }
  const mB = grp.reduce((s,p) => s + Math.pow(p.correctedProbability - p.resolvedOutcome, 2), 0) / grp.length;
  const kB = grp.reduce((s,p) => s + Math.pow(p.marketPrice - p.resolvedOutcome, 2), 0) / grp.length;
  const bb = kB > 0 ? (1 - mB / kB).toFixed(2) : "N/A";
  const w = grp.filter(p => p.resolvedOutcome === 0).length;
  const pl = grp.reduce((s,p) => s + hypotheticalPnl(p), 0);
  print(b.padEnd(8) + " | " + String(grp.length).padEnd(6) + " | " + (w/grp.length*100).toFixed(0).padEnd(4) + " | " + String(bb).padEnd(6) + " | $" + pl.toFixed(2));
}

print("\n=== 4. PER-EDGE-MAGNITUDE SLICE ===");
const edgeBuckets = [
  { label: "5-7pp",   lo: 0.05, hi: 0.07 },
  { label: "7-10pp",  lo: 0.07, hi: 0.10 },
  { label: "10-15pp", lo: 0.10, hi: 0.15 },
  { label: "15pp+",   lo: 0.15, hi: 1.00 },
];
print("Edge     | Trades | Win% | BSS    | $ P&L");
for (const e of edgeBuckets) {
  const grp = paper.filter(p => {
    const ed = p.marketPrice - p.correctedProbability;
    return ed >= e.lo && ed < e.hi;
  });
  if (grp.length === 0) { print(e.label.padEnd(8) + " | 0"); continue; }
  const mB = grp.reduce((s,p) => s + Math.pow(p.correctedProbability - p.resolvedOutcome, 2), 0) / grp.length;
  const kB = grp.reduce((s,p) => s + Math.pow(p.marketPrice - p.resolvedOutcome, 2), 0) / grp.length;
  const bb = kB > 0 ? (1 - mB / kB).toFixed(2) : "N/A";
  const w = grp.filter(p => p.resolvedOutcome === 0).length;
  const pl = grp.reduce((s,p) => s + hypotheticalPnl(p), 0);
  print(e.label.padEnd(8) + " | " + String(grp.length).padEnd(6) + " | " + (w/grp.length*100).toFixed(0).padEnd(4) + " | " + String(bb).padEnd(6) + " | $" + pl.toFixed(2));
}

print("\n=== 5. PER-CITY DISTRIBUTION ===");
const byCity = {};
for (const p of paper) {
  const c = p.cityCode || "UNK";
  if (!byCity[c]) byCity[c] = { n: 0, wins: 0, pnl: 0 };
  byCity[c].n++;
  if (p.resolvedOutcome === 0) byCity[c].wins++;
  byCity[c].pnl += hypotheticalPnl(p);
}
const cities = Object.entries(byCity).sort((a,b) => b[1].n - a[1].n);
print("City | Trades | Win% | $ P&L");
for (const [c, s] of cities) {
  print(c.padEnd(5) + "| " + String(s.n).padEnd(7) + "| " + (s.wins/s.n*100).toFixed(0).padEnd(5) + "| $" + s.pnl.toFixed(2));
}

print("\n=== 6. ROLLING 7-DAY BSS ===");
const sevenDaysAgo = Date.now() - 7 * 86400000;
const recent = paper.filter(p => p.timestamp >= sevenDaysAgo);
if (recent.length > 0) {
  const mB = recent.reduce((s,p) => s + Math.pow(p.correctedProbability - p.resolvedOutcome, 2), 0) / recent.length;
  const kB = recent.reduce((s,p) => s + Math.pow(p.marketPrice - p.resolvedOutcome, 2), 0) / recent.length;
  const bb = kB > 0 ? (1 - mB / kB).toFixed(3) : "N/A";
  const w = recent.filter(p => p.resolvedOutcome === 0).length;
  const pl = recent.reduce((s,p) => s + hypotheticalPnl(p), 0);
  print("Last 7d: " + recent.length + " trades, " + (w/recent.length*100).toFixed(0) + "% win, BSS " + bb + ", $ P&L " + pl.toFixed(2));
} else {
  print("No paper signals in last 7 days");
}

print("\n=== 7. OVERLAP WITH ACTUAL TRADES ===");
const isTradeOverlap = paper.filter(p => p.isTrade === true).length;
print("Paper signals also flagged as live trades: " + isTradeOverlap + " / " + paper.length + " (" + (isTradeOverlap/paper.length*100).toFixed(0) + "%)");
print("Paper signals NOT placed live (would have added to volume): " + (paper.length - isTradeOverlap));

print("\n=== 8. GO-LIVE GATES ===");
function gate(label, met, detail) {
  print((met ? "✓ " : "✗ ") + label + " — " + detail);
}
gate("Paper sample ≥ 50 resolved", paper.length >= 50, paper.length + " resolved (need 50+)");
gate("Paper BSS > 0", bss > 0, "BSS " + bss.toFixed(3));
gate("Rolling 7d BSS > 0", recent.length > 0 && recent.length >= 10 && (() => {
  const mB = recent.reduce((s,p) => s + Math.pow(p.correctedProbability - p.resolvedOutcome, 2), 0) / recent.length;
  const kB = recent.reduce((s,p) => s + Math.pow(p.marketPrice - p.resolvedOutcome, 2), 0) / recent.length;
  return kB > 0 && (1 - mB/kB) > 0;
})(), recent.length >= 10 ? recent.length + " trades in last 7d" : "Need 10+ trades in last 7d (have " + recent.length + ")");
gate("Hypothetical $10/pos P&L positive", totalPnl > 0, "$" + totalPnl.toFixed(2));

// Per-lead-bucket consistency: 2 of 3 buckets must show positive BSS
const bucketBss = buckets.map(b => {
  const grp = paper.filter(p => leadBucket(p.hoursToResolution) === b);
  if (grp.length < 5) return null;  // need min sample per bucket
  const mB = grp.reduce((s,p) => s + Math.pow(p.correctedProbability - p.resolvedOutcome, 2), 0) / grp.length;
  const kB = grp.reduce((s,p) => s + Math.pow(p.marketPrice - p.resolvedOutcome, 2), 0) / grp.length;
  return kB > 0 ? (1 - mB / kB) : null;
});
const positiveBuckets = bucketBss.filter(b => b !== null && b > 0).length;
gate("Per-lead-bucket consistency (≥2 of 3 buckets BSS > 0)", positiveBuckets >= 2, positiveBuckets + " of 3 buckets positive");

print("");
const allGatesMet = paper.length >= 50 && bss > 0 && totalPnl > 0 && positiveBuckets >= 2 && (recent.length >= 10 && (() => {
  const mB = recent.reduce((s,p) => s + Math.pow(p.correctedProbability - p.resolvedOutcome, 2), 0) / recent.length;
  const kB = recent.reduce((s,p) => s + Math.pow(p.marketPrice - p.resolvedOutcome, 2), 0) / recent.length;
  return kB > 0 && (1 - mB/kB) > 0;
})());
print(">> " + (allGatesMet ? "ALL GATES MET — inner-bracket automation worth designing" : "Gates not all met — continue paper observation"));

print("\n=== 9. REJECTION HISTOGRAM (predictions in band but rejected) ===");
const rejected = all.filter(p => !(p.correctedProbability < p.marketPrice && (p.marketPrice - p.correctedProbability) >= 0.05 - 1e-9));
const wrongDirection = rejected.filter(p => p.correctedProbability >= p.marketPrice).length;
const edgeTooSmall = rejected.length - wrongDirection;
print("Predictions in band (12-48h, 20-40c, inner): " + all.length);
print("  Qualified as paper:        " + paper.length);
print("  Rejected — wrong direction (YES): " + wrongDirection);
print("  Rejected — edge < 5pp:     " + edgeTooSmall);
'
REMOTE_SCRIPT
```

2. Parse the output and format into a report with the following sections.

## Report Format

### 1. Paper Sample
- Total predictions in band, paper-qualified count, date range, since-filter if applicable
- Flag if paper sample is < 50 (gate failure)

### 2. Paper BSS vs Market
- Win rate (NO outcome rate), Brier scores, paper BSS
- Hypothetical $10/pos total P&L and per-trade EV
- Highlight if BSS > 0 (the headline viability signal)

### 3. Per-Lead-Bucket Slice
- 12-24h, 24-36h, 36-48h breakdown — find which lead times carry the edge
- Per `memory/trading-sweet-spot-2026-03-23.md`, 24-36h is the historical sweet spot

### 4. Per-Edge-Magnitude Slice
- 5-7pp, 7-10pp, 10-15pp, 15pp+ buckets
- Tells us whether tightening the edge threshold (e.g., 7pp instead of 5pp) would improve performance

### 5. Per-City Distribution
- Which cities contribute most paper trades + per-city win rate
- Spot city-specific patterns (e.g., NE corridor concentration risk)

### 6. Rolling 7-Day BSS
- Recent trend — confirms the full-window result isn't driven by a stale regime
- Gates require both full-window AND 7-day positive

### 7. Overlap with Actual Trades
- How many paper signals were ALSO flagged `isTrade=true` (live)
- Tells us how much paper criteria deviate from current production trading
- High overlap → paper is a tighter version of what we already do; low overlap → paper captures different opportunities

### 8. Go-Live Gates
Five gates total:
- Paper sample ≥ 50 resolved (statistical floor)
- Paper BSS > 0 (the viability signal)
- Rolling 7d BSS > 0 (recent confirmation)
- Hypothetical $10/pos P&L > 0 (sanity check on dollar EV)
- Per-lead-bucket consistency: ≥ 2 of 3 buckets show BSS > 0

### 9. Rejection Histogram
- Of predictions IN the qualifying band (lead/price/regime), how many got filtered by direction vs edge
- Helps tune the criteria (e.g., if 95% are rejected for "edge too small", maybe lower the threshold)

## Interpretation Guide

- **Paper BSS:** computed against market price (same as `/audit-brier`). Positive = paper-qualified subset beats market.
- **NO win rate:** paper signals are NO-only. "Win" = `resolvedOutcome === 0` (the bracket did NOT settle).
- **Hypothetical P&L:** assumes $10 position size, NO-side fill at `1 - marketPrice` (no slippage), 7% Kalshi fee on profit.
- **Edge magnitude:** `marketPrice - correctedProbability`. Higher edge should imply better win rate; if not, the model probability is noisy in that range.
- **Lead-bucket consistency:** the user explicitly chose 2-of-3 (not 3-of-3) on 2026-04-24 — strict enough to filter noise, loose enough to be achievable.

## Reference Values

| Metric | Source | Notes |
|--------|--------|-------|
| Criteria thresholds | `src/lib/models/paperSignals.ts` | Update both files when criteria change |
| Live tightened gate | hard gate ≤10¢/>40¢ added 2026-03-24 | Production filter |
| Sweet spot historical | 20-30¢ NO 789 trades / 82% win / -0.04 BSS | Pre-Phase-2 corpus |
| Phase 2 deploy | commit `8886f1f`, 2026-04-20 | Use `--since 2026-04-20` to isolate post-deploy effect |

## Notes

- MongoDB is **Atlas** (cloud), not local. Never use `mongosh` without the connection string.
- Uses `bash <<'REMOTE_SCRIPT'` heredoc to avoid zsh `!` escaping issues in double-quoted SSH strings.
- `correctedProbability` = post-calibration probability; we use it for paper qualification (not raw)
- Threshold brackets (`-T\d` suffix) are excluded from paper signals — those are tail-sell territory
- Hypothetical P&L doesn't account for fill slippage, partial fills, or order book depth — backtest only
- Droplet IP: `104.248.223.48`
