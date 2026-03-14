---
name: check-detector
description: Check if the disagreement detector has fired and review signal quality
---

# Disagreement Detector Status Check

Query production MongoDB for disagreement detector signals and assess firing rate and quality.

## Steps

1. SSH into the droplet and run the following queries:

**Signal count and recent signals:**
```bash
ssh root@104.248.223.48 "mongosh '$MONGODB_URI' --quiet --eval '
print(\"=== Disagreement Detector Signals ===\");
const total = db.signals.countDocuments({signalSource: \"disagreement-detector\"});
print(\"Total signals: \" + total);

print(\"\n=== Recent Signals (last 10) ===\");
db.signals.find({signalSource: \"disagreement-detector\"})
  .sort({timestamp: -1})
  .limit(10)
  .forEach(s => print(JSON.stringify({
    id: s.id,
    marketId: s.marketId,
    city: s.cityCode,
    edge: s.edge?.toFixed(3),
    direction: s.direction,
    signal: s.signal,
    outcome: s.outcome,
    time: new Date(s.timestamp).toISOString()
  })));

print(\"\n=== Resolution Rate ===\");
const resolved = db.signals.countDocuments({signalSource: \"disagreement-detector\", outcome: { \$exists: true }});
const wins = db.signals.countDocuments({signalSource: \"disagreement-detector\", outcome: true});
print(\"Resolved: \" + resolved + \"/\" + total);
if (resolved > 0) print(\"Win rate: \" + (wins/resolved*100).toFixed(1) + \"%\");
'"
```

2. Report:
   - Total signals fired
   - Firing rate (signals per day since deployment on 2026-03-13)
   - Resolution rate and win rate (if any have resolved)
   - Sample of recent signals with edge sizes
3. If zero signals have fired, note that the 2.0 degF threshold may need adjustment — suggest checking tail-guard suppression logs in PM2 for near-misses

## Comparison Query

To compare against probability-model signals in the same period:
```bash
db.signals.countDocuments({signalSource: {$ne: "disagreement-detector"}, timestamp: {$gte: new Date("2026-03-13").getTime()}})
```
