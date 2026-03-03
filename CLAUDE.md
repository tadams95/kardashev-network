# Kardashev Network

## Project Overview
Next.js app with x402 micropayments for premium solar irradiance data. Supports dual-chain payments: EVM (Base Sepolia) and Solana (Devnet).

## Tech Stack
- Next.js (Pages Router), React, TypeScript
- x402 / x402-fetch for payment protocol
- wagmi/viem for EVM wallet integration
- @solana/wallet-adapter-react + @solana/web3.js for Solana wallet integration
- SWR for data fetching
- Tailwind CSS

## Key Architecture

### x402 Payment Flow
1. Client requests premium data -> server returns 402 with `accepts[]` (both EVM and Solana requirements)
2. x402-fetch intercepts the 402, selects a payment requirement, has the wallet sign it, retries with `X-PAYMENT` header
3. Server verifies+settles via x402.org facilitator, creates session, returns premium data

### Critical: Chain-Type Matching
**x402-fetch does NOT automatically match the signer type to payment requirements.** When the server's 402 response contains both EVM and Solana requirements, x402-fetch may select the wrong one (e.g., EVM requirement for a Solana signer), causing "Invalid evm wallet client provided".

**Solution:** In `usePremiumSolarData.ts`, the `fetch` function passed to `wrapFetchWithPayment` is wrapped to filter the 402 response body, removing requirements that don't match `activeChainType` BEFORE x402-fetch processes them. Do NOT use a custom `paymentRequirementsSelector` for this — it runs too late and fallback logic can silently pick cross-chain requirements.

### Key Files
- `src/hooks/usePremiumSolarData.ts` — payment orchestration, chain-filtered fetch wrapper
- `src/hooks/useMultiChainX402.ts` — dual-chain state management (activeChainType, activeSigner)
- `src/hooks/useX402Solana.ts` — bridges @solana/wallet-adapter-react to x402's TransactionPartialSigner
- `src/hooks/useX402.ts` — EVM wallet setup
- `src/components/PaymentGate.tsx` — payment UI with chain selector
- `src/pages/api/solar/irradiance.ts` — API route with 402 payment verification

### Environment Variables (Payment)
- `X402_RECEIVER_ADDRESS` — EVM wallet to receive payments (required)
- `X402_SOLANA_RECEIVER_ADDRESS` — Solana wallet to receive payments (required for Solana payments)
- `NEXT_PUBLIC_X402_NETWORK` — EVM network (default: base-sepolia)
- `NEXT_PUBLIC_SOLANA_NETWORK` — Solana network (default: solana-devnet)
- `NEXT_PUBLIC_SOLANA_RPC_URL` — Solana RPC endpoint
- `X402_SESSION_SECRET` — HMAC secret for signed session tokens (required in production)

## Infrastructure

### Production: DigitalOcean Droplet
- **IP:** stored in `.env.local` as `DO_DROPLET_IP`
- **SSH access:** key-only (`ssh root@<droplet-ip>` using `~/.ssh/id_rsa`). Password auth is disabled.
- **App path:** `/var/www/kardashev`
- **Process manager:** PM2 (`ecosystem.config.js`) — web app on port 3000 + market resolution cron (every 4hr)
- **Reverse proxy:** nginx at `/etc/nginx/sites-available/kardashev` → `localhost:3000`
- **Redis:** on-droplet, `127.0.0.1:6379`, maxmemory 512MB, allkeys-lru eviction
- **Firewall:** ufw — SSH rate-limited (LIMIT), HTTP/HTTPS from Cloudflare IPs only
- **SSH hardening:** fail2ban (bans after 3 failures for 1hr), password auth disabled, MaxStartups 50:30:100
- **DNS/CDN:** Cloudflare (proxied) → droplet. SSL mode: Full (strict) with Origin Certificate.

### Deploy to Droplet
```bash
ssh root@<droplet-ip>  # key-based auth only (uses ~/.ssh/id_rsa)
cd /var/www/kardashev
git pull origin main
npm install && npm run build
pm2 reload kardashev-web  # zero-downtime reload
```

### Cache Architecture (L1 Map + L2 Redis)
Every API cache uses the same two-tier pattern:
- **L1:** in-memory `Map` (per-process, fast, lost on restart)
- **L2:** Redis with `kn:` key prefix (shared across PM2 cluster workers, survives restarts)
- Read path: L1 hit → return | L1 miss → check Redis → backfill L1 → return
- Write path: write to both L1 and Redis simultaneously
- **Graceful fallback:** when `REDIS_URL` is not set (local dev), Redis operations are no-ops. All caches work as plain in-memory Maps.

Key files:
- `src/lib/cache/redis.ts` — unified Redis client (`rget`, `rset`, `rdel`, `rincr`)
- `src/lib/x402/session.ts` — signed x402 session tokens + replay protection helpers
- `src/lib/cache/warmup.ts` — pre-warms caches for tracked cities on startup
- `src/instrumentation.ts` — Next.js startup hook (loads calibration model from MongoDB, triggers warmup)

### Redis Key Schema
```
kn:solar:{lat},{lng}           TTL 300s    Open-Meteo solar
kn:weather:{lat},{lng}         TTL 300s    Open-Meteo weather
kn:gweather:{lat},{lng}        TTL 900s    Google Weather
kn:metar:{ICAO}                TTL 1800s   METAR
kn:nws:{lat},{lng}             TTL 1800s   NWS
kn:accuweather:{lat},{lng}     TTL 1800s   AccuWeather daily forecast
kn:tomorrow:{lat},{lng}        TTL 1800s   Tomorrow.io daily forecast
kn:forecasts:{cityCode}        TTL 900s    Weather ensemble
kn:building:{lat},{lng}        TTL 86400s  Building insights
kn:datalayers:{lat},{lng}      TTL 86400s  Data layers
kn:kalshi:{queryKey}           TTL 300s    Kalshi markets
kn:session:id:{sessionId}      TTL 1800s   Payment session record
kn:session:wallet:{address}    TTL 1800s   Wallet → session mapping
kn:replay:lock:{paymentHash}   TTL 300s    In-flight replay lock
kn:replay:used:{network}:{tx}  TTL 604800s Consumed payment replay guard
kn:feepayer                    TTL 86400s  Facilitator Solana feePayer
kn:ratelimit:{ip}              TTL 2s      Geocode rate limit
kn:warmup:done                 TTL 300s    Warmup dedup flag
kn:weights:{cityCode}          TTL 900s    Dynamic ensemble weights per city
```

### Weather Trading Mongo Conventions
- `signals` collection stores trade signal lineage and should maintain indexes:
	- `{ timestamp: -1 }`
	- `{ marketId: 1, outcome: 1 }`
	- `{ id: 1 }` unique
	- `{ marketId: 1, timestamp: -1 }`
	- `{ cityCode: 1, timestamp: -1 }`
- `temp_bias` collection stores append-only forecast vs actual observations and should maintain indexes:
	- `{ cityCode: 1, timestamp: -1 }`
	- `{ cityCode: 1, leadHours: 1, timestamp: -1 }`
	- `{ marketId: 1, signalId: 1 }`
	- `{ policyVersion: 1, timestamp: -1 }`
- `market_predictions` collection stores prediction logs with mandatory retention via TTL:
	- TTL index: `{ expiresAt: 1 }` with `expireAfterSeconds: 0`
	- Non-trade retention: 45 days
	- Trade retention: 400 days
- Retention is enforced by setting `expiresAt` per document (different windows for trade vs non-trade rows).
- `source_accuracy` collection stores per-source forecast accuracy observations:
	- `{ source: 1, cityCode: 1, timestamp: -1 }`
	- `{ cityCode: 1, timestamp: -1 }`
	- `{ marketId: 1, signalId: 1 }`
	- `{ policyVersion: 1, timestamp: -1 }`

### Droplet Debugging
```bash
pm2 logs kardashev-web --lines 50     # app logs
pm2 monit                              # live CPU/mem
redis-cli KEYS 'kn:*'                  # inspect cache keys
redis-cli INFO memory                  # Redis memory usage
redis-cli GET kn:session:wallet:<address>  # check wallet session mapping
tail -f /var/log/nginx/access.log      # nginx traffic
grep ' 5[0-9][0-9] ' /var/log/nginx/access.log | wc -l  # error count
fail2ban-client status sshd            # SSH ban status
```

## Commands
- `npm run dev` — start dev server
- `npx tsc --noEmit` — type-check without emitting
- `npm run build` — production build
- `npm run lint` — ESLint
- `npm run resolve-markets` — manually run market resolution script

### Local Env Tip
- Avoid `source .env.local` in shell when multiline secrets are present (e.g., PEM keys). Prefer app-native env loading (`next build`, `next dev`) or a dotenv-aware command runner.
