# Kardashev Network

**Making the invisible visible** — Real-time solar irradiance data, roof analysis, and weather-driven trading signals, monetized with x402 micropayments.

![Next.js](https://img.shields.io/badge/Next.js-14-black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)
![Base](https://img.shields.io/badge/Base-Onchain-0052FF)
![Solana](https://img.shields.io/badge/Solana-Devnet-9945FF)
![License](https://img.shields.io/badge/license-MIT-blue.svg)

---

## What It Does

Every second, millions of dollars worth of solar energy hits rooftops, parking lots, and open land — and most of it goes uncaptured. Kardashev Network visualizes this invisible opportunity across three dashboards:

1. **Solar Dashboard** — Real-time irradiance, hourly forecasts, Google Solar roof analysis, and uncaptured dollar value at any location. Premium tier adds 7-day forecasts, thermal efficiency, and diffuse/direct radiation breakdown.
2. **Weather Forecast** — 6-source ensemble weather (Open-Meteo, Google Weather, NWS, METAR) with isotonic calibration and live Kalshi trading opportunities.
3. **Weather Analytics** — Backtest results from 976 real Kalshi weather markets showing 86.8% model accuracy with calibration plots and prediction distributions.

Premium solar data is gated behind [x402](https://x402.org) micropayments ($0.001 USDC) — no account needed, just a crypto wallet.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 14 (Pages Router), React 18, TypeScript |
| 3D | Three.js, React Three Fiber, Drei |
| Styling | Tailwind CSS |
| Charts | Recharts |
| Data Fetching | SWR, React Query |
| EVM Wallet | RainbowKit, wagmi, viem |
| Solana Wallet | @solana/wallet-adapter-react, @solana/web3.js |
| Payments | x402 / x402-fetch (dual-chain: Base Sepolia + Solana Devnet) |
| Caching | Redis (L2) + in-memory Map (L1) |
| Database | MongoDB (calibration models, performance tracking) |
| Hosting | DigitalOcean droplet, PM2, nginx, Cloudflare |

---

## Getting Started

### Prerequisites

- Node.js 18+
- npm
- Redis (optional — falls back to in-memory cache in dev)
- A wallet with Base Sepolia USDC or Solana Devnet USDC (for testing payments)

### Installation

```bash
git clone https://github.com/tadams95/kardashev-network.git
cd kardashev-network

npm install

cp .env.example .env.local
# Edit .env.local with your configuration

npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Environment Variables

```bash
# x402 Payment
X402_RECEIVER_ADDRESS=0x...                  # EVM wallet for receiving payments
X402_SOLANA_RECEIVER_ADDRESS=...             # Solana wallet for receiving payments
NEXT_PUBLIC_X402_NETWORK=base-sepolia        # EVM network
NEXT_PUBLIC_SOLANA_NETWORK=solana-devnet     # Solana network
NEXT_PUBLIC_SOLANA_RPC_URL=                  # Solana RPC endpoint

# APIs
GOOGLE_MAPS_API_KEY=                         # Google Solar API + Maps
MONGO_CONNECTION_STRING=                     # MongoDB (calibration models)
REDIS_URL=                                   # Redis (optional, graceful fallback)
```

---

## Project Structure

```
kardashev-network/
├── src/
│   ├── pages/
│   │   ├── index.tsx                # Landing page with 3D solar globe
│   │   ├── dashboard.tsx            # Solar dashboard (premium x402 data)
│   │   ├── weather-forecast.tsx     # Ensemble weather + Kalshi trading
│   │   ├── about.tsx                # Kardashev Scale + how payments work
│   │   ├── api-docs.tsx             # API documentation
│   │   └── api/
│   │       ├── solar/
│   │       │   ├── irradiance.ts    # x402-gated solar data ($0.001 USDC)
│   │       │   ├── building-insights.ts  # Google Solar roof analysis
│   │       │   └── data-layers.ts   # Solar flux heatmap PNG
│   │       ├── weather/
│   │       │   ├── forecasts.ts     # 6-source ensemble weather
│   │       │   ├── calibration.ts   # Isotonic calibration model
│   │       │   ├── performance.ts   # Win rate + Brier score tracking
│   │       │   ├── bias.ts          # Temperature bias correction
│   │       │   └── resolve-markets.ts  # Kalshi market resolution (cron)
│   │       ├── kalshi/
│   │       │   └── markets.ts       # Live Kalshi weather markets
│   │       └── geocode/
│   │           └── search.ts        # Forward/reverse geocoding
│   ├── components/
│   │   ├── LocationSearch.tsx       # Address search + geolocation
│   │   ├── PaymentGate.tsx          # x402 payment modal (EVM/Solana)
│   │   ├── SolarCurve.tsx           # Hourly irradiance chart
│   │   ├── RoofAnalysis.tsx         # Google Solar roof insights
│   │   ├── SunroofMap.tsx           # Google Maps solar overlay
│   │   ├── WeekForecast.tsx         # 7-day solar forecast
│   │   ├── three/                   # 3D globe (R3F)
│   │   └── weather/                 # Weather dashboard components
│   ├── hooks/
│   │   ├── usePremiumSolarData.ts   # x402 payment orchestration
│   │   ├── useMultiChainX402.ts     # Dual-chain wallet state
│   │   ├── useX402.ts              # EVM signer
│   │   ├── useX402Solana.ts        # Solana signer bridge
│   │   ├── useGoogleSolar.ts       # Roof analysis data
│   │   ├── useWeatherForecasts.ts  # Ensemble weather
│   │   ├── useWeatherOpportunities.ts  # Kalshi trading signals
│   │   └── useLocation.ts          # Geolocation
│   ├── lib/
│   │   ├── api/                    # External API clients (Open-Meteo, Google, METAR, NWS)
│   │   ├── models/                 # Calibration, ensemble weights, probability engine
│   │   ├── cache/                  # Redis client + cache warmup
│   │   ├── calculations/           # Solar value formulas
│   │   ├── db/                     # MongoDB connection
│   │   ├── x402/                   # Payment config + middleware
│   │   └── utils/                  # City coordinates, airports, conversions
│   └── context/
│       └── LocationContext.tsx      # Global location state
├── contracts/
│   └── KardashevNetwork.sol        # ERC20 energy token (future)
└── ecosystem.config.js             # PM2 process config
```

---

## Features

### Solar Dashboard
- Real-time GHI irradiance at any location
- Animated uncaptured dollar value (per hour / day / month)
- Hourly solar forecast curve
- Google Solar roof analysis (panel count, area, savings)
- Google Maps solar flux overlay
- **Premium** (x402): 7-day forecast, diffuse/direct radiation, thermal efficiency, weather context

### Weather Forecast
- 6-source ensemble with inverse-Brier weighting
- Isotonic calibration from 976 historical markets
- Live Kalshi market opportunities with edge signals
- Trading strategies by event group
- Auto-refresh every 15 minutes

### Payments
- x402 micropayments — $0.001 USDC per premium request
- Dual-chain: Base Sepolia (EVM) + Solana Devnet
- 30-minute session after payment (no repeat charges)
- Free tier with cached data for users without wallets

---

## API

| Endpoint | Price | Description |
|----------|-------|-------------|
| `GET /api/solar/irradiance` | Free / $0.001 USDC | Solar irradiance (premium adds forecast, weather, thermal) |
| `GET /api/solar/building-insights` | Free | Google Solar roof analysis |
| `GET /api/solar/data-layers` | Free | Solar flux heatmap PNG |
| `GET /api/weather/forecasts` | Free | 6-source ensemble weather |
| `GET /api/kalshi/markets` | Free | Live Kalshi weather markets |
| `GET /api/geocode/search` | Free | Forward/reverse geocoding |

---

## Data Sources

| Data | Source |
|------|--------|
| Solar Irradiance | [Open-Meteo](https://open-meteo.com) |
| Roof Analysis | [Google Solar API](https://developers.google.com/maps/documentation/solar) |
| Weather (ensemble) | Open-Meteo, Google Weather, [NWS](https://weather.gov), METAR |
| Prediction Markets | [Kalshi](https://kalshi.com) |
| Geocoding | [Nominatim](https://nominatim.org) |

---

## Infrastructure

- **DigitalOcean droplet** with PM2 (web app + market resolution cron)
- **nginx** reverse proxy → localhost:3000
- **Cloudflare** DNS/CDN with Full (Strict) SSL
- **Redis** on-droplet for L2 cache (512MB, allkeys-lru)
- **MongoDB** for calibration models and performance tracking
- **GitHub Actions** auto-deploy on push to main

---

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

---

## License

MIT License — see [LICENSE](LICENSE) for details.

---

## Links

- [x402 Documentation](https://x402.org)
- [Open-Meteo API](https://open-meteo.com/en/docs)
- [Google Solar API](https://developers.google.com/maps/documentation/solar)
- [Kalshi](https://kalshi.com)

---

<p align="center">
  <strong>Kardashev Network</strong><br>
  Making the invisible visible.
</p>
