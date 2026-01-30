---
name: implement
description: Implement a feature or phase from the Kardashev Network IMPLEMENTATION_CHECKLIST.md
disable-model-invocation: true
argument-hint: "<phase-number or task-description>"
---

# Implement Feature from Checklist

Implement: **$ARGUMENTS**

## Reference Document

Always read the implementation checklist first:
- Path: `/Users/tyrelle/Desktop/KardashevNetwork/IMPLEMENTATION_CHECKLIST.md`

## Implementation Phases Overview

| Phase | Name | Days | Focus |
|-------|------|------|-------|
| 1 | API Layer + x402 Foundation | 1-3 | API routes, x402 setup |
| 2 | Location Flow | 4-5 | Geolocation, search, context |
| 3 | Core Dashboard | 6-8 | Components, SWR hooks, payment UI |
| 4 | Charts & Additional Data | 9-11 | Recharts, carbon data, building area |
| 5 | 3D Visualization & Animation | 12-16 | Three.js, R3F, particles, interactions |
| 6 | Final Polish & Launch | 17-20 | Loading states, errors, mobile, deploy |

## Phase 1: API Layer + x402 Foundation

### API Routes
- [ ] Create `/api/solar/irradiance.ts` — proxy to Open-Meteo
- [ ] Create `/lib/api/openMeteo.ts` — API client with response transform
- [ ] Create `/types/solar.ts` — TypeScript interfaces
- [ ] Add simple in-memory caching (5-minute TTL)

### x402 Setup
- [ ] Install x402 dependencies (`x402`, `@x402/next`)
- [ ] Create `/lib/x402/config.ts` — pricing per endpoint
- [ ] Create `/lib/x402/middleware.ts` — Next.js API middleware
- [ ] Configure x402 with Base network + USDC

## Phase 2: Location Flow

- [ ] Create `LocationContext.tsx` — global location state
- [ ] Create `useLocation.ts` hook — browser geolocation
- [ ] Create `LocationSearch.tsx` — address input with geocoding
- [ ] Create `/api/geocode/search.ts` — Nominatim proxy
- [ ] Update `_app.tsx` — wrap with LocationProvider

## Phase 3: Core Dashboard

- [ ] Create `dashboard.tsx` page
- [ ] Create `useSolarData.ts` hook with SWR
- [ ] Create `SolarMeter.tsx` — radial gauge
- [ ] Create `WastedValue.tsx` — animated dollar counter
- [ ] Create `/lib/calculations/solarValue.ts`
- [ ] Create `useX402.ts` hook
- [ ] Create `PaymentGate.tsx`

## Phase 4: Charts & Additional Data

- [ ] Create `IrradianceChart.tsx` — Recharts area chart
- [ ] Create `/api/grid/carbon.ts` — Electricity Maps proxy
- [ ] Create `GridCarbonBadge.tsx`
- [ ] Create `/api/buildings/area.ts` — Overpass proxy
- [ ] Create `useBuildingArea.ts` hook

## Phase 5: 3D Visualization & Animation

### Three.js Setup
- [ ] Install dependencies (`three`, `@react-three/fiber`, `@react-three/drei`)
- [ ] Create `SunScene.tsx` — R3F Canvas
- [ ] Create `Sun.tsx` — 3D sun with glow shader
- [ ] Implement bloom post-processing

### Particle System
- [ ] Create `EnergyParticles.tsx`
- [ ] Create `CloudLayer.tsx`
- [ ] Create `Ground.tsx`
- [ ] Add day/night transitions

### Interactive Features
- [ ] Mouse parallax camera
- [ ] Sun hover effects
- [ ] Click for stats overlay
- [ ] Touch support

## Phase 6: Final Polish

- [ ] Loading states (framer-motion skeletons)
- [ ] Error handling for all API calls
- [ ] Nighttime state handling
- [ ] Share functionality
- [ ] Mobile responsive
- [ ] Performance optimization
- [ ] Cross-browser testing
- [ ] Deploy to Vercel

## File Structure Reference

```
src/
├── pages/
│   ├── index.tsx              # Landing
│   ├── dashboard.tsx          # Main dashboard
│   └── api/
│       ├── solar/irradiance.ts
│       ├── grid/carbon.ts
│       ├── buildings/area.ts
│       └── geocode/search.ts
├── components/
│   ├── LocationSearch.tsx
│   ├── SolarMeter.tsx
│   ├── WastedValue.tsx
│   ├── IrradianceChart.tsx
│   ├── GridCarbonBadge.tsx
│   ├── PaymentGate.tsx
│   └── three/
│       ├── SunScene.tsx
│       ├── Sun.tsx
│       ├── EnergyParticles.tsx
│       └── ...
├── hooks/
│   ├── useLocation.ts
│   ├── useSolarData.ts
│   ├── useBuildingArea.ts
│   └── useX402.ts
├── lib/
│   ├── api/
│   │   ├── openMeteo.ts
│   │   ├── electricityMaps.ts
│   │   └── overpass.ts
│   ├── x402/
│   │   ├── config.ts
│   │   └── middleware.ts
│   └── calculations/
│       └── solarValue.ts
├── context/
│   └── LocationContext.tsx
└── types/
    ├── solar.ts
    └── x402.ts
```

## Implementation Workflow

1. **Read the checklist** for the specific phase/task
2. **Check dependencies** - install any missing packages
3. **Create types first** - define TypeScript interfaces
4. **Implement the feature** - follow project patterns
5. **Test the implementation** - use `/check` skill
6. **Update the checklist** - mark items as complete

## Checklist

- [ ] Read IMPLEMENTATION_CHECKLIST.md for context
- [ ] Identify all files that need to be created/modified
- [ ] Install any required dependencies
- [ ] Implement following project patterns
- [ ] Run `/check` to verify no errors
- [ ] Mark completed items in checklist
