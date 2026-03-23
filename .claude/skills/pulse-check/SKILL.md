# Production Pulse Check

Quick health check of the production server after deploy or on demand.

## Steps

1. SSH into the droplet and run all checks in parallel:

```bash
# PM2 process status
ssh root@104.248.223.48 "pm2 jlist" 2>/dev/null

# Hit the opportunities endpoint for 2-3 cities
ssh root@104.248.223.48 "curl -s 'http://localhost:3000/api/weather/opportunities?city=NY' && echo '---' && curl -s 'http://localhost:3000/api/weather/opportunities?city=CHI' && echo '---' && curl -s 'http://localhost:3000/api/weather/opportunities?city=AUS'"

# Recent error logs (last 30 lines)
ssh root@104.248.223.48 "pm2 logs kardashev-web --lines 30 --nostream 2>&1"

# Redis health
ssh root@104.248.223.48 "redis-cli INFO memory 2>/dev/null | grep -E 'used_memory_human|maxmemory_human|evicted_keys'"

# Check warmup status
ssh root@104.248.223.48 "redis-cli GET kn:warmup:done"
```

2. Parse the opportunities responses and report:
   - Per city: success/fail, opportunity count, total markets, cached status
   - If any city returns `success: false`, flag it prominently

3. Parse PM2 status and report:
   - Process status (online/stopped/errored)
   - Uptime, restarts, memory usage
   - Flag if restart count > 0 since last deploy

4. Scan error logs for:
   - `[opportunities]` errors (new endpoint issues)
   - Cross-city mismatch warnings
   - Rate limit / circuit breaker trips
   - Any 5xx errors

5. Report Redis health:
   - Memory usage vs max
   - Evicted keys count (should be 0 or very low)
   - Warmup flag present (indicates successful startup)

6. Summarize as a single status table:

```
| Check              | Status | Details                          |
|--------------------|--------|----------------------------------|
| PM2                | ✓/✗    | online, 45m uptime, 0 restarts   |
| NY opportunities   | ✓/✗    | 14 markets, 2 opps, cached       |
| CHI opportunities  | ✓/✗    | 12 markets, 3 opps               |
| AUS opportunities  | ✓/✗    | 12 markets, 1 opp                |
| Redis              | ✓/✗    | 28MB/512MB, 0 evictions          |
| Warmup             | ✓/✗    | complete                         |
| Recent errors      | ✓/✗    | 2 rate-limit trips (benign)      |
```

## Notes

- Droplet IP: `104.248.223.48`
- This is read-only — no mutations, no restarts
- The 0-markets issue during warmup is transient (Kalshi rate limits) and self-heals
- Cross-city mismatch warnings for SF→SFO and PHI→PHIL are known alias issues
- Open-Meteo Solar circuit-breaker trips are benign (solar data, not weather)
