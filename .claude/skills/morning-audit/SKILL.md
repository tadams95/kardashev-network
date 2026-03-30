# Morning-After Audit

Comprehensive daily check of system health, signal pipeline, and trading performance. Run after a full trading day has passed.

## Prerequisites

- MongoDB connection string is in `.env.local` on droplet as `MONGO_CONNECTION_STRING` (Atlas, not local)
- Use the Atlas URI for `mongosh`: `mongosh "mongodb+srv://..." --quiet`
- Batch SSH commands to avoid fail2ban rate limiting (max 3 parallel SSH sessions)

## Steps

Run these three SSH commands in parallel:

### Command 1: MongoDB queries

```bash
ssh root@104.248.223.48 'cd /var/www/kardashev && mongosh "$(grep MONGO_CONNECTION_STRING .env.local | cut -d= -f2-)" --quiet --eval "
db = db.getSiblingDB(\"kardashev\");
// 1. TAIL SELL SIGNALS
print(\"=== 1. TAIL SELL SIGNALS ===\");
print(\"Total: \" + db.tail_sell_signals.countDocuments({}));
print(\"Pending: \" + db.tail_sell_signals.countDocuments({ result: \"pending\" }));
print(\"Win: \" + db.tail_sell_signals.countDocuments({ result: \"win\" }));
print(\"Loss: \" + db.tail_sell_signals.countDocuments({ result: \"loss\" }));
print(\"\nRecent signals:\");
db.tail_sell_signals.find({}, { _id:0, cityCode:1, bracket:1, forecastF:1, marketPrice:1, direction:1, result:1, pnlCents:1, timestamp:1, resolvedAt:1 }).sort({ timestamp: -1 }).limit(10).forEach(r => print(JSON.stringify(r)));

// 2. FORECAST ACCURACY (last 24h)
print(\"\n=== 2. FORECAST ACCURACY (24h) ===\");
var cutoff = Date.now() - 86400000;
print(\"temp_bias docs: \" + db.temp_bias.countDocuments({ timestamp: { \\\$gte: cutoff } }));
printjson(db.temp_bias.aggregate([
  { \\\$match: { timestamp: { \\\$gte: cutoff }, marketType: \"high\" } },
  { \\\$group: { _id: null, count: { \\\$sum: 1 }, mae: { \\\$avg: { \\\$abs: \"\\\$error\" } }, bias: { \\\$avg: \"\\\$error\" } } }
]).toArray());

// 3. SIGNAL PIPELINE
print(\"\n=== 3. RECENT PREDICTIONS ===\");
db.market_predictions.find({}, { _id:0, cityCode:1, marketType:1, rawProbability:1, correctedProbability:1, calibrationModelId:1, timestamp:1 }).sort({ timestamp: -1 }).limit(5).forEach(p => print(JSON.stringify(p)));

// 4. RESOLUTION STATUS
print(\"\n=== 4. RESOLUTION STATUS ===\");
print(\"Total signals: \" + db.signals.countDocuments({}));
print(\"Resolved (outcome exists): \" + db.signals.countDocuments({ outcome: { \\\$exists: true } }));
print(\"Unresolved: \" + db.signals.countDocuments({ outcome: { \\\$exists: false } }));
var latest = db.signals.find({ outcome: { \\\$exists: true } }).sort({ resolvedAt: -1 }).limit(1).toArray();
if (latest.length) print(\"Last resolved: \" + new Date(latest[0].resolvedAt).toISOString() + \" \" + latest[0].marketId);
"'
```

### Command 2: Tail sell audit script

```bash
ssh root@104.248.223.48 'cd /var/www/kardashev && npx tsx --tsconfig tsconfig.json scripts/audit-tail-sells.ts 2>&1'
```

### Command 3: System health

```bash
ssh root@104.248.223.48 'echo "=== PM2 ===" && pm2 jlist 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); [print(f\"{p[\"name\"]}: {p[\"pm2_env\"][\"status\"]}, pid={p[\"pid\"]}, restarts={p[\"pm2_env\"][\"restart_time\"]}\") for p in d]" && echo "=== ERRORS (non-ratelimit) ===" && pm2 logs kardashev-web --lines 100 --nostream 2>&1 | grep -iE "error|FATAL|unhandled" | grep -v "Tomorrow.io" | grep -v "rate limit" | tail -10 && echo "=== RESOLVE-MARKETS LAST RUN ===" && grep "Signals resolved:" /var/log/resolve-markets.log | tail -4 && echo "=== REDIS ===" && redis-cli PING && redis-cli INFO memory 2>/dev/null | grep -E "used_memory_human|maxmemory_human|evicted_keys"'
```

## Report Format

Output five labeled sections:

### 1. Tail Sell Signals
- Total / pending / win / loss counts
- New signals since last audit
- If resolved: win rate, PnL summary
- NE corridor correlation flag (BOS/NY/DC/PHIL signals on same day)

### 2. Forecast Accuracy
- Compare 24h MAE and bias against clean-era baseline (1.88°F MAE, -1.37°F bias)
- Flag if MAE > 3°F or bias shifts significantly

### 3. Signal Pipeline
- Confirm predictions generating (rawProbability in uncalibrated range)
- Confirm calibrationModelId present and consistent
- Flag if no new predictions in last 6h

### 4. Resolution Status
- Total resolved vs unresolved
- Last resolution timestamp — flag if >36h stale
- Flag if resolve-markets cron is stopped AND crontab isn't running

### 5. System Health
- PM2 status and restarts
- Error log scan (ignore Tomorrow.io rate limits — benign)
- Redis connected, memory usage
- Flag any unexpected errors

## Reference Values

| Metric | Clean-Era Baseline | Alert Threshold |
|--------|-------------------|-----------------|
| MAE (high) | 1.88°F | > 3.0°F |
| Bias (high) | -1.37°F | abs > 3.0°F |
| Calibration model | `cal_1774664539928` | Missing or changed |
| Resolution staleness | — | > 36h since last |

## Notes

- MongoDB is **Atlas** (cloud), not local. Never use `mongosh` without the connection string.
- `outcome` field (boolean) = resolution status in signals collection. NOT `resolvedOutcome`.
- resolve-markets PM2 showing "stopped" is normal (one-shot script, `autorestart: false`). System crontab is the primary trigger.
- Kalshi markets settle 05:00–07:00 UTC. First resolution typically at 10:00 UTC crontab run.
- Droplet IP: `104.248.223.48`
