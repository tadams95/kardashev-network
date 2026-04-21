# Solar Dashboard Audit

Read-only orientation doc covering `/dashboard`. Source-of-truth for component
tree, data flow, premium gating, the uncaptured-value calculation, and known
smells. No fixes proposed.

## 1. Component Tree

`Dashboard` (`src/pages/dashboard.tsx:25`) renders inside `Layout`
(`src/components/Layout.tsx:22`), which provides global header (`KardashevIcon`,
nav links, `WalletSelector`), mobile menu, and footer.

```
Layout
└── Dashboard
    ├── (no-location splash)              [when !location, dashboard.tsx:97-119]
    │   └── LocationSearch                [LocationSearch.tsx — free]
    │
    └── (main view)                        [when location is set]
        ├── PaymentGate (modal overlay)    [showPaymentGate && paymentRequired,
        │                                   dashboard.tsx:124-146 — premium CTA]
        │
        ├── Error banner                   [isError, dashboard.tsx:150-157]
        ├── PaymentStatus                  [pending/success/error,
        │                                   dashboard.tsx:160-171]
        ├── Tx hash link                   [isPremium && txHash,
        │                                   dashboard.tsx:174-186]
        │
        ├── LEFT COLUMN (lg:grid-cols-2)
        │   ├── Location card              [dashboard.tsx:193-243]
        │   │   └── TierBadge              [PaymentStatus.tsx:67 — Live | Free | Cached]
        │   ├── Hero "Uncaptured Value"    [CountUp, dashboard.tsx:246-291 — free]
        │   ├── Weather Context (premium)  [isPremium, dashboard.tsx:294-314]
        │   ├── Weather Context (locked)   [!isPremium, dashboard.tsx:317-327]
        │   ├── Stats grid                 [dashboard.tsx:330-399]
        │   │   ├── Irradiance             [free]
        │   │   ├── Today $                [free]
        │   │   ├── Peak W/m²              [free]
        │   │   └── Direct/Diffuse         [premium @ 370-387, locked stub @ 390-398]
        │   ├── SolarCurve  (mobile only)  [SolarCurve.tsx:59 — free, lg:hidden]
        │   ├── WeekForecast (mobile, premium)  [dashboard.tsx:416-429]
        │   ├── WeekForecast (mobile, locked)   [dashboard.tsx:432-444]
        │   └── Monthly Estimate Banner    [dashboard.tsx:447-482; CTA when !isPremium]
        │
        └── RIGHT COLUMN (hidden on mobile)
            ├── SolarCurve  (desktop)      [dashboard.tsx:488-503 — free,
            │                               SolarCurveSkeleton during load]
            ├── WeekForecast (desktop, premium)     [dashboard.tsx:506-517]
            ├── WeekForecast (desktop, locked stub) [dashboard.tsx:520-530]
            ├── SunroofMap                 [hasRoofData && location,
            │                               dashboard.tsx:533-537]
            └── RoofAnalysis               [isRoofLoading || hasRoofData,
                                            dashboard.tsx:540-548 — skeleton during load]
        ├── Info footer                    [dashboard.tsx:553-559]
```

Conditional render keys:
- `RoofAnalysis` only renders when `roofSummary` is truthy (Google Solar returned
  a `success` response). Wrapped section render-gates on `isRoofLoading || hasRoofData`
  (dashboard.tsx:540).
- `SunroofMap` only renders when `hasRoofData && location` (dashboard.tsx:533).
- "Direct/Diffuse" stat shows the premium variant when `isPremium &&
  solarData?.current.diffuseRadiation !== undefined` (dashboard.tsx:370). The
  locked stub renders when `!isPremium && solarData` (dashboard.tsx:390).
- Weather Context shows the premium row when
  `solarData?.current.weatherDescription !== undefined` (dashboard.tsx:294).
  Open-Meteo only emits `weather_code/weatherDescription` when `premium=true`
  (`src/lib/api/openMeteo.ts:106-114`), so this implicitly mirrors `isPremium`.
- 7-Day Forecast (`WeekForecast`) only renders when
  `isPremium && solarData?.forecast?.length > 0` (dashboard.tsx:416, 506); the
  `forecast` field on `SolarData` is only populated on premium API responses
  (`src/lib/api/openMeteo.ts:124-156`).
- Monthly Estimate Banner renders for free + premium when `wastedEnergy &&
  !isLoading` (dashboard.tsx:447); the upgrade button appears only inside it
  when `!isPremium` (dashboard.tsx:455).
- Cloud cover chip in the hero only renders when `cloudCover > 0`
  (dashboard.tsx:266) — does not distinguish "0% clouds" from "missing data".

## 2. Data Flow Map

### `usePremiumSolarData` (`src/hooks/usePremiumSolarData.ts:49`)
- **Inputs:** `lat`, `lng`, optional `roofAreaM2` / `electricityRate` /
  `yearlySavings` (passed through from `useGoogleSolar`'s `roofSummary`,
  dashboard.tsx:84).
- **Backing endpoint:** `GET /api/solar/irradiance?lat=&lng=`
  (`src/pages/api/solar/irradiance.ts:189`). Headers added by the fetcher:
  `X-Session-Token`, `X-Wallet-Address`, plus `X-Request-Premium: true`
  inside `initiatePayment` (usePremiumSolarData.ts:259-265).
- **SWR config:**
  - Key: `${baseUrl}&session=${activeAddress}&token=${sessionToken ? '1' : '0'}`
    (usePremiumSolarData.ts:120-124). Both wallet and token-presence are baked
    into the key so a fresh wallet/session triggers a refetch.
  - `refreshInterval: isPremium ? 0 : 300000` — free polls every 5 min, premium
    never auto-refreshes (usePremiumSolarData.ts:159).
  - `revalidateOnFocus: false`.
- **Outputs (return shape):**
  ```ts
  {
    solarData: SolarData | undefined,             // see types/solar.ts:13
    wastedEnergy: WastedEnergy | undefined,       // currentWatts, currentValue,
                                                  // todayValue, monthlyEstimate
    isLoading, isError, error,
    isPremium: boolean,                            // toggled true by either
                                                   // backend `premium` flag or
                                                   // successful payment
    isCached: boolean,                             // mirrors response.cached
    paymentRequired: X402PaymentRequired,          // dual-chain accepts[]
                                                   // (defaultPaymentRequired @ 87-113)
    showPaymentGate, setShowPaymentGate,
    initiatePayment: () => Promise<string|null>,   // payment orchestrator
    paymentState: { isPending, isSuccess, isError, error, txHash },
    refresh, upgradeToPremium,
    isWrongChain, switchToCorrectChain, isSwitchingChain,
    requiredChainName, activeChainType,
    preferredChain, setPreferredChain,
    getExplorerTxUrl, isConnected, signerReady,
    evmConnected, solConnected,
  }
  ```
- **Loading + error states the UI handles:**
  - `isLoading` → skeleton placeholders in hero, stats, charts (dashboard.tsx:247-251,
    334, 347, 359, 374, 493).
  - `isError` → red banner (dashboard.tsx:150-157) — no retry button on the banner;
    the manual `refresh` button is in the header card (dashboard.tsx:226-240).
  - `paymentState.isError/isPending/isSuccess` → `PaymentStatus` strip
    (dashboard.tsx:160-171) plus inline state inside `PaymentGate`.

### `useGoogleSolar` (`src/hooks/useGoogleSolar.ts:134`)
- **Inputs:** `lat`, `lng`.
- **Backing endpoint:** `GET /api/solar/building-insights?lat=&lng=`
  (`src/pages/api/solar/building-insights.ts:17`).
- **SWR config:** `revalidateOnFocus: false`,
  `revalidateOnReconnect: false`, `shouldRetryOnError: false`
  (useGoogleSolar.ts:144-149) — important because the API returns 404 with
  `success: false` for unsupported regions and we don't want SWR to retry.
- **Outputs:**
  ```ts
  {
    buildingInsights: BuildingInsights | undefined,  // raw Google Solar payload
    roofSummary: RoofSummary | undefined,            // see processRoofData @ 35
    isLoading, isError,
    error: string | undefined,
    isAvailable: boolean,                            // data.success === true
  }
  ```
- The SWR call uses the default global `fetcher` defined inline (line 22-25);
  there is no header injection or session awareness — the endpoint is open.

### `useMultiChainX402` (`src/hooks/useMultiChainX402.ts:14`)
- **Inputs:** none directly; reads `useX402()` (EVM) + `useX402Solana()` (SVM).
- **Outputs:** unified chain state — `activeChainType`, `activeSigner`,
  `activeAddress`, `isConnected`, `paymentState`+setter, `isWrongChain`,
  `switchToCorrectChain`, `requiredChainName`, `receiverAddress`,
  `x402FetchConfig` (svmConfig only on SVM, line 65-70), `getExplorerTxUrl`,
  per-chain `evm` and `sol` summaries.
- **Active-chain selection rule** (useMultiChainX402.ts:22-26):
  - If both wallets connected → user-controlled `preferredChain` (defaults to
    `'evm'`, line 19).
  - Else if only Solana connected → `'svm'`.
  - Else → `'evm'`.
- **Cache/SWR:** none — pure derived state from upstream wallet hooks.

### `useX402` (`src/hooks/useX402.ts:23`)
- **Inputs:** none; pulls from `wagmi` via `useAccount`, `useWalletClient`,
  `useSwitchChain`.
- **Outputs:** `paymentState`, `setPaymentState`, `resetPayment`, `isConnected`,
  `address`, `walletClient`, `isWrongChain` (true when `chainId !== requiredChain.id`
  — useX402.ts:29), `switchToCorrectChain`, `isSwitchingChain`,
  `requiredChainName`.
- `requiredChain` resolves at module load (useX402.ts:5) by checking
  `process.env.NEXT_PUBLIC_X402_NETWORK === 'base'` else `baseSepolia`.

### `useX402Solana` (`src/hooks/useX402Solana.ts:24`)
- **Inputs:** none; pulls `publicKey`, `signTransaction`, `wallet` from
  `@solana/wallet-adapter-react`, plus `connection` from `useConnection`.
- **Outputs:** `isConnected`, `address` (base58), `solSigner` (x402-compatible
  `TransactionPartialSigner` shim, useX402Solana.ts:36-104), `paymentState`,
  `setPaymentState`, `resetPayment`, `networkName`, `connection`, `walletName`.
- `solSigner.signTransactions` bridges v2 `@solana/kit` Transaction (which the
  facilitator hands to x402-fetch) → wire bytes → v1 `VersionedTransaction` →
  wallet-adapter `signTransaction` → extract signature back into a `Signature
  Dictionary` (useX402Solana.ts:42-103).

### `useLocation` (`src/hooks/useLocation.ts:14`)
- **Inputs:** none; thin wrapper over `useLocationContext` (`src/context/LocationContext.tsx:52`).
- **Outputs:** `location`, `isLoading`, `error`, `requestLocation`,
  `setManualLocation`, `clearLocation`.
- `requestLocation` calls `navigator.geolocation.getCurrentPosition` and reverse-geocodes
  via `GET /api/geocode/search?lat=&lng=&reverse=true` (useLocation.ts:43-54).
- Not used directly by `dashboard.tsx`; the page uses `useLocationContext`
  directly (dashboard.tsx:5, 27). `useLocation` is consumed by `LocationSearch.tsx:40`.

### Backing endpoints (server-side data shapes)

- `/api/solar/irradiance` (`src/pages/api/solar/irradiance.ts:189`):
  - 4-branch dispatch: (1) signed token session; (2) legacy wallet session
    fallback; (3) `X-PAYMENT` header → verify+settle via x402.org facilitator;
    (4) free tier when none of the above (irradiance.ts:213-393).
  - Free response → `fetchSolarData(coords)` (cached, narrow fields).
  - Premium response → `fetchSolarData(coords, { bypassCache: true, premium: true })`
    (irradiance.ts:401), adds `forecast`, per-hour `temperature` /
    `diffuseRadiation`, current `temperature` / `windSpeed` /
    `weatherCode`+`weatherDescription` / `diffuseRadiation` /
    `thermalEfficiency` (`src/lib/api/openMeteo.ts:86-156`).
  - Sets `X-SESSION-TOKEN` response header on premium grants
    (`src/lib/x402/session.ts:174`).

- `/api/solar/building-insights` (`src/pages/api/solar/building-insights.ts:17`):
  - Proxies Google Solar `buildingInsights:findClosest`. L1 Map +
    L2 Redis (24h TTL, `building:` prefix). Returns 404 with
    `error: "No building data available..."` when Google Solar has no
    coverage (line 78-83).

- `/api/solar/data-layers` (`src/pages/api/solar/data-layers.ts:232`):
  - **Note: not directly invoked from the dashboard.tsx import graph.** The
    `SunroofMap` component fetches its overlay via `useSunroofMap` (out of scope
    for this audit per Ty's file list, but the underlying endpoint is in scope).
  - Fetches Google Solar data layers + downloads two GeoTIFFs (annual flux +
    mask) → renders a colored PNG heatmap inline (data-layers.ts:124-230). L1
    Map + L2 Redis (24h, `datalayers:` prefix). Sets `responseLimit: '5mb'`.

## 3. Premium Gating Logic

Click path on the upgrade button (dashboard.tsx:458):

1. `upgradeToPremium()` (usePremiumSolarData.ts:374) flips
   `setShowPaymentGate(true)`. Modal overlay opens (dashboard.tsx:124-146).
2. User picks a chain in the modal — `PaymentGate` calls
   `onChainSelect(chain)` which is `setPreferredChain` from
   `useMultiChainX402` (PaymentGate.tsx:120-138, useMultiChainX402.ts:19).
3. User clicks "Pay $0.001 USDC" → `onPay()` → `initiatePayment()`
   (usePremiumSolarData.ts:190).
4. **Chain selection** (useMultiChainX402.ts:22-26):
   - When only one wallet is connected → that chain wins automatically.
   - When both are connected → `preferredChain` (the user toggle).
5. **Active signer + config** (useMultiChainX402.ts:31-70):
   - SVM → `activeSigner = sol.solSigner` (the `TransactionPartialSigner` shim)
     and `x402FetchConfig = { svmConfig: { rpcUrl: SOLANA_RPC_URL } }`.
   - EVM → `activeSigner = evm.walletClient` (wagmi WalletClient cast to x402's
     SignerWallet) and `x402FetchConfig = undefined`.
6. **402 dance** (usePremiumSolarData.ts:223-282):
   - The first call to `/api/solar/irradiance` carries `X-Request-Premium: true`
     and returns 402 with both EVM + SVM `accepts[]` (irradiance.ts:381-390).
   - **Critical chain-filter wrapper** (usePremiumSolarData.ts:223-250): the
     `chainFilteredFetch` strips out non-matching `accepts[]` entries before
     `wrapFetchWithPayment` sees them — prevents x402-fetch from feeding an EVM
     requirement to a Solana signer.
   - `wrapFetchWithPayment(chainFilteredFetch, activeSigner, undefined,
     undefined, x402FetchConfig)` retries with a signed `X-PAYMENT` header.
7. **Server verify + settle** (irradiance.ts:240-377):
   - SHA-256 hashes the payment header → `acquirePaymentReplayLock` (irradiance.ts:241-242,
     session.ts:179-181).
   - `decodePayment(paymentHeader)` (universal: auto-detects EVM vs SVM via
     `SupportedSVMNetworks`, irradiance.ts:252-255).
   - `findMatchingPaymentRequirements` → `facilitator.verify` →
     `facilitator.settle` against `https://x402.org/facilitator`
     (irradiance.ts:264-328).
   - `markPaymentConsumed(network, transaction)` → 7-day replay guard
     (session.ts:187-189).
   - `createX402Session({ payer, network, txHash })` (session.ts:100-125):
     - 30-minute lifetime (`SESSION_DURATION_MS = 30 * 60 * 1000`,
       session.ts:5).
     - Stored in L1 Map + L2 Redis under both `session:id:{uuid}` and
       `session:wallet:{normalizedAddress}` keys.
   - HMAC-SHA256 token returned via `X-SESSION-TOKEN` header
     (session.ts:51-56, 174-176; also written as `kn_session` HttpOnly
     cookie, line 176).
8. **Client persistence** (usePremiumSolarData.ts:141-147, 287-294):
   - Token stored in `localStorage` under `kn_x402_session_token` (constant at
     usePremiumSolarData.ts:47).
   - SWR cache injected with the premium response via `mutate(result, {
     revalidate: false })` (line 328) — no immediate refetch.
9. **State source of truth that the UI is "premium":**
   - `isPremium` local state inside `usePremiumSolarData` (line 56).
   - Set true by either: (a) the backend response carries `premium: true`
     (line 167-170 — covers session-restored loads after refresh), or (b)
     successful payment in `initiatePayment` (line 316).
   - Reset to false when `activeAddress` is falsy (line 173-177).

### x402 session token contents
`createToken` builds `{ sid: sessionId, exp: expires }` JSON →
`base64url(payload).sign(payload)` (session.ts:51-56). HMAC key:
`X402_SESSION_SECRET || CRON_SECRET || (dev fallback)` (session.ts:15).
Server-side `X402SessionRecord` (session.ts:21-28) keeps `sessionId`, `payer`,
`network`, `txHash`, `createdAt`, `expires`. Token only carries `sid + exp`;
the rest comes from Redis via `getSessionFromToken` (session.ts:127-144).

### Pricing source
The price string and description shown in `PaymentGate` come from
`X402_PRICING['/api/solar/irradiance']` in `src/lib/x402/config.ts:6-11`
(`'$0.001'`, `'Live solar data, hourly forecasts, 7-day predictions & roof
analysis'`). Read at `usePremiumSolarData.ts:82-84` and folded into the
`defaultPaymentRequired` object (line 87-113). The server side uses its own
hardcoded `'$0.001'` literal at `irradiance.ts:80, 107` rather than reading
this config — two sources of truth for the same number.

### Free vs premium response shape divergence

| Field | Free tier | Premium tier |
|---|---|---|
| `current.ghi` / `dni` / `cloudCover` / `isDay` | ✓ | ✓ |
| `current.weatherCode` / `weatherDescription` | ✗ | ✓ (openMeteo.ts:107-110) |
| `current.temperature` (°C) | ✗ | ✓ (openMeteo.ts:111-112) |
| `current.windSpeed` (m/s) | ✗ | ✓ (via premium current_units, openMeteo.ts) |
| `current.diffuseRadiation` | ✗ | ✓ (openMeteo.ts:118-122) |
| `current.thermalEfficiency` | ✗ | ✓ (computed inline, openMeteo.ts:114) |
| `hourly[i].time` / `ghi` / `dni` / `cloudCover` | ✓ | ✓ |
| `hourly[i].diffuseRadiation` | ✗ | ✓ (openMeteo.ts:86-88) |
| `hourly[i].temperature` (°C) | ✗ | ✓ (openMeteo.ts:89-91) |
| `daily.sunrise` / `sunset` | ✓ | ✓ |
| `forecast: DailyForecast[]` (7-day) | ✗ | ✓ (openMeteo.ts:124-156) |
| `cached: true/false` | true (300s TTL) | false (`bypassCache: true`) |

## 4. "Uncaptured Dollar Value" Calculation

End-to-end from `solarData.current.ghi` to the animated number on screen.

### Constants (`src/lib/calculations/solarValue.ts:7-22`)
- `DEFAULT_ELECTRICITY_PRICE = 0.16` ($/kWh, US national avg fallback)
- `PANEL_EFFICIENCY = 0.20` (typical residential silicon)
- `SYSTEM_LOSSES = 0.14` (inverter + wiring DC→AC)
- `DEFAULT_ROOF_M2 = 150` (used when no Google Solar data)
- `USABLE_ROOF_PERCENTAGE = 0.65` (when caller passed total area, not usable)
- `THERMAL_COEFFICIENT = 0.4` (%/°C above 25°C, cell-temp derating)

None are configurable at runtime — all module-local `const`. A second copy of
`DEFAULT_ELECTRICITY_RATE = 0.16` and `SYSTEM_LOSSES = 0.14` lives in
`src/hooks/useGoogleSolar.ts:6-7`.

### Hero number (`wastedEnergy.currentValue`)
Computed in `calculateWastedValue` (solarValue.ts:44-83). Inputs: current
`ghiWm2`, `areaM2` (default 150), `isUsableArea` flag, optional
`thermalEfficiency` (0-100), `electricityRate` (default 0.16).

```
usableArea (m²)            = isUsableArea ? areaM2 : areaM2 * 0.65
effectivePanelEff (0-1)    = thermalEfficiency != null
                              ? 0.20 * (thermalEfficiency / 100)
                              : 0.20
capturedKw                 = (ghiWm2 * usableArea * effectivePanelEff
                              * (1 - 0.14)) / 1000
currentValue ($/hr)        = capturedKw * electricityRate
currentWatts (W)           = capturedKw * 1000
```

This `currentValue` is the number rendered as `$<CountUp end={wastedEnergy.currentValue}
... duration={1}>/hr` (dashboard.tsx:258-260).

### "Today" stat (`wastedEnergy.todayValue`)
The dashboard calls `calculateWastedValueFromData` (solarValue.ts:89-127), not
the simpler helper above. It iterates `solarData.hourly` and sums per-hour
captured value, computing thermal efficiency from each hour's
`temperature` when present (line 105-114):

```
for each hour where ghi > 0 AND hour.time starts with currentDate:
   hourThermalEff = hour.temperature != null
                     ? computeThermalEfficiency(hour.temperature)   // 100 - (T-25)*0.4
                     : current.thermalEfficiency
   hourValue = calculateWastedValue(hour.ghi, areaM2, isUsableArea,
                                     hourThermalEff, electricityRate)
   todayTotal += hourValue.currentValue
```

`currentDate` filtering means hours from "tomorrow" in the rolling 24h window
are skipped (relies on `solarData.currentDate`).

### "Monthly potential" (`wastedEnergy.monthlyEstimate`)
Three different formulas can produce this number depending on what data is
available:

1. **Google Solar present** — `usePremiumSolarData.ts:185-187` overrides:
   `monthlyEstimate = Math.round(yearlySavings / 12)` (the `roofSummary.yearlySavings`
   computed by `useGoogleSolar.ts:79`).
2. **Hourly-data path** (`calculateWastedValueFromData`, solarValue.ts:118-119):
   `monthlyEstimate = todayTotal * 30 * 0.75`. The `0.75` is described as
   "weather variability and seasonal differences" (line 118).
3. **Fallback path** (`calculateWastedValue` simple helper, solarValue.ts:69-75):
   `monthlyEstimate = currentValue * 6 * 0.6 * 30 * 0.75`. The simple helper
   isn't called by the dashboard directly — only via the per-hour loop in (2)
   — so this branch only fires if `solarData.hourly` is empty.

### Animation
`react-countup` `<CountUp>` component (dashboard.tsx:17). Each metric:
- Hero: `<CountUp end={wastedEnergy.currentValue} decimals={2} duration={1}
  preserveValue />` (line 258)
- Today: `<CountUp end={wastedEnergy.todayValue} decimals={0} duration={1}
  preserveValue />` (line 351)
- Monthly: `<CountUp end={wastedEnergy.monthlyEstimate} separator=","
  duration={1.5} preserveValue />` (line 452)

`preserveValue` keeps the prior end value during refetches so the number
animates *from* the last value rather than reset to 0. Because
`refreshInterval = 300000` (free tier, usePremiumSolarData.ts:159), the
"current" number animates anew every 5 minutes; on premium it only re-animates
on manual `refresh()`.

## 5. Visual Inventory

| # | Element | What it shows | Library | JSX size | Mobile-aware? |
|---|---|---|---|---|---|
| 1 | No-location splash (dashboard.tsx:97-119) | Map pin icon + headline + `LocationSearch` | inline SVG | ~22 LOC | yes — full-page centered |
| 2 | Payment gate modal (dashboard.tsx:124-146 → `PaymentGate.tsx:28`) | Chain selector, USDC price, x402 explainer, pay button, success/error states | `@coinbase/onchainkit` (Wallet/ConnectWallet) + `@solana/wallet-adapter-react-ui` (WalletMultiButton) | 22 LOC dashboard wrapper, 343 LOC component | yes — `max-w-md` modal in a `p-4` overlay |
| 3 | Error banner (dashboard.tsx:150-157) | Red strip with icon + static text | inline SVG | ~8 LOC | flex-row text |
| 4 | `PaymentStatus` (dashboard.tsx:160-171 → `PaymentStatus.tsx:8`) | Pending/success/error pill with spinner or check | inline SVG + Tailwind spinner | ~12 LOC + 65 LOC component | yes |
| 5 | Tx-hash row (dashboard.tsx:174-186) | Mono-font tx hash → explorer link | none | ~13 LOC | yes — truncated to `max-w-[200px]` |
| 6 | Location card (dashboard.tsx:193-243) | Address/city, lat/lng, day/night dot, refresh button + `TierBadge` | inline SVG | ~52 LOC | yes — `flex-shrink-0` on icon, `truncate` heading |
| 7 | Hero "Uncaptured Value" (dashboard.tsx:246-291) | Big animated `$X.XX/hr`, irradiance label, optional cloud%, 0–1000 W/m² progress bar | `react-countup` | ~47 LOC | yes — `text-5xl sm:text-6xl lg:text-7xl` |
| 8 | Weather Context premium (dashboard.tsx:294-314) | Description, °C, m/s wind, optional thermal-efficiency chip | none | ~22 LOC | not explicitly responsive |
| 9 | Weather Context locked (dashboard.tsx:317-327) | Single "Premium" lock chip | `@heroicons` | ~12 LOC | n/a |
| 10 | Stats grid (dashboard.tsx:330-399) | Irradiance / Today / Peak / Direct-Diffuse | `react-countup` | ~71 LOC | yes — `grid-cols-2 sm:grid-cols-4` |
| 11 | `SolarCurve` (mobile @ 401-413; desktop @ 488-503; `SolarCurve.tsx:59`) | Apple Watch-style sun arc with horizon line, gradient fill, glowing sun dot, sunrise/sunset markers | hand-rolled SVG via `createSmoothPath` (`src/lib/utils/svgChartUtils.ts`) | 360 LOC component | yes — viewBox-based, scales to container; mobile+desktop split |
| 12 | `WeekForecast` (mobile @ 416-444; desktop @ 506-530; `WeekForecast.tsx:65`) | 7-day strip: weather icon, kWh/m², est-kWh — premium-only | inline SVG icons | 119 LOC | horizontal scroll (`overflow-x-auto`); mobile+desktop split with locked stubs |
| 13 | Monthly Estimate Banner (dashboard.tsx:447-482) | Big monthly $, upgrade CTA (when not premium), "?" tooltip | `react-countup` + inline SVG | ~37 LOC | yes — `flex-col sm:flex-row` |
| 14 | `SunroofMap` (dashboard.tsx:533-537 → `SunroofMap.tsx:39`) | 300px Google Maps satellite + flux PNG GroundOverlay + color legend | `@react-google-maps/api` (`GoogleMap`, `useLoadScript`) + native `google.maps.GroundOverlay` | 131 LOC | fixed 300px height |
| 15 | `RoofAnalysis` (dashboard.tsx:540-548 → `RoofAnalysis.tsx:10`) | 4-cell stat grid (area, panels, MWh/yr, $/yr), recommended-sizing note, best segment chip, carbon offset, imagery date | `react-countup` + inline SVG | 200 LOC (incl. skeleton + compact variants) | yes — `grid-cols-2` |
| 16 | Info footer (dashboard.tsx:553-559) | One-line assumption summary | none | ~8 LOC | wraps naturally |

## 6. Free vs Premium Feature Matrix

| Feature | Free Tier | Premium Tier | Where Gated |
|---|---|---|---|
| Current GHI / DNI / cloud cover / isDay | ✓ | ✓ | always present (`openMeteo.ts:transformResponse`) |
| Current temperature, wind speed, weather description | — | ✓ | `current.weatherDescription !== undefined` (dashboard.tsx:294); server emits only when `premium=true` (`openMeteo.ts:106-114`) |
| Thermal efficiency chip | — | ✓ | `isPremium && solarData.current.thermalEfficiency !== undefined && < 100` (dashboard.tsx:306) |
| Direct/diffuse split stat | — | ✓ | `isPremium && solarData?.current.diffuseRadiation !== undefined` (dashboard.tsx:370) |
| Hourly per-hour temperature (used in `todayTotal`) | — | ✓ | `hour.temperature !== undefined` branch in `calculateWastedValueFromData` (`solarValue.ts:109-111`) |
| `SolarCurve` (today's arc) | ✓ | ✓ | always — uses free hourly (dashboard.tsx:401-413, 488-503) |
| 7-day forecast (`WeekForecast`) | locked stub | ✓ | `isPremium && solarData?.forecast?.length > 0` (dashboard.tsx:416, 506); locked stub @ 432-444, 520-530 |
| `RoofAnalysis` (Google Solar) | ✓ | ✓ | not gated by payment — gated by `hasRoofData` (dashboard.tsx:540) |
| `SunroofMap` (flux heatmap) | ✓ | ✓ | not gated by payment — gated by `hasRoofData && location` (dashboard.tsx:533) |
| Auto-refresh cadence | 5 min (300000ms) | none | `refreshInterval: isPremium ? 0 : 300000` (`usePremiumSolarData.ts:159`) |
| Cache header | `cached: true` (300s) | `cached: false` (bypass) | `fetchSolarData(coords, { bypassCache: true, premium: true })` (`irradiance.ts:401`) |
| Tx hash + explorer link | — | ✓ | `isPremium && paymentState.txHash` (dashboard.tsx:174) |
| `TierBadge` Live vs Free/Cached | Free or Cached | Live | `PaymentStatus.tsx:67-83` |
| Monthly estimate source | hourly extrapolation OR Google-Solar override | same OR Google-Solar override | override at `usePremiumSolarData.ts:185-187` |
| 30-min session reuse (no repeat charge) | — | ✓ | `getSessionFromToken` / `getSessionFromWallet` short-circuits to `servePremiumData` (irradiance.ts:215-237) |

## 7. Issues & Smells

Observations only — no fixes proposed.

- **Dead `withX402` middleware.** `src/lib/x402/middleware.ts:60-95` ships a
  generic 402 wrapper with a "TODO: Add payment verification using x402 package"
  comment and trusts any non-empty `x-payment` header. The actual production
  handler at `src/pages/api/solar/irradiance.ts:189` does not use this
  middleware — it builds its 402 response inline and runs verify+settle
  itself. The middleware appears to be unused scaffolding.
- **Premium auto-refresh is disabled.** `usePremiumSolarData.ts:159` sets
  `refreshInterval: isPremium ? 0 : 300000`. After payment, premium data goes
  stale until the user manually clicks the refresh button. Free tier polls
  every 5 minutes.
- **Three different formulas for `monthlyEstimate`.** (a) `yearlySavings/12`
  when Google Solar is present (`usePremiumSolarData.ts:185-187`), (b)
  `todayTotal * 30 * 0.75` from hourly sum (`solarValue.ts:118-119`), (c)
  `currentValue * 6 * 0.6 * 30 * 0.75` in the simpler helper
  (`solarValue.ts:69-75`, dead path on dashboard but reachable elsewhere).
- **Duplicate constants across files.** `DEFAULT_ELECTRICITY_PRICE/RATE = 0.16`
  appears in both `src/lib/calculations/solarValue.ts:7` and
  `src/hooks/useGoogleSolar.ts:6`. Same for `SYSTEM_LOSSES = 0.14`
  (`solarValue.ts:13`, `useGoogleSolar.ts:7`). The MJ→kWh `/3.6` conversion is
  hardcoded both in `solarValue.ts:36` and inline in `WeekForecast.tsx:85`.
- **Hardcoded network labels in `PaymentGate`.** Buttons read "Base Sepolia"
  and "Solana Devnet" (`PaymentGate.tsx:127, 137`) regardless of
  `NEXT_PUBLIC_X402_NETWORK` / `NEXT_PUBLIC_SOLANA_NETWORK`. Mainnet flips
  would render incorrect labels.
- **Network-classification logic in 4 places.** The "is this Solana?" decision
  is repeated as `network.startsWith('solana')` in
  `usePremiumSolarData.ts:230-232`, `PaymentGate.tsx:48-50`, and
  `src/lib/x402/session.ts:33-35`, plus `SupportedSVMNetworks.includes(...)` in
  `irradiance.ts:167-169`. Four sources of truth with subtly different
  matchers.
- **`process.env.X402_RECEIVER_ADDRESS` vs `NEXT_PUBLIC_X402_RECEIVER_ADDRESS`.**
  `useMultiChainX402.ts:12` reads `NEXT_PUBLIC_X402_RECEIVER_ADDRESS`, while
  `irradiance.ts:37` requires the non-prefixed `X402_RECEIVER_ADDRESS` and
  throws at boot if missing. CLAUDE.md only documents the latter; the former is
  read but not documented. Same split for the Solana receiver address.
- **`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` vs `GOOGLE_MAPS_API_KEY`.** Server reads
  the unprefixed one (`building-insights.ts:9`, `data-layers.ts:13`); client
  reads the `NEXT_PUBLIC_*` variant (`SunroofMap.tsx:43`). Two separate keys
  must stay in sync.
- **`SESSION_SECRET` falls back to `CRON_SECRET`.** `session.ts:15` —
  `process.env.X402_SESSION_SECRET || process.env.CRON_SECRET || (...)`. CLAUDE.md
  documents `X402_SESSION_SECRET` as required in production; the silent
  fallback to `CRON_SECRET` means cron-secret rotation also rotates session
  signing keys (invalidating live sessions).
- **SWR-key regex strips only single-digit token marker.** Fetcher rebuilds the
  request URL via `.replace(/&token=[01]/g, '')` (`usePremiumSolarData.ts:131`).
  If the marker scheme ever uses anything other than `0`/`1` the strip
  silently fails, leaving the marker in the request to the server.
- **`mutate(result, { revalidate: false })` writes to the prior key.**
  `usePremiumSolarData.ts:289-294` calls `setSessionToken(nextToken)` (which
  rotates the SWR key, line 122) *before* `mutate(result, { revalidate: false })`
  (line 328). The `mutate` reference closes over the pre-rotation key, so the
  premium response is injected into the cache entry that's about to be orphaned.
  The next render's new key will trigger a fresh request.
- **`isPremium` reset hinges only on `activeAddress` falsiness.**
  `usePremiumSolarData.ts:173-177` flips `isPremium` back to false when
  `activeAddress` becomes falsy. A wallet *switch* (one address → another)
  briefly keeps `isPremium` true even though the new wallet has no session,
  until the next `data?.premium` check on a refetch.
- **Dashboard error banner has no inline retry.** `dashboard.tsx:150-157` shows
  a static red strip — the only retry path is the small refresh icon in the
  Location card header (line 226-240).
- **Payment modal lacks focus trap and Escape-to-close.** `dashboard.tsx:124-146`
  renders the gate as a fixed overlay with `z-50`. `PaymentGate.tsx` exposes a
  manual close button via `onCancel` (line 76-83) but neither traps focus
  within the modal nor binds Esc.
- **No error boundary above the dashboard tree.** A throw from `RoofAnalysis`
  on a malformed `roofSummary` would crash the page (no
  `<ErrorBoundary>` anywhere in the import graph).
- **`bestSegment` from empty array.** `RoofAnalysis.tsx:34-36` runs
  `segments.reduce((best, seg) => ..., segments[0])`; if `segments` is empty,
  `bestSegment` is `undefined` but the render guard at line 119 prevents the
  crash. Currently safe — would break if the guard were ever removed.
- **`useGoogleSolar` detects "no coverage" via substring match.**
  `useGoogleSolar.ts:159` — `!data?.error?.includes('No building data')`. The
  paired error string is at `building-insights.ts:81`. Any rewording
  desynchronizes the two and the dashboard would treat 404 as a generic error.
- **`L1` `Map` cache is unbounded.** `building-insights.ts:12` and
  `data-layers.ts:16` use a module-level `Map` with no eviction. PM2 worker
  uptime + traffic determines memory growth.
- **First `data-layers` render is heavy work in-handler.** The flux GeoTIFF →
  PNG render pipeline (`data-layers.ts:124-230`, plus the `applyBoxBlur`
  double-pass at line 58-109) runs synchronously on cache-miss inside the API
  handler. Cached for 24h, but cold start is O(width × height × passes).
- **Cloud-cover chip hides 0%.** `dashboard.tsx:266` — `cloudCover > 0` means
  truly clear sky displays *no* indicator at all (silently "no data").
- **`useEffect` deps suppression.** `dashboard.tsx:49-50` disables
  `react-hooks/exhaustive-deps` on the URL-sync effect; `router` is used inside
  but excluded from the dep array. Stale-closure risk if `router` changes mid
  render.
- **`useGoogleSolar` returns no `setLocation`-style invalidator.** When the
  user changes location, SWR re-fetches under the new key, but the prior
  `roofSummary` remains rendered until the new fetch completes (no
  `keepPreviousData`/loading-state coupling). The dashboard's `RoofAnalysis`
  briefly shows the prior city's roof while the new one loads.
- **`handleSelectResult` truncates display name.**
  `LocationSearch.tsx:143` — `setQuery(result.city || result.displayName.split(',')[0])`.
  `displayName.split(',')[0]` may chop off a city from the Nominatim payload
  unexpectedly when the first comma-component is just a street.
- **Wallet bridge serializes via wire bytes manually.** `useX402Solana.ts:67-83`
  builds the v1 wire format byte-by-byte (`[1 byte signers] + [64 bytes * N] +
  [message_bytes]`). Any future v2 transaction format change in `@solana/kit`
  silently breaks signing.
- **`x402` middleware comment is stale.** `src/lib/x402/middleware.ts:59-62` —
  "Note: Full payment verification requires the x402 package. This
  implementation provides the 402 response structure." — but `x402` IS
  installed and used by `irradiance.ts`. The comment + the unused middleware
  together mislead a reader looking for the gating code.

## 8. Open Questions for Ty

1. Is `refreshInterval: isPremium ? 0 : 300000` (`usePremiumSolarData.ts:159`)
   intentional? It means premium data never auto-refreshes — by design (avoid
   re-billing curiosity) or unintended?
2. The `withX402` / `withX402FreeTier` middleware in `src/lib/x402/middleware.ts`
   is unused by `irradiance.ts`. Is it a future migration target, a rollback
   safety net, or scaffolding to delete?
3. `monthlyEstimate` has three formulas (Google Solar `yearlySavings/12`, hourly
   `todayTotal*30*0.75`, fallback `currentValue*6*0.6*30*0.75`). Is the
   precedence (Google → hourly → simple) the intended behavior, and does the
   `0.75` "weather variability" dampener still match your calibration intent?
4. The chain-toggle in `PaymentGate.tsx:117-138` only renders when both EVM
   and Solana wallets are connected (`canToggle`). Single-wallet users see a
   static badge for the chain that auto-selected. Is that the intended UX, or
   should single-wallet users still see (greyed-out) the other chain to know
   it exists?
5. `SunroofMap` and `RoofAnalysis` are gated by `hasRoofData` only — they
   render for free-tier users. Was the original product intent that Google
   Solar roof analysis is *itself* free (because Google's rate limit, not the
   x402 gate, controls it), or should it eventually move behind x402?
