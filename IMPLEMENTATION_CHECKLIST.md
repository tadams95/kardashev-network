# Kardashev Network MVP: Energy Data Visualization Platform

## Vision
"Any user can see how much energy is hitting an area at any point in time" — making the invisible visible. Show the gap between solar energy hitting surfaces and what's actually captured ("money falling from the sky").

---

## The Killer Feature: Wasted Energy Meter

A single compelling visualization showing:
- Current solar irradiance (W/m²) at user's location
- Estimated rooftop/surface area
- Dollar value of uncaptured energy per hour/day/month

```
┌─────────────────────────────────────┐
│     SAN DIEGO, CA  12:34 PM      │
├─────────────────────────────────────┤
│   ☀️  847 W/m²                     │
│   Current Solar Irradiance          │
│   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░  87%     │
├─────────────────────────────────────┤
│   💰  $127/hour UNCAPTURED         │
│   📊  $1,050 today | $31,500/month │
└─────────────────────────────────────┘
```

---

## Data Sources

| Data | Source | Cost | x402 Monetization |
|------|--------|------|-------------------|
| Solar irradiance (GHI, DNI) | Open-Meteo | Free upstream | 0.001 USDC/request |
| Grid carbon intensity | Electricity Maps | Free tier | 0.002 USDC/request |
| Building footprints | Overpass API (OSM) | Free upstream | 0.005 USDC/request |
| Geocoding | Nominatim (OSM) | Free upstream | 0.001 USDC/request |
| Premium analytics | Aggregated insights | Our value-add | 0.01 USDC/request |

---

## x402 API Monetization Strategy

### Why x402?
- Keep the project onchain from day one
- Monetize API access with micropayments (no API keys needed)
- Users pay per request with Base USDC
- Instant settlement, no invoicing complexity
- Progressive paywall: free tier → paid premium

### x402 Integration Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                      CLIENT (Browser)                         │
│  - Wallet connected via RainbowKit                           │
│  - x402 client intercepts 402 responses                      │
│  - Auto-signs payment for API access                         │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│                    NEXT.JS API ROUTES                         │
│  /api/solar/irradiance    → x402 middleware (0.001 USDC)     │
│  /api/grid/carbon         → x402 middleware (0.002 USDC)     │
│  /api/buildings/area      → x402 middleware (0.005 USDC)     │
│  /api/premium/analytics   → x402 middleware (0.01 USDC)      │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│                   UPSTREAM FREE APIs                          │
│  Open-Meteo / Electricity Maps / Overpass / Nominatim        │
└──────────────────────────────────────────────────────────────┘
```

### Free vs Paid Tiers
| Feature | Free (no wallet) | Paid (x402) |
|---------|------------------|-------------|
| Current irradiance | ✓ (cached, 15min delay) | ✓ (real-time) |
| Hourly forecast | Last 6 hours only | Full 24 hours |
| Building area | Estimate only | Actual footprint |
| Carbon intensity | ✓ | ✓ |
| Historical data | ✗ | ✓ (30 days) |
| Bulk export | ✗ | ✓ |

---

## MVP Scope

### Include
- [x] Location search + browser geolocation
- [ ] Real-time solar irradiance display
- [ ] Animated "wasted value" counter
- [ ] Hourly irradiance chart (today)
- [ ] Grid carbon intensity badge
- [ ] Mobile responsive design
- [ ] Share functionality
- [ ] x402 payment integration for premium APIs
- [ ] Wallet connection (already exists)

### Explicitly Exclude (Keep for Later)
- No user accounts (wallet is identity)
- No historical data beyond today (free tier)
- No interactive map
- No multi-location comparison
- No PDF reports
- Keep existing token contract code but don't use in MVP

---

## Technical Architecture

### New Dependencies

```json
{
  "swr": "^2.2.0",
  "recharts": "^2.10.0",
  "framer-motion": "^10.16.0",
  "react-countup": "^6.5.0",
  "lucide-react": "^0.294.0",
  "x402": "^0.1.0",
  "@x402/next": "^0.1.0",

  "three": "^0.160.0",
  "@react-three/fiber": "^8.15.0",
  "@react-three/drei": "^9.92.0",
  "@react-three/postprocessing": "^2.15.0"
}
```

---

## Premium Animation & Motion Design

### Animation Stack

| Layer | Tool | Purpose |
|-------|------|---------|
| 3D Hero Sun | Three.js + React Three Fiber | Glowing sun, particle effects, energy rays |
| UI Transitions | Framer Motion | Page transitions, micro-interactions |
| Data Counters | react-countup + Framer | Smooth number animations |
| Post-processing | @react-three/postprocessing | Bloom, glow effects |

### 3D Sun Visualization (Hero)

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│              ✦  ·  ✦       ✦  ·                            │
│           ·    ╭───────╮    ·    ✦                         │
│         ✦    ╭─┤ ☀ SUN ├─╮    ·                           │
│        ·   ╭─┤ │       │ ├─╮   ✦    ← Particle rays       │
│            │  ╰───────╯  │      ·      streaming outward   │
│         ✦  ╰─────┬───────╯  ·                              │
│           ·      │      ✦       ← Corona glow effect       │
│              ════╧════          ← Energy beam to ground    │
│         ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓                                 │
│              GROUND                                         │
└─────────────────────────────────────────────────────────────┘
```

**Features:**
- Procedural sun with animated corona/flares
- Glow intensity tied to real irradiance data (GHI)
- Particle system: energy rays streaming toward ground
- Bloom post-processing for premium glow
- Smooth transitions: day → sunset → night
- Cloud layer that responds to cloudCover %

### Animation Components

```
src/
├── components/
│   └── three/
│       ├── SunScene.tsx           # Main R3F canvas + scene
│       ├── Sun.tsx                # 3D sun with glow shader
│       ├── EnergyParticles.tsx    # Particle system for energy rays
│       ├── CloudLayer.tsx         # Animated cloud coverage
│       ├── Ground.tsx             # Ground plane with energy absorption
│       └── shaders/
│           ├── sunGlow.glsl       # Custom sun corona shader
│           └── energyBeam.glsl    # Energy ray shader
```

### Data-Driven Animation Bindings

| Data Point | Animation Effect |
|------------|------------------|
| `ghi` (irradiance) | Sun glow intensity, particle density |
| `cloudCover` | Cloud layer opacity, sun dimming |
| `isDay` | Day/night scene transition |
| `currentValue` | Energy beam thickness, particle speed |
| Time of day | Sun position, sky gradient |

### Interactive Animation Bindings

| User Input | Animation Response |
|------------|-------------------|
| Mouse position | Camera parallax (subtle tilt toward cursor) |
| Mouse enter sun | Glow intensifies, corona expands |
| Mouse exit sun | Returns to data-driven baseline |
| Cursor near particles | Particles curve toward cursor |
| Click sun | Pulse wave + stats overlay appears |
| Scroll position | Dashboard sections reveal sequentially |
| Touch drag (mobile) | Same as mouse parallax |
| Tap (mobile) | Same as click |

### Interactive Sun Behavior

```
┌─────────────────────────────────────────────────────────────┐
│                    INTERACTION STATES                       │
│                                                             │
│  IDLE (default)                                             │
│  └─ Sun glow = f(ghi)                                       │
│  └─ Particles flow downward                                 │
│  └─ Camera static                                           │
│                                                             │
│  HOVER (mouse over scene)                                   │
│  └─ Camera tilts toward cursor (±5° max)                    │
│  └─ Particles bend toward cursor                            │
│  └─ Subtle vignette follows mouse                           │
│                                                             │
│  HOVER SUN (mouse directly on sun)                          │
│  └─ Glow intensity += 30%                                   │
│  └─ Corona rays speed up                                    │
│  └─ Cursor changes to pointer                               │
│                                                             │
│  CLICK SUN                                                  │
│  └─ Pulse wave radiates outward                             │
│  └─ Stats overlay fades in:                                 │
│     "847 W/m² hitting this location"                        │
│     "≈ $127/hr uncaptured"                                  │
│  └─ Click elsewhere to dismiss                              │
│                                                             │
│  SCROLL                                                     │
│  └─ Hero section parallax (sun rises slightly)              │
│  └─ Dashboard sections stagger in                           │
│  └─ Chart animates on enter viewport                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Alternative: Rive (Designer-Friendly)

For specific UI elements, Rive offers state-machine animations:

```json
{
  "@rive-app/react-canvas": "^4.5.0"
}
```

**Rive Use Cases:**
- Weather state icons (sunny ↔ cloudy ↔ night)
- Loading animations
- Interactive gauge needles
- Celebration effects on payment success

**Decision:** Use Three.js/R3F for hero (MVP), add Rive for UI micro-animations (post-MVP).

---

## Rive Integration (Optional Enhancement - Post-MVP)

### Why Rive?
- **State machines**: Animations that respond to data inputs
- **Designer-friendly**: Visual editor, no code for animation creation
- **Performant**: WebGL-based, ~50kb per animation
- **Perfect for**: Weather states, gauges, loaders, micro-interactions

### Rive Dependencies

```json
{
  "@rive-app/react-canvas": "^4.5.0"
}
```

### State Machine: Weather Sun Icon

```
┌─────────────────────────────────────────────────────────────┐
│               STATE MACHINE: "WeatherController"            │
│                                                             │
│  INPUTS (bound to API data):                                │
│  ├─ ghi (Number: 0-1000)       ← irradiance intensity       │
│  ├─ cloudCover (Number: 0-100) ← cloud percentage           │
│  └─ isDay (Boolean)            ← day or night               │
│                                                             │
│  STATES:                                                    │
│  ┌────────┐     ┌─────────────┐     ┌────────┐             │
│  │ SUNNY  │ ←─→ │ PARTLY      │ ←─→ │ CLOUDY │             │
│  │   ☀️   │     │ CLOUDY  ⛅  │     │   ☁️   │             │
│  └───┬────┘     └──────┬──────┘     └───┬────┘             │
│      │                 │                 │                  │
│      └─────────────────┼─────────────────┘                  │
│                        ↓                                    │
│                  ┌──────────┐                               │
│                  │  NIGHT   │                               │
│                  │    🌙    │                               │
│                  └──────────┘                               │
│                                                             │
│  TRANSITIONS:                                               │
│  - cloudCover < 20%  → SUNNY                                │
│  - cloudCover 20-60% → PARTLY CLOUDY                        │
│  - cloudCover > 60%  → CLOUDY                               │
│  - isDay == false    → NIGHT (any state)                    │
│                                                             │
│  DATA-BOUND ANIMATIONS:                                     │
│  - Sun glow radius    ← scales with ghi                     │
│  - Sun ray rotation   ← faster when ghi high                │
│  - Cloud drift speed  ← varies with cloudCover              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Rive Use Cases for Kardashev

| Component | Animation | Data Binding |
|-----------|-----------|--------------|
| Weather icon | Sun ↔ Clouds ↔ Moon morph | `cloudCover`, `isDay` |
| Solar gauge | Needle position + glow | `ghi` value |
| Loading state | Pulsing sun rays | Loops until data ready |
| Payment success | Checkmark + confetti | Triggered on x402 complete |
| Energy flow | Particles sun → ground | `currentValue` intensity |

### Example Implementation

```tsx
// components/rive/WeatherIcon.tsx
import { useRive, useStateMachineInput } from '@rive-app/react-canvas';

interface Props {
  ghi: number;
  cloudCover: number;
  isDay: boolean;
}

export function WeatherIcon({ ghi, cloudCover, isDay }: Props) {
  const { rive, RiveComponent } = useRive({
    src: '/animations/weather-sun.riv',
    stateMachines: 'WeatherController',
    autoplay: true,
  });

  const ghiInput = useStateMachineInput(rive, 'WeatherController', 'ghi');
  const cloudInput = useStateMachineInput(rive, 'WeatherController', 'cloudCover');
  const isDayInput = useStateMachineInput(rive, 'WeatherController', 'isDay');

  useEffect(() => {
    if (ghiInput) ghiInput.value = ghi;
    if (cloudInput) cloudInput.value = cloudCover;
    if (isDayInput) isDayInput.value = isDay;
  }, [ghi, cloudCover, isDay]);

  return <RiveComponent className="w-24 h-24" />;
}
```

### Rive File Structure (Post-MVP)

```
public/
└── animations/
    ├── weather-sun.riv         # Weather state icon
    ├── solar-gauge.riv         # Irradiance gauge
    ├── loading-sun.riv         # Loading spinner
    └── payment-success.riv     # x402 payment celebration

src/
└── components/
    └── rive/
        ├── WeatherIcon.tsx     # Weather state component
        ├── SolarGauge.tsx      # Gauge with data binding
        └── PaymentSuccess.tsx  # Celebration animation
```

### Rive Implementation Checklist (Post-MVP)

- [ ] Install Rive dependency (`@rive-app/react-canvas`)
- [ ] Design weather-sun animation in Rive Editor
- [ ] Set up state machine with ghi/cloudCover/isDay inputs
- [ ] Export .riv file to `/public/animations/`
- [ ] Create `WeatherIcon.tsx` component with data binding
- [ ] Replace static weather icon in dashboard
- [ ] Design solar gauge animation (optional)
- [ ] Design payment success celebration (optional)

### File Structure

```
src/
├── pages/
│   ├── index.tsx                    # Landing → modify
│   ├── dashboard.tsx                # New: main dashboard
│   └── api/
│       ├── solar/irradiance.ts      # New: Open-Meteo proxy + x402
│       ├── grid/carbon.ts           # New: Electricity Maps proxy + x402
│       ├── buildings/area.ts        # New: Overpass proxy + x402
│       ├── geocode/search.ts        # New: Nominatim proxy + x402
│       └── premium/
│           └── analytics.ts         # New: Premium aggregated data
├── components/
│   ├── HeroSection.tsx              # Modify: add LocationSearch + 3D Sun
│   ├── LocationSearch.tsx           # New: address input + geolocation
│   ├── SolarMeter.tsx               # New: radial gauge
│   ├── WastedValue.tsx              # New: animated dollar counter
│   ├── IrradianceChart.tsx          # New: hourly chart
│   ├── GridCarbonBadge.tsx          # New: carbon intensity
│   ├── PaymentGate.tsx              # New: x402 payment prompt
│   └── three/                       # New: 3D visualization components
│       ├── SunScene.tsx             # R3F canvas + scene setup
│       ├── Sun.tsx                  # 3D sun with corona shader
│       ├── EnergyParticles.tsx      # Particle system for energy rays
│       ├── CloudLayer.tsx           # Animated cloud coverage
│       ├── Ground.tsx               # Ground plane receiving energy
│       ├── InteractiveCamera.tsx    # Mouse parallax camera controls
│       └── StatsOverlay.tsx         # Click-to-reveal energy stats
├── hooks/
│   ├── useLocation.ts               # New: geolocation + context
│   ├── useSolarData.ts              # New: SWR hook for solar API
│   ├── useBuildingArea.ts           # New: building footprints
│   ├── useX402.ts                   # New: x402 payment hook
│   ├── useMouseParallax.ts          # New: mouse position for 3D parallax
│   └── useScrollReveal.ts           # New: scroll-triggered animations
├── lib/
│   ├── api/
│   │   ├── openMeteo.ts             # New: Open-Meteo client
│   │   ├── electricityMaps.ts       # New: Electricity Maps client
│   │   └── overpass.ts              # New: Overpass client
│   ├── x402/
│   │   ├── middleware.ts            # New: x402 API middleware
│   │   ├── config.ts                # New: pricing configuration
│   │   └── client.ts                # New: client-side x402 helper
│   └── calculations/
│       └── solarValue.ts            # New: $/kWh calculations
├── context/
│   └── LocationContext.tsx          # New: global location state
└── types/
    ├── solar.ts                     # New: TypeScript interfaces
    └── x402.ts                      # New: x402 types
```

---

## Implementation Phases

### Phase 1: API Layer + x402 Foundation (Days 1-3)

#### API Routes
- [x] Create `/api/solar/irradiance.ts` — proxy to Open-Meteo
- [x] Create `/lib/api/openMeteo.ts` — API client with response transform
- [x] Create `/types/solar.ts` — TypeScript interfaces
- [x] Add simple in-memory caching (5-minute TTL)
- [ ] Test with hardcoded LA coordinates

#### x402 Setup
- [x] Install x402 dependencies (`x402-next`, `x402-fetch`)
- [x] Create `/lib/x402/config.ts` — pricing per endpoint
- [x] Create `/lib/x402/middleware.ts` — Next.js API middleware (Pages Router compatible)
- [x] Configure x402 with Base network + USDC
- [x] Set up receiving wallet address in env
- [ ] Test payment flow with Irradiance endpoint

### Phase 2: Location Flow (Days 4-5)

- [ ] Create `LocationContext.tsx` — global location state
- [ ] Create `useLocation.ts` hook — browser geolocation
- [ ] Create `LocationSearch.tsx` — address input with geocoding
- [ ] Create `/api/geocode/search.ts` — Nominatim proxy
- [ ] Update `_app.tsx` — wrap with LocationProvider
- [ ] Update landing page hero with location search
- [ ] Handle location permission denied gracefully

### Phase 3: Core Dashboard (Days 6-8)

#### Components
- [ ] Create `dashboard.tsx` page
- [ ] Create `useSolarData.ts` hook with SWR
- [ ] Create `SolarMeter.tsx` — radial gauge showing irradiance
- [ ] Create `WastedValue.tsx` — animated dollar counter (react-countup)
- [ ] Create `/lib/calculations/solarValue.ts` — conversion logic
- [ ] Connect components to live data

#### x402 Client Integration
- [ ] Create `useX402.ts` hook — handles 402 responses
- [ ] Create `PaymentGate.tsx` — prompt user to pay for premium
- [ ] Wire up wallet signing for x402 payments
- [ ] Add payment status indicators

### Phase 4: Charts & Additional Data (Days 9-11)

- [ ] Create `IrradianceChart.tsx` — hourly Recharts area chart
- [ ] Create `/api/grid/carbon.ts` — Electricity Maps proxy + x402
- [ ] Create `GridCarbonBadge.tsx` — carbon intensity display
- [ ] Create `/api/buildings/area.ts` — Overpass proxy for building area
- [ ] Create `useBuildingArea.ts` hook
- [ ] Add building area to wasted value calculation

### Phase 5: 3D Visualization & Animation (Days 12-16)

#### Three.js / React Three Fiber Setup
- [ ] Install Three.js dependencies (`three`, `@react-three/fiber`, `@react-three/drei`)
- [ ] Create `SunScene.tsx` — R3F Canvas with scene setup
- [ ] Create `Sun.tsx` — 3D sun sphere with custom glow shader
- [ ] Implement bloom post-processing for sun corona effect
- [ ] Bind sun glow intensity to real irradiance data (GHI)

#### Particle System & Effects
- [ ] Create `EnergyParticles.tsx` — particles streaming from sun to ground
- [ ] Particle density responds to current irradiance
- [ ] Create `CloudLayer.tsx` — animated clouds based on cloudCover %
- [ ] Create `Ground.tsx` — ground plane showing energy absorption
- [ ] Add day/night transition animations

#### Interactive Features (User Input)
- [ ] Add mouse parallax to sun scene (subtle camera movement following cursor)
- [ ] Sun glow intensifies on hover (mouseenter/mouseleave)
- [ ] Particles attract toward cursor position
- [ ] Click sun for pulse effect + reveal energy stats overlay
- [ ] Touch support: tap = click, drag = parallax
- [ ] Scroll-triggered section reveals (dashboard sections animate in)

#### Performance & Polish
- [ ] Optimize Three.js for mobile (reduce particle count, lower resolution)
- [ ] Add fallback for devices without WebGL
- [ ] Lazy load 3D scene (don't block initial render)
- [ ] Install `leva` for dev-mode debug controls (optional)

### Phase 6: Final Polish & Launch (Days 17-20)

- [ ] Add loading states (framer-motion skeletons)
- [ ] Add error handling for all API calls
- [ ] Handle nighttime state (moon scene, next sunrise countdown)
- [ ] Add share functionality (copy link, Twitter)
- [ ] Mobile responsive adjustments
- [ ] Performance optimization (React.memo, useMemo)
- [ ] Cross-browser testing (Safari, Chrome, Firefox)
- [ ] Deploy to Vercel
- [ ] Configure production x402 wallet

---

## Key Files to Modify

| File | Changes |
|------|---------|
| `src/pages/_app.tsx` | Add LocationProvider, keep existing wallet setup |
| `src/pages/index.tsx` | Simplify to landing with location search |
| `src/components/HeroSection.tsx` | Replace SCInteraction with LocationSearch |
| `package.json` | Add new dependencies |
| `tailwind.config.ts` | Add solar color palette, animations |
| `.env.local` | Add `X402_RECEIVER_ADDRESS`, API keys if needed |

---

## Core Type Definitions

```typescript
// src/types/solar.ts
interface SolarData {
  current: {
    ghi: number;        // W/m² Global Horizontal Irradiance
    dni: number;        // W/m² Direct Normal Irradiance
    cloudCover: number; // 0-100%
    isDay: boolean;
  };
  hourly: Array<{
    time: string;
    ghi: number;
    cloudCover: number;
  }>;
  location: {
    timezone: string;
    elevation: number;
  };
}

interface WastedEnergy {
  currentWatts: number;
  currentValue: number;    // $/hour
  todayValue: number;      // $
  monthlyEstimate: number; // $
}

interface Location {
  lat: number;
  lng: number;
  address?: string;
  city?: string;
  timezone?: string;
}
```

```typescript
// src/types/x402.ts
interface X402Config {
  endpoint: string;
  price: string;           // USDC amount (e.g., "0.001")
  description: string;
  network: 'base' | 'base-sepolia';
}

interface PaymentReceipt {
  txHash: string;
  amount: string;
  timestamp: number;
  endpoint: string;
}
```

---

## x402 Configuration

```typescript
// src/lib/x402/config.ts
export const X402_PRICING = {
  '/api/solar/irradiance': {
    price: '0.001',
    description: 'Real-time solar irradiance data',
    freeTier: true,        // Allow cached/delayed for free
    freeDelayMinutes: 15,
  },
  '/api/grid/carbon': {
    price: '0.002',
    description: 'Grid carbon intensity',
    freeTier: true,
  },
  '/api/buildings/area': {
    price: '0.005',
    description: 'Building footprint data',
    freeTier: false,       // Paid only
  },
  '/api/geocode/search': {
    price: '0.001',
    description: 'Address geocoding',
    freeTier: true,
  },
  '/api/premium/analytics': {
    price: '0.01',
    description: 'Premium analytics and historical data',
    freeTier: false,
  },
} as const;

export const X402_CONFIG = {
  receiverAddress: process.env.X402_RECEIVER_ADDRESS!,
  network: process.env.NODE_ENV === 'production' ? 'base' : 'base-sepolia',
  token: 'USDC',
} as const;
```

---

## Solar Value Calculation

```typescript
// src/lib/calculations/solarValue.ts
const ELECTRICITY_PRICE = 0.20;  // $/kWh (CA average)
const PANEL_EFFICIENCY = 0.20;   // 20% typical panel efficiency
const SYSTEM_LOSSES = 0.14;      // 14% inverter/wiring losses
const DEFAULT_ROOF_M2 = 150;     // Default estimate if no building data

export function calculateWastedValue(
  ghiWm2: number,
  areaM2: number = DEFAULT_ROOF_M2
): WastedEnergy {
  // Power that could be captured right now
  const capturedKw = (ghiWm2 * areaM2 * PANEL_EFFICIENCY * (1 - SYSTEM_LOSSES)) / 1000;
  const currentValue = capturedKw * ELECTRICITY_PRICE;

  // Estimates based on current rate
  const hoursRemaining = /* calculate from sunset */ 6;
  const avgMultiplier = 0.7; // Average irradiance is ~70% of current

  return {
    currentWatts: capturedKw * 1000,
    currentValue,                                    // $/hour
    todayValue: currentValue * hoursRemaining * avgMultiplier,
    monthlyEstimate: currentValue * 6 * avgMultiplier * 30,
  };
}
```

---

## User Flow

```
1. Landing Page
   - Compelling headline: "Every second, millions in solar energy goes uncaptured"
   - Current sun animation
   - CTA: "Check your location" button
   ↓
2. Location Permission / Search
   - Browser geolocation prompt (primary)
   - "Or enter an address" search bar (fallback)
   - Show loading spinner
   ↓
3. Dashboard (Free Tier)
   - Solar Meter (current irradiance, 15-min delayed)
   - Wasted Value counter ($/hour, animated)
   - Limited hourly chart (6 hours)
   - Grid carbon badge
   - "Unlock Real-Time Data" CTA → wallet connect
   ↓
4. Dashboard (x402 Paid)
   - Real-time irradiance (no delay)
   - Full 24-hour chart
   - Actual building footprint
   - Historical data access
   - Premium analytics
```

---

## Environment Variables

```bash
# .env.local

# x402 Configuration
X402_RECEIVER_ADDRESS=0x...      # Your Base wallet for receiving payments
NEXT_PUBLIC_X402_NETWORK=base-sepolia  # or 'base' for production

# Optional: Rate limiting
RATE_LIMIT_FREE_REQUESTS=100     # Free requests per hour per IP

# Optional: External API keys (if free tiers require)
ELECTRICITY_MAPS_API_KEY=        # Free tier: 50 req/hr
```

---

## Verification Plan

### API Layer
- [ ] Each endpoint returns valid data with curl/Postman
- [ ] x402 middleware returns 402 for premium requests without payment
- [ ] x402 accepts valid payment signatures
- [ ] Free tier returns cached/delayed data correctly
- [ ] Rate limiting works for free tier

### Location Flow
- [ ] Browser geolocation works on desktop Chrome/Safari
- [ ] Browser geolocation works on iOS Safari + Android Chrome
- [ ] Address search returns valid coordinates
- [ ] Permission denied shows fallback search

### Data Display
- [ ] Irradiance numbers match Open-Meteo raw response
- [ ] Wasted value calculation is mathematically correct
- [ ] Charts render hourly data correctly
- [ ] Nighttime state shows appropriate UI

### x402 Payments
- [ ] Wallet connects successfully
- [ ] 402 response triggers payment prompt
- [ ] Signed payment grants API access
- [ ] Payment receipt is stored/displayed
- [ ] Works on Base Sepolia testnet
- [ ] Works on Base mainnet

### Mobile & Cross-Browser
- [ ] Responsive layout on iPhone SE → iPad Pro
- [ ] iOS Safari works correctly
- [ ] Android Chrome works correctly
- [ ] Desktop Safari, Chrome, Firefox

---

## Definition of Done

### MVP Launch Criteria
- [ ] User lands on page and understands value prop in 5 seconds
- [ ] User can allow location access OR search an address
- [ ] User sees current solar irradiance with compelling visualization
- [ ] User sees dollar value of "wasted" energy ($/hour, $/day)
- [ ] User views hourly trend chart for today
- [ ] User sees grid carbon intensity
- [ ] User can share results via link
- [ ] Works great on mobile
- [ ] Free tier provides value without wallet
- [ ] Paid tier (x402) unlocks real-time + premium features
- [ ] Payments flow to configured wallet address

### Revenue Validation
- [ ] x402 payments successfully received on Base
- [ ] At least 1 paid API request in production
- [ ] Payment flow takes < 10 seconds

---

## Future Enhancements (Post-MVP)

### Near Term
- [ ] Historical data API (30 days) — premium
- [ ] Multi-location comparison
- [ ] PDF/CSV export for businesses
- [ ] Notification when irradiance peaks

### Medium Term
- [ ] Interactive map with solar potential overlay
- [ ] Integration with energy token minting (bring back ERC1155)
- [ ] ROI calculator for solar installation
- [ ] API subscription tiers (daily/monthly)

### Long Term
- [ ] Real-time satellite imagery overlay
- [ ] Partner integrations (solar installers)
- [ ] B2B API licensing
- [ ] Carbon offset marketplace

---

## Revenue Model

### x402 Micropayments (MVP)
| Endpoint | Price | Est. Volume/Day | Daily Revenue |
|----------|-------|-----------------|---------------|
| /api/solar/irradiance | $0.001 | 1,000 | $1.00 |
| /api/grid/carbon | $0.002 | 500 | $1.00 |
| /api/buildings/area | $0.005 | 200 | $1.00 |
| /api/premium/analytics | $0.01 | 100 | $1.00 |
| **Total** | | | **$4.00/day** |

### Growth Scenarios
- 10x users: $40/day = $1,200/month
- 100x users: $400/day = $12,000/month
- Enterprise API: Flat monthly subscription

### Why This Works
1. No signup friction — wallet is identity
2. No billing infrastructure — x402 handles payments
3. Scales with usage — pay per request
4. Onchain from day one — verifiable revenue
5. Low barrier — micropayments feel free

---

## Tech Stack Summary

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 12, React 18, TypeScript |
| Styling | Tailwind CSS |
| 3D Graphics | Three.js, React Three Fiber, drei |
| Animation | Framer Motion, react-countup |
| Post-processing | @react-three/postprocessing (bloom, glow) |
| Charts | Recharts |
| Wallet | RainbowKit, wagmi, viem |
| Payments | x402 (Base USDC) |
| Data Fetching | SWR |
| APIs | Next.js API Routes |
| Hosting | Vercel |
| Chain | Base (Sepolia for dev) |

---

## Quick Start Commands

```bash
# Install core dependencies
npm install swr recharts framer-motion react-countup lucide-react x402 @x402/next

# Install 3D/animation dependencies
npm install three @react-three/fiber @react-three/drei @react-three/postprocessing

# Install Three.js types
npm install -D @types/three

# Run development server
npm run dev

# Test x402 payment flow (requires Base Sepolia USDC)
# 1. Connect wallet in app
# 2. Navigate to dashboard
# 3. Request real-time data
# 4. Approve x402 payment
```

---

## Contact & Resources

**APIs & Payments:**
- **x402 Docs**: https://www.x402.org/
- **Open-Meteo API**: https://open-meteo.com/en/docs
- **Electricity Maps API**: https://docs.electricitymaps.com/
- **Base Network**: https://docs.base.org/

**3D & Animation:**
- **React Three Fiber**: https://docs.pmnd.rs/react-three-fiber
- **Three.js Docs**: https://threejs.org/docs/
- **drei (R3F Helpers)**: https://github.com/pmndrs/drei
- **Rive (Alternative)**: https://rive.app/
- **Framer Motion**: https://www.framer.com/motion/
