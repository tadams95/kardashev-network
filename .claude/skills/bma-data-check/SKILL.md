---
name: bma-data-check
description: Check if enough source_accuracy data has accumulated for BMA Phase 2
---

# BMA Data Readiness Check

Query production MongoDB to check whether per-source accuracy data is sufficient for BMA (Bayesian Model Averaging) Phase 2 implementation.

## Context

BMA requires per-source sigma_i (error standard deviation) per lead-time bucket. Each bucket needs >= 30 events for a reliable estimate. As of 2026-03-13, the <=18h bucket had only 9 events.

## Steps

1. SSH into the droplet and run the lead-bucket aggregation query:

```bash
ssh root@104.248.223.48 "mongosh '$MONGODB_URI' --quiet --eval '
db.source_accuracy.aggregate([
  { \$match: { absError: { \$exists: true, \$lte: 25 } } },
  { \$addFields: {
      leadBucket: {
        \$switch: {
          branches: [
            { case: { \$lte: [\"\$leadHours\", 18] }, then: \"<=18h\" },
            { case: { \$lte: [\"\$leadHours\", 30] }, then: \"18-30h\" },
            { case: { \$lte: [\"\$leadHours\", 42] }, then: \"30-42h\" }
          ],
          default: \">42h\"
        }
      }
  }},
  { \$group: {
      _id: { source: \"\$source\", leadBucket: \"\$leadBucket\" },
      count: { \$sum: 1 },
      rmse: { \$sqrt: { \$avg: { \$pow: [\"\$absError\", 2] } } },
      mae: { \$avg: \"\$absError\" }
  }},
  { \$sort: { \"_id.source\": 1, \"_id.leadBucket\": 1 } }
]).forEach(r => print(JSON.stringify(r)))
'"
```

2. Report results in a table: Source | Lead Bucket | Count | MAE | RMSE
3. Highlight any bucket with count < 30 (blocking BMA)
4. Calculate estimated days until the <=18h bucket reaches 30 events based on current accumulation rate (~82 records/day across all buckets)
5. Give a clear verdict: **Ready** or **Not ready (need ~N more days)**
