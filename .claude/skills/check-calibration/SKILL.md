---
name: check-calibration
description: Check calibration model health — active model metadata, BSS by model, reliability diagram, training readiness, retrain recommendation
---

# Check Calibration

Comprehensive calibration health check: active model metadata, per-model BSS, reliability diagram, raw vs calibrated lift, training data readiness, segment coverage, and retrain recommendation.

## Arguments

- Optional: a `since` date (ISO string like `2026-04-02` or epoch ms). If provided, sections 3-5 filter to trades after that date. Useful for isolating post-retrain or post-deploy performance.

## Critical: Database Access

- **Env var:** `MONGO_CONNECTION_STRING` (NOT `MONGODB_URI`)
- **Extract with grep** — do NOT `source .env.local` (multiline PEM keys break shell parsing)
- **Database:** `kardashev` — connection string defaults to `test`, must use `db.getSiblingDB("kardashev")`
- **Collections:** `calibration`, `market_predictions`
- **Quoting:** Use heredoc `<<'REMOTE_SCRIPT'` to pipe the SSH command — avoids `!` escaping issues in zsh double-quoted strings

## Steps

1. SSH into the droplet and run the full audit query. If a `since` argument was provided, set `sinceFilter` to that epoch. Otherwise set to 0.

```bash
ssh root@104.248.223.48 bash <<'REMOTE_SCRIPT'
cd /var/www/kardashev
MONGODB_URI=$(grep '^MONGO_CONNECTION_STRING=' .env.local | cut -d= -f2-)
mongosh "$MONGODB_URI" --quiet --eval '
const kdb = db.getSiblingDB("kardashev");
// SINCE_FILTER: if a since argument was given, set to that epoch
// e.g., const sinceFilter = new Date("2026-04-02").getTime();
// Otherwise set to 0 to include all data
const sinceFilter = 0;
const cleanEpoch = new Date("2026-03-21").getTime();

// 1. ACTIVE MODEL METADATA
print("=== 1. ACTIVE CALIBRATION MODEL ===");
const cal = kdb.calibration.findOne({ _id: "active" });
if (cal == null) {
  print("NO ACTIVE MODEL");
} else if (cal.kind === "segmented-v1") {
  print("Kind: segmented-v1");
  print("Version: " + (cal.version || "unknown"));
  print("Trained: " + new Date(cal.trainedAt).toISOString());
  print("Age: " + Math.round((Date.now() - cal.trainedAt) / 86400000) + " days");
  print("Global samples: " + cal.sampleSize);
  const gb = cal.global || {};
  print("Global Brier before: " + (gb.brierBefore != null ? gb.brierBefore.toFixed(3) : "N/A"));
  print("Global Brier after: " + (gb.brierAfter != null ? gb.brierAfter.toFixed(3) : "N/A"));
  if (gb.brierBefore > 0 && gb.brierAfter != null) {
    print("Improvement: " + ((1 - gb.brierAfter / gb.brierBefore) * 100).toFixed(1) + "%");
  }
  print("Breakpoints: " + (gb.breakpoints ? gb.breakpoints.length : 0));
  print("Data epoch: " + (cal.dataEpoch ? new Date(cal.dataEpoch).toISOString().slice(0,10) : "N/A"));

  print("\nType models:");
  const types = cal.byType ? Object.entries(cal.byType) : [];
  if (types.length > 0) {
    for (const [t, m] of types) {
      print("  " + t + ": " + m.sampleSize + " samples, Brier " + (m.brierBefore != null ? m.brierBefore.toFixed(3) : "?") + " -> " + (m.brierAfter != null ? m.brierAfter.toFixed(3) : "?"));
    }
  } else { print("  (none - all fall back to global)"); }

  print("\nSegment models:");
  const segs = cal.bySegment ? Object.entries(cal.bySegment) : [];
  if (segs.length > 0) {
    for (const [s, m] of segs) {
      print("  " + s + ": " + m.sampleSize + " samples, Brier " + (m.brierBefore != null ? m.brierBefore.toFixed(3) : "?") + " -> " + (m.brierAfter != null ? m.brierAfter.toFixed(3) : "?"));
    }
  } else { print("  (none - all fall back to type or global)"); }
} else {
  print("Kind: legacy");
  print("Breakpoints: " + (cal.breakpoints ? cal.breakpoints.length : 0));
}
const allCals = kdb.calibration.find({}).toArray();
print("\nAll calibration docs: " + allCals.map(function(c) { return c._id; }).join(", "));

// 2. CALIBRATION ROUTING DISTRIBUTION
// Two views: historical (full 7d, includes pre-retrain rows) and post-retrain
// (filtered to timestamp >= activeModel.trainedAt, shows CURRENT routing only).
// The historical view preserves context for older performance investigations.
// The post-retrain view avoids the display artifact where rows logged before a
// recent retrain still carry the (at-the-time-correct) old modelId and look
// like current routing splits. See investigation 2026-04-09 for context.
print("\n=== 2a. CALIBRATION ROUTING — HISTORICAL (full 7d) ===");
const week = Date.now() - 7 * 86400000;
const routeDistHist = kdb.market_predictions.aggregate([
  { $match: { timestamp: { $gte: week } } },
  { $group: { _id: { $ifNull: ["$calibrationModelId", "none"] }, count: { $sum: 1 }, trades: { $sum: { $cond: ["$isTrade", 1, 0] } } } },
  { $sort: { count: -1 } }
]).toArray();
print("(Includes rows from before the active model was trained — modelIds reflect the active model at the time of prediction, not current routing.)");
for (const r of routeDistHist) {
  print("  " + r._id + ": " + r.count + " predictions (" + r.trades + " trades)");
}

print("\n=== 2b. CALIBRATION ROUTING — POST-RETRAIN (current routing only) ===");
const retrainMoment = cal && cal.trainedAt ? cal.trainedAt : 0;
if (retrainMoment === 0) {
  print("  (no active model trainedAt — cannot filter; see 2a)");
} else {
  const postRetrainStart = Math.max(week, retrainMoment);
  print("Window: " + new Date(postRetrainStart).toISOString() + " -> now");
  print("Active model trainedAt: " + new Date(retrainMoment).toISOString());
  if (retrainMoment > week) {
    const hiddenPct = (((retrainMoment - week) / (Date.now() - week)) * 100).toFixed(0);
    print("Note: " + hiddenPct + "% of the 7d window is pre-retrain and hidden from this view.");
  }
  const routeDistPost = kdb.market_predictions.aggregate([
    { $match: { timestamp: { $gte: postRetrainStart } } },
    { $group: { _id: { $ifNull: ["$calibrationModelId", "none"] }, count: { $sum: 1 }, trades: { $sum: { $cond: ["$isTrade", 1, 0] } } } },
    { $sort: { count: -1 } }
  ]).toArray();
  if (routeDistPost.length === 0) {
    print("  (no predictions logged since retrain)");
  } else {
    for (const r of routeDistPost) {
      print("  " + r._id + ": " + r.count + " predictions (" + r.trades + " trades)");
    }
  }
  // Flag if any stale model IDs appear in the post-retrain view — these would
  // be real bugs (stale PM2 worker, bootstrap misload, or routing regression).
  const activeVersion = cal.version || "unknown";
  const stale = routeDistPost.filter(function(r) {
    return r._id !== "none" && r._id.indexOf(activeVersion) === -1 && r._id.indexOf("legacy") === -1;
  });
  if (stale.length > 0) {
    print("\n  !! STALE MODEL IDs in post-retrain window — investigate:");
    for (const s of stale) {
      print("     " + s._id + " (" + s.count + " predictions)");
    }
  }
}

// 3. BSS BY CALIBRATION MODEL (resolved trades)
print("\n=== 3. BSS BY CALIBRATION MODEL ===");
var resolvedQuery = {
  resolvedOutcome: { $in: [0, 1] },
  isTrade: true,
  correctedProbability: { $gte: 0, $lte: 1 }
};
if (sinceFilter > 0) resolvedQuery.timestamp = { $gte: sinceFilter };
const allResolved = kdb.market_predictions.find(resolvedQuery).toArray();
if (sinceFilter > 0) print("(filtered: since " + new Date(sinceFilter).toISOString().slice(0,10) + ")");
print("Resolved trades in scope: " + allResolved.length);

const byModelId = {};
for (const p of allResolved) {
  const mid = p.calibrationModelId || "none";
  if (!byModelId[mid]) byModelId[mid] = [];
  byModelId[mid].push(p);
}

print("Model ID                              | Trades | Brier  | Mkt Brier | BSS    | Win%");
for (const [mid, group] of Object.entries(byModelId).sort(function(a,b) { return b[1].length - a[1].length; })) {
  const modelB = group.reduce(function(s, p) { return s + Math.pow(p.correctedProbability - p.resolvedOutcome, 2); }, 0) / group.length;
  const mktB = group.reduce(function(s, p) { return s + Math.pow(p.marketPrice - p.resolvedOutcome, 2); }, 0) / group.length;
  const bss = mktB > 0 ? (1 - modelB / mktB).toFixed(2) : "N/A";
  const wins = group.filter(function(p) {
    return (p.correctedProbability > p.marketPrice && p.resolvedOutcome === 1) ||
           (p.correctedProbability <= p.marketPrice && p.resolvedOutcome === 0);
  }).length;
  print(mid.substring(0,38).padEnd(38) + "| " + String(group.length).padEnd(7) + "| " + modelB.toFixed(3).padEnd(7) + "| " + mktB.toFixed(3).padEnd(10) + "| " + String(bss).padEnd(7) + "| " + (wins/group.length*100).toFixed(0) + "%");
}

// 4. RELIABILITY DIAGRAM (10 bins)
print("\n=== 4. RELIABILITY DIAGRAM ===");
var reliabilitySet = sinceFilter > 0 ? allResolved : allResolved.filter(function(p) { return p.timestamp >= cleanEpoch; });
var reliabilityLabel = sinceFilter > 0 ? "since " + new Date(sinceFilter).toISOString().slice(0,10) : "clean era";
print("Scope: " + reliabilityLabel + " (" + reliabilitySet.length + " trades)");
print("Bin        | Count | Avg Pred  | Avg Actual | Gap    | Direction");
for (var i = 0; i < 10; i++) {
  var lo = i * 0.1;
  var hi = (i + 1) * 0.1;
  var group = reliabilitySet.filter(function(p) {
    return p.correctedProbability >= lo && p.correctedProbability < (i === 9 ? 1.01 : hi);
  });
  var label = lo.toFixed(1) + "-" + hi.toFixed(1);
  if (group.length === 0) { print(label.padEnd(10) + " | 0"); continue; }
  var avgPred = group.reduce(function(s,p) { return s + p.correctedProbability; }, 0) / group.length;
  var avgActual = group.reduce(function(s,p) { return s + p.resolvedOutcome; }, 0) / group.length;
  var gap = Math.abs(avgPred - avgActual);
  var dir = avgPred > avgActual ? "overconf" : "underconf";
  print(label.padEnd(10) + " | " + String(group.length).padEnd(5) + " | " + avgPred.toFixed(3).padEnd(9) + " | " + avgActual.toFixed(3).padEnd(10) + " | " + gap.toFixed(3).padEnd(6) + " | " + dir + (gap > 0.15 ? " !!" : ""));
}

// 5. RAW vs CALIBRATED COMPARISON
print("\n=== 5. RAW vs CALIBRATED ===");
var compSet = sinceFilter > 0 ? allResolved : allResolved.filter(function(p) { return p.timestamp >= cleanEpoch; });
var withRaw = compSet.filter(function(p) { return p.rawProbability != null && p.rawProbability >= 0 && p.rawProbability <= 1; });
if (withRaw.length > 0) {
  var rawBrier = withRaw.reduce(function(s,p) { return s + Math.pow(p.rawProbability - p.resolvedOutcome, 2); }, 0) / withRaw.length;
  var calBrier = withRaw.reduce(function(s,p) { return s + Math.pow(p.correctedProbability - p.resolvedOutcome, 2); }, 0) / withRaw.length;
  var mktBrier2 = withRaw.reduce(function(s,p) { return s + Math.pow(p.marketPrice - p.resolvedOutcome, 2); }, 0) / withRaw.length;
  print("Predictions with both raw+corrected: " + withRaw.length);
  print("Raw Brier:        " + rawBrier.toFixed(3));
  print("Calibrated Brier: " + calBrier.toFixed(3));
  print("Market Brier:     " + mktBrier2.toFixed(3));
  var lift = rawBrier > 0 ? ((1 - calBrier/rawBrier) * 100).toFixed(1) : "N/A";
  print("Calibration lift: " + lift + "% (" + (calBrier < rawBrier ? "IMPROVED" : calBrier === rawBrier ? "UNCHANGED" : "WORSENED") + ")");
  print("Raw BSS vs market: " + (mktBrier2 > 0 ? (1 - rawBrier/mktBrier2).toFixed(3) : "N/A"));
  print("Cal BSS vs market: " + (mktBrier2 > 0 ? (1 - calBrier/mktBrier2).toFixed(3) : "N/A"));
} else {
  print("No predictions with rawProbability available");
}

// 6. TRAINING DATA READINESS
print("\n=== 6. TRAINING DATA READINESS ===");
var trainCutoff = Date.now() - 180 * 86400000;
var trainEpoch = Math.max(trainCutoff, cleanEpoch);
var trainableCount = kdb.market_predictions.countDocuments({
  resolvedOutcome: { $in: [0, 1] },
  rawProbability: { $gte: 0, $lte: 1 },
  timestamp: { $gte: trainEpoch },
  probabilityModel: "bma",
  marketId: { $not: /-T\d/ }
});
print("Eligible training rows (inner, BMA, clean era): " + trainableCount);
print("Minimum for global: 50 (" + (trainableCount >= 50 ? "READY" : "NOT READY") + ")");

var segReady = kdb.market_predictions.aggregate([
  { $match: {
    resolvedOutcome: { $in: [0, 1] },
    rawProbability: { $gte: 0, $lte: 1 },
    marketType: { $exists: true },
    hoursToResolution: { $exists: true },
    timestamp: { $gte: trainEpoch },
    probabilityModel: "bma",
    marketId: { $not: /-T\d/ }
  }},
  { $addFields: {
    leadBucket: {
      $switch: {
        branches: [
          { case: { $lt: ["$hoursToResolution", 12] }, then: "lt12h" },
          { case: { $lt: ["$hoursToResolution", 24] }, then: "12to24h" },
          { case: { $lt: ["$hoursToResolution", 48] }, then: "24to48h" },
          { case: { $lt: ["$hoursToResolution", 72] }, then: "48to72h" }
        ],
        default: "gt72h"
      }
    }
  }},
  { $group: { _id: { type: "$marketType", lead: "$leadBucket" }, count: { $sum: 1 } } },
  { $sort: { "_id.type": 1, "_id.lead": 1 } }
]).toArray();

print("\nSegment coverage (need 200 each):");
print("Segment                           | Count | Status");
for (const s of segReady) {
  var lbl = (s._id.type + ":" + s._id.lead).padEnd(34);
  var status = s.count >= 200 ? "READY" : s.count + "/200";
  print(lbl + "| " + String(s.count).padEnd(5) + " | " + status);
}

var typeReady = kdb.market_predictions.aggregate([
  { $match: {
    resolvedOutcome: { $in: [0, 1] },
    rawProbability: { $gte: 0, $lte: 1 },
    marketType: { $exists: true },
    timestamp: { $gte: trainEpoch },
    probabilityModel: "bma",
    marketId: { $not: /-T\d/ }
  }},
  { $group: { _id: "$marketType", count: { $sum: 1 } } },
  { $sort: { _id: 1 } }
]).toArray();
print("\nType coverage (need 200 each):");
for (const t of typeReady) {
  print("  " + t._id + ": " + t.count + (t.count >= 200 ? " (READY)" : " (" + t.count + "/200)"));
}

// 7. PENDING RESOLUTION
print("\n=== 7. PENDING RESOLUTION ===");
var pendingTrades = kdb.market_predictions.countDocuments({ resolvedOutcome: { $exists: false }, isTrade: true });
var pendingCal = kdb.market_predictions.countDocuments({ resolvedOutcome: { $exists: false }, isTrade: true, calibrationModelId: { $exists: true, $ne: null } });
print("Unresolved trades: " + pendingTrades);
print("Unresolved w/ calibration: " + pendingCal);
var latestUnresolved = kdb.market_predictions.find({ resolvedOutcome: { $exists: false }, isTrade: true }).sort({ timestamp: -1 }).limit(3).toArray();
if (latestUnresolved.length > 0) {
  print("Latest unresolved:");
  for (const u of latestUnresolved) {
    print("  " + new Date(u.timestamp).toISOString().slice(0,16) + " " + (u.calibrationModelId || "none") + " " + (u.cityCode || "") + " " + (u.marketType || ""));
  }
}

// 8. RETRAIN RECOMMENDATION
print("\n=== 8. RETRAIN RECOMMENDATION ===");
var modelAge = cal != null ? Math.round((Date.now() - cal.trainedAt) / 86400000) : 999;
var newRowsSinceTraining = cal != null ? kdb.market_predictions.countDocuments({
  resolvedOutcome: { $in: [0, 1] },
  rawProbability: { $gte: 0, $lte: 1 },
  timestamp: { $gte: cal.trainedAt },
  probabilityModel: "bma",
  marketId: { $not: /-T\d/ }
}) : 0;
print("Model age: " + modelAge + " days");
print("New resolved rows since training: " + newRowsSinceTraining);
print("Total eligible rows: " + trainableCount);
var growthPct = cal != null && cal.sampleSize > 0 ? ((trainableCount / cal.sampleSize - 1) * 100).toFixed(0) : "N/A";
print("Growth since last train: " + growthPct + "%");

if (cal == null) {
  print(">> TRAIN NOW - no active model");
} else if (modelAge > 14 && newRowsSinceTraining > 100) {
  print(">> RETRAIN - model is " + modelAge + "d old with " + newRowsSinceTraining + " new rows");
} else if (modelAge > 7 && newRowsSinceTraining > 200) {
  print(">> CONSIDER RETRAIN - significant new data (" + newRowsSinceTraining + " rows)");
} else if (trainableCount > cal.sampleSize * 1.3) {
  print(">> CONSIDER RETRAIN - 30%+ growth in eligible data (" + growthPct + "%)");
} else {
  print(">> HOLD - model is fresh (" + modelAge + "d), " + newRowsSinceTraining + " new rows");
}
'
REMOTE_SCRIPT
```

2. Parse the output and format into a report with the following sections.

## Report Format

### 1. Active Model
- Version, training date, age in days
- Global in-sample Brier improvement (before -> after, % improvement)
- Which type/segment models exist vs fall back to global
- Flag if model is >14 days old or no model exists

### 2. Routing Distribution
Two views emitted — interpret them independently:

- **2a. Historical (full 7d):** all `calibrationModelId` values on predictions logged in the past 7 days. Rows logged before the active model was trained will still carry the (at-the-time-correct) earlier modelId. Use this view only for historical performance investigations. Do NOT use it to assess current routing health — a recent retrain inside the 7d window will make it look like traffic is splitting across models when it isn't.
- **2b. Post-retrain (current routing):** same aggregation filtered to `timestamp >= activeModel.trainedAt`. This is the view that answers "is calibration routing currently healthy?". Any modelId in this view that doesn't match the active version is a real anomaly — the skill flags these with `!! STALE MODEL IDs` for investigation (stale PM2 worker, bootstrap misload, routing regression).

Flags to raise:
- If 2b contains stale modelIds → investigate (PM2 worker state, bootstrap load path, retrain POST handler)
- If 2b shows `none` as the dominant route → calibration isn't being applied (instrumentation failure or threshold-bracket-only period)
- If 2b is empty → no predictions logged since the retrain; may indicate traffic/pipeline issue or a very recent retrain

### 3. BSS by Model
- Per-model Brier, Market Brier, BSS, win rate
- Highlight which model is performing best (highest BSS)
- Flag any model with BSS < -1.0 (significantly worse than market)
- Note sample size — models with <20 trades are statistically unreliable

### 4. Reliability Diagram
- 10-bin predicted vs actual breakdown
- Flag bins with gap > 0.15 as poorly calibrated (!!)
- Note overconfidence (predicted > actual) vs underconfidence patterns
- Dominant pattern indicates the calibration direction to improve

### 5. Raw vs Calibrated
- Direct comparison: raw BMA probabilities vs post-calibration vs market
- Calibration lift (% Brier improvement from raw to calibrated)
- Flag if calibration WORSENS Brier (lift < 0%)
- Note: lift may be near-zero if most trades had no calibration applied ("none" model)

### 6. Training Readiness
- Total eligible rows for retraining (inner brackets, BMA, clean era)
- Segment coverage matrix: which type:lead combinations have 200+ samples
- Highlight newly eligible segments (approaching 200 threshold)

### 7. Pending Resolution
- Unresolved trade count (how much data is incoming)
- How many unresolved trades have calibration applied
- Context: high pending count means BSS metrics will shift as trades resolve

### 8. Retrain Recommendation
- Model age vs new data since training
- Growth percentage (current eligible rows vs training sample size)
- Clear recommendation: TRAIN NOW / RETRAIN / CONSIDER RETRAIN / HOLD

## Interpretation Guide

- **BSS (Brier Skill Score):** `1 - (model_brier / market_brier)`. Positive = model beats market. Negative = market wins. Zero = break-even. Our target is BSS > 0 in the 20-40c price range.
- **Reliability gap:** |predicted - actual| per bin. <0.05 = well-calibrated, 0.05-0.15 = acceptable, >0.15 = poorly calibrated.
- **Underconfidence:** Model predicts lower probability than actual frequency. Common for NO-side bets where correctedProbability represents YES probability.
- **Overconfidence:** Model predicts higher probability than actual frequency.
- **"none" calibration route:** Means calibration was disabled or model wasn't loaded. These trades use raw BMA probabilities.
- **Calibration lift near 0%:** Expected when calibration was disabled for most of the period. Will diverge as more calibrated trades resolve.

## Reference Values

| Metric | Current Baseline | Notes |
|--------|-----------------|-------|
| Active model | `cal_1775184454578` | Trained 2026-04-02, 854 samples |
| Previous model | `cal_1774664539928` | Backed up, trainable via rollback |
| Clean era epoch | 2026-03-21 | Post-normalization-fix |
| In-sample improvement | 25.0% | Brier 0.290 -> 0.218 |
| Global min samples | 50 | Type/segment min: 200 |
| Training filter | Inner brackets only | Excludes `-T\d` threshold brackets |
| Training filter | BMA only | `probabilityModel: "bma"` |

## Notes

- MongoDB is **Atlas** (cloud), not local. Never use `mongosh` without the connection string.
- Uses `bash <<'REMOTE_SCRIPT'` heredoc to avoid zsh `!` escaping issues in double-quoted SSH strings.
- `correctedProbability` = post-calibration probability. `rawProbability` = pre-calibration BMA output.
- `calibrationModelId` format: `{version}:{route}` e.g., `cal_1775184454578:global`, `cal_...:segment:temperature-high:24to48h`.
- Threshold brackets (`-T\d` suffix) bypass calibration to prevent extrapolation inflation — excluded from training data.
- Calibration routing: segment > type > global > none. Currently only global is populated (no type/segment models meet 200-sample threshold).
- Droplet IP: `104.248.223.48`
