# Migration Checklist: DO + Cloudflare + Redis

## Phase 1: Infrastructure (manual DevOps on droplet)

- [x] **1.1** Resize droplet to 2 vCPU / 4GB (~$24/mo)
- [x] **1.2** Install system packages: `nginx`, `redis-server`, `pm2`
- [x] **1.3** Clone repo, copy `.env.local`, `npm install && npm run build`
- [x] **1.4** Create `ecosystem.config.js` (PM2 config, single instance)
- [x] **1.5** Start PM2: `pm2 start && pm2 save && pm2 startup`
- [x] **1.6** Configure nginx reverse proxy (large headers, buffers, timeouts, rate limit, security headers)
- [x] **1.7** Setup Cloudflare (add `kardashev.network` to free tier)
- [x] **1.8** Update Route 53 registrar-level NS to Cloudflare nameservers
- [x] **1.9** Configure Cloudflare DNS: `A kardashev.network -> 104.248.223.48` (proxied)
- [x] **1.10** Configure SSL: Cloudflare Full (strict) + Origin Certificate installed in nginx (`/etc/ssl/cloudflare/`)
- [x] **1.11** Configure firewall: `ufw` deny all, allow SSH, HTTP/HTTPS from Cloudflare IPs only
- [ ] **1.12** Verify Phase 1:
  - [x] `curl https://kardashev.network/api/weather/forecasts?city=NY` returns data (200, 353ms)
  - [x] `curl https://kardashev.network/api/solar/irradiance?lat=40.78&lng=-73.97` returns free-tier data (200, 3.3s)
  - [ ] Payment flow works end-to-end (x402 headers pass through nginx)
  - [x] `pm2 logs kardashev-web` shows no errors
  - [ ] Keep Vercel active for 48hr rollback window

## Phase 2: Redis Cache Layer (code changes)

### Setup
- [x] **2.1** Install `ioredis` dependency
- [x] **2.2** Add `REDIS_URL=redis://127.0.0.1:6379` to `.env.local` on droplet (NOT local dev)
- [x] **2.3** Configure Redis: `bind 127.0.0.1`, `maxmemory 512mb`, `maxmemory-policy allkeys-lru`

### New Files
- [x] **2.4** Create `src/lib/cache/redis.ts` (unified Redis client with in-memory fallback)

### Cache Migrations (L1 Map + L2 Redis)
- [x] **2.5** `src/lib/api/openMeteo.ts` — solar (300s) + weather (300s) caches
- [x] **2.6** `src/lib/api/googleWeather.ts` — gweather (900s) cache
- [x] **2.7** `src/lib/api/metar.ts` — metar (1800s) cache
- [x] **2.8** `src/lib/api/nws.ts` — nws (1800s) cache
- [x] **2.9** `src/pages/api/weather/forecasts.ts` — forecasts (900s) cache
- [x] **2.10** `src/pages/api/solar/building-insights.ts` — building (86400s) cache
- [x] **2.11** `src/pages/api/solar/data-layers.ts` — datalayers (86400s) cache
- [x] **2.12** `src/pages/api/kalshi/markets.ts` — kalshi (300s) cache
- [x] **2.13** `src/pages/api/weather/backtest.ts` — backtest (600s) cache

### Critical State Migrations
- [x] **2.14** Payment sessions in `irradiance.ts` (write-through to Redis, TTL 1800s)
- [x] **2.15** Facilitator feePayer in `irradiance.ts` (cache in Redis, TTL 86400s)
- [x] **2.16** Geocode rate limiter in `geocode/search.ts` (Redis INCR + EXPIRE)

### Verify Phase 2
- [x] **2.17** `npx tsc --noEmit` passes
- [x] **2.18** `npm run lint` passes
- [x] **2.19** Local dev works without `REDIS_URL` set (graceful fallback)
- [x] **2.20** On droplet: `redis-cli KEYS 'kn:*'` shows populated keys
- [ ] **2.21** Pay via x402 -> PM2 restart -> session still valid
- [ ] **2.22** Two rapid geocode requests from same IP -> second returns 429
- [x] **2.23** `redis-cli INFO memory` — reasonable usage (1.9MB)

### Enable Cluster Mode
- [ ] **2.24** Update `ecosystem.config.js`: `instances: 2`, `exec_mode: 'cluster'`
- [ ] **2.25** `pm2 reload kardashev-web` — zero-downtime switch

## Phase 3: Backend Services (code changes)

### Startup Hooks
- [x] **3.1** Edit `next.config.js` — add `experimental.instrumentationHook: true`
- [x] **3.2** Create `src/instrumentation.ts` + `src/instrumentation.node.ts` (runtime split to avoid edge bundling)
- [x] **3.3** Create `src/lib/cache/warmup.ts` (pre-warm caches for tracked cities)

### Market Resolution Cron
- [x] **3.4** Create `ecosystem.config.js` with web app + cron entries

### Verify Phase 3
- [x] **3.5** `npx tsc --noEmit` passes
- [x] **3.6** `npm run lint` passes
- [x] **3.7** On restart: `pm2 logs` shows warmup progress (16 cities warmed, 0 errors)
- [x] **3.8** `redis-cli KEYS 'kn:*'` populated immediately after restart
- [ ] **3.9** Manual cron test: `npx tsx scripts/resolve-markets.ts` completes

## Phase 4: Decommission Vercel

- [ ] **4.1** Monitor DO for 72 hours post DNS cutover
- [ ] **4.2** Verify error rates: `grep " 5[0-9][0-9] " /var/log/nginx/access.log | wc -l`
- [ ] **4.3** Test both EVM and Solana payment flows end-to-end
- [ ] **4.4** Remove/rotate API keys from Vercel dashboard
- [ ] **4.5** Keep Vercel project paused (not deleted) for 30 days

## Additional Completed Items

- [x] GitHub Actions auto-deploy workflow (`.github/workflows/deploy.yml`)
- [x] `CLAUDE.md` updated with infrastructure documentation
- [x] Fixed weather cache double-prefix bug (`kn:weather:weather:` → `kn:weather:`)
