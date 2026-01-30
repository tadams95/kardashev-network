# Kardashev Network

**Making the invisible visible** — See how much solar energy is hitting any location in real-time, and the dollar value going uncaptured every second.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Next.js](https://img.shields.io/badge/Next.js-12-black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)
![Base](https://img.shields.io/badge/Base-Onchain-0052FF)

---

## Vision

Every second, millions of dollars worth of solar energy hits rooftops, parking lots, and open land — and most of it goes uncaptured. Kardashev Network visualizes this invisible opportunity, showing users the real-time value of solar energy at their location.

> "Money is literally falling from the sky. We just help you see it."

---

## The Killer Feature: Wasted Energy Meter

```
┌─────────────────────────────────────┐
│     LOS ANGELES, CA  12:34 PM      │
├─────────────────────────────────────┤
│   ☀️  847 W/m²                     │
│   Current Solar Irradiance          │
│   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░  87%     │
├─────────────────────────────────────┤
│   💰  $127/hour UNCAPTURED         │
│   📊  $1,050 today | $31,500/month │
└─────────────────────────────────────┘
```

- **Real-time solar irradiance** (W/m²) at any location
- **Dollar value** of uncaptured energy per hour/day/month
- **Interactive 3D sun** visualization that responds to data and user input
- **Hourly charts** showing energy potential throughout the day

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 12, React 18, TypeScript |
| 3D Graphics | Three.js, React Three Fiber |
| Animation | Framer Motion, react-countup |
| Styling | Tailwind CSS |
| Charts | Recharts |
| Wallet | RainbowKit, wagmi, viem |
| Payments | x402 (Base USDC micropayments) |
| Data | Open-Meteo, Electricity Maps, OpenStreetMap |
| Hosting | Vercel |

---

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- A wallet with Base Sepolia ETH (for testing x402 payments)

### Installation

```bash
# Clone the repository
git clone https://github.com/tadams95/kardashev-network.git
cd kardashev-network

# Install dependencies
npm install

# Install additional dependencies for MVP
npm install swr recharts framer-motion react-countup lucide-react
npm install three @react-three/fiber @react-three/drei @react-three/postprocessing
npm install -D @types/three

# Set up environment variables
cp .env.example .env.local
# Edit .env.local with your configuration

# Run development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the app.

### Environment Variables

```bash
# .env.local

# x402 Payment Configuration
X402_RECEIVER_ADDRESS=0x...          # Your Base wallet address
NEXT_PUBLIC_X402_NETWORK=base-sepolia # or 'base' for production

# Optional
ELECTRICITY_MAPS_API_KEY=            # For carbon intensity data
```

---

## Project Structure

```
kardashev-network/
├── src/
│   ├── pages/
│   │   ├── index.tsx              # Landing page
│   │   ├── dashboard.tsx          # Main dashboard
│   │   └── api/
│   │       ├── solar/             # Solar irradiance API
│   │       ├── grid/              # Carbon intensity API
│   │       ├── buildings/         # Building footprint API
│   │       └── geocode/           # Geocoding API
│   ├── components/
│   │   ├── three/                 # 3D visualization
│   │   │   ├── SunScene.tsx       # Main R3F scene
│   │   │   ├── Sun.tsx            # 3D sun with shaders
│   │   │   └── EnergyParticles.tsx
│   │   ├── LocationSearch.tsx     # Address/geolocation input
│   │   ├── SolarMeter.tsx         # Irradiance gauge
│   │   ├── WastedValue.tsx        # Animated $ counter
│   │   └── IrradianceChart.tsx    # Hourly chart
│   ├── hooks/
│   │   ├── useLocation.ts         # Geolocation hook
│   │   ├── useSolarData.ts        # Solar API hook
│   │   └── useX402.ts             # Payment hook
│   ├── lib/
│   │   ├── api/                   # External API clients
│   │   ├── x402/                  # Payment middleware
│   │   └── calculations/          # Solar value formulas
│   └── context/
│       └── LocationContext.tsx    # Global location state
├── contracts/
│   └── KardashevNetwork.sol       # Energy token contract (future)
└── public/
    └── animations/                # Rive files (future)
```

---

## Features

### MVP (Current Focus)

- [x] Wallet connection (RainbowKit)
- [ ] Location search + browser geolocation
- [ ] Real-time solar irradiance display
- [ ] Animated "wasted value" counter
- [ ] Interactive 3D sun visualization
- [ ] Hourly irradiance chart
- [ ] Grid carbon intensity badge
- [ ] x402 micropayments for premium data
- [ ] Mobile responsive design

### Future

- [ ] Rive animations for weather states
- [ ] Historical data (30 days)
- [ ] Multi-location comparison
- [ ] PDF/CSV export
- [ ] Energy token minting (ERC1155)
- [ ] Interactive solar potential map

---

## API Monetization (x402)

Kardashev Network uses [x402](https://x402.org) for onchain API monetization:

| Endpoint | Price | Description |
|----------|-------|-------------|
| `/api/solar/irradiance` | 0.001 USDC | Real-time solar data |
| `/api/grid/carbon` | 0.002 USDC | Carbon intensity |
| `/api/buildings/area` | 0.005 USDC | Building footprints |
| `/api/premium/analytics` | 0.01 USDC | Aggregated insights |

**Free tier available** with cached/delayed data for users without wallets.

---

## Data Sources

| Data | Source | License |
|------|--------|---------|
| Solar Irradiance | [Open-Meteo](https://open-meteo.com) | Free, no API key |
| Carbon Intensity | [Electricity Maps](https://electricitymaps.com) | Free tier |
| Building Footprints | [OpenStreetMap](https://openstreetmap.org) | ODbL |
| Geocoding | [Nominatim](https://nominatim.org) | ODbL |

---

## Solar Value Calculation

```typescript
const ELECTRICITY_PRICE = 0.20;  // $/kWh (California average)
const PANEL_EFFICIENCY = 0.20;   // 20% typical efficiency
const SYSTEM_LOSSES = 0.14;      // 14% inverter/wiring losses

// Wasted value per hour
const capturedKw = (ghiWm2 * areaM2 * PANEL_EFFICIENCY * (1 - SYSTEM_LOSSES)) / 1000;
const wastedValuePerHour = capturedKw * ELECTRICITY_PRICE;
```

---

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting a PR.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## License

MIT License - see [LICENSE](LICENSE) for details.

---

## Links

- [Implementation Checklist](../IMPLEMENTATION_CHECKLIST.md)
- [x402 Documentation](https://x402.org)
- [Open-Meteo API](https://open-meteo.com/en/docs)
- [React Three Fiber](https://docs.pmnd.rs/react-three-fiber)

---

<p align="center">
  <strong>Kardashev Network</strong><br>
  Making the invisible visible.
</p>
