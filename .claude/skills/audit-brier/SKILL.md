---
name: audit-brier
description: Audit Brier scores by price bucket and bet direction from resolved trades
---

# Brier Score Audit

Run a comprehensive Brier score audit against production data, broken down by price bucket and bet direction.

## Steps

1. SSH into the droplet and run the audit query:

```bash
ssh root@104.248.223.48 "mongosh '$MONGODB_URI' --quiet --eval '
const preds = db.market_predictions.find({
  resolvedOutcome: { \$in: [0, 1] },
  isTrade: true,
  correctedProbability: { \$gte: 0, \$lte: 1 }
}).toArray();

print(\"Total resolved trades: \" + preds.length);

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
print(\"Bucket | Trades | Model Brier | Market Brier | BSS\");
for (const b of buckets) {
  const group = preds.filter(p => p.marketPrice >= b.lo && p.marketPrice < b.hi);
  if (group.length === 0) continue;
  const modelB = group.reduce((s, p) => s + (p.correctedProbability - p.resolvedOutcome) ** 2, 0) / group.length;
  const marketB = group.reduce((s, p) => s + (p.marketPrice - p.resolvedOutcome) ** 2, 0) / group.length;
  const bss = marketB > 0 ? (1 - modelB / marketB).toFixed(2) : \"N/A\";
  print(b.label + \" | \" + group.length + \" | \" + modelB.toFixed(3) + \" | \" + marketB.toFixed(3) + \" | \" + bss);
}

// Bet direction breakdown
print(\"\n=== By Bet Direction ===\");
const yesBets = preds.filter(p => p.correctedProbability > p.marketPrice);
const noBets = preds.filter(p => p.correctedProbability <= p.marketPrice);
const yesWins = yesBets.filter(p => p.resolvedOutcome === 1).length;
const noWins = noBets.filter(p => p.resolvedOutcome === 0).length;
print(\"YES bets: \" + yesBets.length + \" total, \" + yesWins + \" wins (\" + (yesBets.length > 0 ? (yesWins/yesBets.length*100).toFixed(1) : 0) + \"%)\");
print(\"NO bets: \" + noBets.length + \" total, \" + noWins + \" wins (\" + (noBets.length > 0 ? (noWins/noBets.length*100).toFixed(1) : 0) + \"%)\");

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
3. Compare against the baseline audit from 2026-03-13 (BSS -1.07, 301 trades):
   - 0-10c was BSS -5.6, 70-100c was BSS -3.1 (worst buckets, now suppressed by tail guard)
   - YES bets won 5.7%, NO bets won 49.2%
   - Competitive range was 20-50c (BSS ~ -0.4)
4. Highlight improvements or regressions since baseline

## Optional: Post-Fix Only

Add a timestamp filter to see only post-fix trades:
```javascript
timestamp: { $gte: new Date("2026-03-13").getTime() }
```
