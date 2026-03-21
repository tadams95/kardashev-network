---
name: audit-brier
description: Audit Brier scores by price bucket and bet direction from resolved trades
---

# Brier Score Audit

Run a comprehensive Brier score audit against production data, broken down by price bucket and bet direction.

## Arguments

- Optional: a `since` date (ISO string like `2026-03-15` or epoch ms). If provided, only trades after that timestamp are included. Use this to isolate post-deploy performance (e.g., post-BMA signals only).

## Critical: Database Access

- **Env var:** `MONGO_CONNECTION_STRING` (NOT `MONGODB_URI`)
- **Extract with grep** — do NOT `source .env.local` (multiline PEM keys break shell parsing)
- **Database:** `kardashev` — connection string defaults to `test`, must use `db.getSiblingDB("kardashev")`
- **Collection:** `market_predictions`
- **Key fields:** `correctedProbability`, `marketPrice`, `resolvedOutcome` (0|1), `isTrade`, `tradeSignal`, `policyVersion`, `timestamp`

## Steps

1. SSH into the droplet and run the audit query. If a `since` argument was provided, set `sinceEpoch` to that value. Otherwise set to 0 to include all trades.

```bash
ssh root@104.248.223.48 "cd /var/www/kardashev && MONGODB_URI=\$(grep '^MONGO_CONNECTION_STRING=' .env.local | cut -d= -f2-) && mongosh \"\$MONGODB_URI\" --quiet --eval '
// SINCE_FILTER: if a since argument was given, set sinceEpoch to that value
// e.g., const sinceEpoch = new Date(\"2026-03-15\").getTime();
// Otherwise set to 0 to include all trades
const sinceEpoch = 0;

const kdb = db.getSiblingDB(\"kardashev\");

const query = {
  resolvedOutcome: { \$in: [0, 1] },
  isTrade: true,
  correctedProbability: { \$gte: 0, \$lte: 1 }
};
if (sinceEpoch > 0) query.timestamp = { \$gte: sinceEpoch };

const preds = kdb.market_predictions.find(query).toArray();

print(\"Total resolved trades: \" + preds.length);
if (sinceEpoch > 0) print(\"Since: \" + new Date(sinceEpoch).toISOString());

// Date range
const timestamps = preds.map(p => p.timestamp).sort();
if (preds.length > 0) print(\"Date range: \" + new Date(timestamps[0]).toISOString().slice(0,10) + \" to \" + new Date(timestamps[timestamps.length-1]).toISOString().slice(0,10));

// Price bucket breakdown
const buckets = [
  { label: \"0-10c\", lo: 0, hi: 0.10 },
  { label: \"10-20c\", lo: 0.10, hi: 0.20 },
  { label: \"20-30c\", lo: 0.20, hi: 0.30 },
  { label: \"30-50c\", lo: 0.30, hi: 0.50 },
  { label: \"50-70c\", lo: 0.50, hi: 0.70 },
  { label: \"70-100c\", lo: 0.70, hi: 1.01 }
];

print(\"\n=== BSS by Price Bucket ===\");
print(\"Bucket     | Trades | Model Brier | Market Brier | BSS\");
for (const b of buckets) {
  const group = preds.filter(p => p.marketPrice >= b.lo && p.marketPrice < b.hi);
  if (group.length === 0) { print(b.label.padEnd(10) + \" | 0      | -           | -            | -\"); continue; }
  const modelB = group.reduce((s, p) => s + (p.correctedProbability - p.resolvedOutcome) ** 2, 0) / group.length;
  const marketB = group.reduce((s, p) => s + (p.marketPrice - p.resolvedOutcome) ** 2, 0) / group.length;
  const bss = marketB > 0 ? (1 - modelB / marketB).toFixed(2) : \"N/A\";
  const wins = group.filter(p => (p.correctedProbability > p.marketPrice && p.resolvedOutcome === 1) || (p.correctedProbability <= p.marketPrice && p.resolvedOutcome === 0)).length;
  print(b.label.padEnd(10) + \" | \" + String(group.length).padEnd(6) + \" | \" + modelB.toFixed(3).padEnd(11) + \" | \" + marketB.toFixed(3).padEnd(12) + \" | \" + bss + \" (\" + (wins/group.length*100).toFixed(0) + \"% win)\");
}

// Bet direction breakdown
print(\"\n=== By Bet Direction ===\");
const yesBets = preds.filter(p => p.correctedProbability > p.marketPrice);
const noBets = preds.filter(p => p.correctedProbability <= p.marketPrice);
const yesWins = yesBets.filter(p => p.resolvedOutcome === 1).length;
const noWins = noBets.filter(p => p.resolvedOutcome === 0).length;
print(\"YES bets: \" + yesBets.length + \" total, \" + yesWins + \" wins (\" + (yesBets.length > 0 ? (yesWins/yesBets.length*100).toFixed(1) : 0) + \"%)\");
print(\"NO bets: \" + noBets.length + \" total, \" + noWins + \" wins (\" + (noBets.length > 0 ? (noWins/noBets.length*100).toFixed(1) : 0) + \"%)\");

// By policy version
print(\"\n=== By Policy Version ===\");
const versions = [...new Set(preds.map(p => p.policyVersion || \"unknown\"))].sort();
for (const v of versions) {
  const group = preds.filter(p => (p.policyVersion || \"unknown\") === v);
  const modelB = group.reduce((s, p) => s + (p.correctedProbability - p.resolvedOutcome) ** 2, 0) / group.length;
  const marketB = group.reduce((s, p) => s + (p.marketPrice - p.resolvedOutcome) ** 2, 0) / group.length;
  const bss = marketB > 0 ? (1 - modelB / marketB).toFixed(2) : \"N/A\";
  print(v + \": \" + group.length + \" trades, BSS=\" + bss);
}

// Overall
const modelBrier = preds.reduce((s, p) => s + (p.correctedProbability - p.resolvedOutcome) ** 2, 0) / preds.length;
const marketBrier = preds.reduce((s, p) => s + (p.marketPrice - p.resolvedOutcome) ** 2, 0) / preds.length;
print(\"\n=== Overall ===\");
print(\"Model Brier: \" + modelBrier.toFixed(3));
print(\"Market Brier: \" + marketBrier.toFixed(3));
print(\"BSS: \" + (1 - modelBrier / marketBrier).toFixed(3));
'"
```

2. Format results into a markdown table
3. Compare against baselines:
   - **Pre-BMA baseline (2026-03-15):** BSS -1.09, NO win rate 63.9% (83 trades in 20-50c), ~53 signals/day
   - **Original baseline (2026-03-13):** BSS -1.07, 301 trades, YES 5.7%, NO 49.2%
   - **Post-normalization-fix (2026-03-21):** BSS -1.11, 568 trades, 20-30c best bucket (BSS -0.28, 63% win)
   - Competitive range: 20-30c (BSS ~ -0.28), 30-50c (BSS ~ -0.44)
4. Highlight improvements or regressions since baseline
