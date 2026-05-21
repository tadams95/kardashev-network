# Design state · Kardashev Network

Single-page reference snapshot. **Read this before proposing visual changes.**

Generated from code reads, not aspiration. If a section disagrees with a handoff
document in `docs/`, this doc wins — handoffs are point-in-time delivery
packages and go stale (see "Retired / dead code" below).

Snapshot date: **2026-05-20** · Generator: engineering Claude (Opus 4.7).

---

## Brand

- **Mark:** `<KardashevIcon />` — concentric SVG (filled core + 2 rings). Sizes
  `sm | md | lg`. `pulse` prop on loading states only; otherwise static.
- **Wordmark:** "Kardashev" in `font-display` (Inter / SF Pro Display).
- **Brand color:** amber (`#f59e0b` / `text-amber-400`). See "Amber budget"
  for usage rules — amber is rationed, not decorative.
- **Mood:** instrument panel, not marketing site. Dark soft-black surfaces,
  hairline white borders, mono numerals, no scrims or drop-shadows.
- **Tagline:** placeholder, not committed. ("Measuring what falls. Pricing
  what's missed." was floated in brand-floor handoff but unresolved.)

---

## Surface system

Tokens (defined in `tailwind.config.ts`, `theme.extend.colors.surface`):

| Token | Hex | Use |
|---|---|---|
| `surface-page` | `#070707` | Page background |
| `surface-card` | `#121212` | Everyday card (default variant) |
| `surface-hero` | `#1c1c1c` | Emphasized card — live data, big numbers |
| `surface-nested` | `#1a1a1a` | Sub-surface inside another card |

Borders are `white/[0.06]` (default) or `white/[0.1]` (nested-strong), **never
gray**. Hero variant is borderless — its raised fill carries the chrome.

Radius is `rounded-xl` (12px) across all card surfaces. Tighter elements use
the named tokens in `tailwind.config.ts`: `rounded-chip` (4px), `rounded-inner`
(8px), `rounded-card` (12px, same as `xl`).

### `<Card>` primitive (`src/components/Card.tsx`)

```tsx
<Card variant="default" />   // bg-surface-card, white/[0.06] border, p-5
<Card variant="hero" />       // bg-surface-hero, no border, p-6
<Card variant="nested" />     // bg-surface-nested, white/[0.1] border, p-3.5
```

Pass `noPadding` when the card has internal sections controlling their own
padding (e.g. WeatherHeroCard). Pass `as="section"` etc. for semantic tags.

**Adoption:** 12 files import `<Card>`. 31 `<Card>` usages total. Most use
the default variant (implicit). Hero variant: 2 sites. Nested variant: 6
sites. `noPadding`: 15 sites.

### `<SkelBar>` primitive (`src/components/SkelBar.tsx`)

```tsx
<SkelBar size="h-4 w-1/2" />  // soft-white pulse, rounded
```

Fill is `bg-white/[0.06]` so the pulse scales with the surface system. **Always
use this — never re-implement** `<div className="h-4 bg-gray-700/30 rounded
animate-pulse" />`. Adopted in 8 files.

**Sub-surfaces inside a card use `bg-surface-nested` (or `<Card variant="nested">`
where structurally a sub-card). Never raw `bg-gray-*` opacity grays.** Borders
inside cards are `white/[0.06]` (default) or `white/[0.1]` (dense content) — never
`gray-*`. The dashboard component tree (RoofAnalysis, WeekForecast, SunroofMap,
PaymentStatus) was migrated to this rule 2026-05-20.

---

## Type scale

Six semantic tokens (`tailwind.config.ts`, `theme.extend.fontSize`). Each ships
line-height and (where relevant) letter-spacing **baked in** — do NOT add
`leading-*` / `tracking-*` on top unless deliberately deviating.

| Token | Size | Line-height | Letter-spacing | Use |
|---|---|---|---|---|
| `text-micro` | 11px | 14px | +0.5px | Mono caps · SVG axis labels · badges · weight bars (WCAG floor) |
| `text-caption` | 12px | 18px | — | Metadata · sub-labels · eyebrow |
| `text-body` | 14px | 21px | — | Default · table rows · prose |
| `text-subhead` | 18px | 26px | — | Card titles · modal titles · wordmark |
| `text-headline` | 32px | 36px | −0.5px | Big numbers · hero metrics · price (use `font-mono`) |
| `text-display` | clamp(36→60px) | 1.05 | −1.5px | Marketing hero only |

**Rules:**
- **No raw Tailwind `text-xs/sm/lg/xl/…` in component code.** Use the tokens.
  (Default Tailwind utilities still resolve; convention is enforced by review.)
- **No bracket sizes** (`text-[8px]`, `text-[10px]`, …). The floor is `text-micro`.
- **Numerics use `font-mono`** — temperatures, prices, percentages, tickers.
- `text-micro` already carries +0.5px letter-spacing; don't stack `tracking-wider`
  on top (only add tracking for a deliberate deviation, e.g. footer stamp's
  `tracking-[0.2em]`).
- `text-display` is the only responsive token (clamp); it needs no `sm:/lg:`.

**History:** reconciled 2026-05-20. The repo previously had two scales — an
older Phase-1 rem scale (`display/headline/title/body/caption/micro`) and a
colliding handoff redefinition. Merged to the px scale above; `title` → `subhead`.

---

## Amber budget

> **Amber means "our call." Nothing else. Max 2 amber elements per card surface.**

Amber is reserved for **values Kardashev computed or claims**:

- Brand mark, wherever it appears
- Primary CTAs ("Explore the Dashboard", "Pay $X")
- Model probability cells, model forecast temperatures
- Forecast bracket left-border (the visual "this is our pick")
- Data lines in charts (temperature curve, GHI curve, source-weight bar fills)

**Active states, hover states, "today/now" emphasis, and metadata badges do
NOT get amber.** Use elevation + neutral tones instead. Replacement table:

| Old (deprecated) | New |
|---|---|
| `bg-amber-500/20 text-amber-400 border border-amber-500/30` (active pill) | `bg-white/[0.1] text-white` |
| `text-amber-500` active nav link | `text-white` + `after:` pseudo `bg-white/70` underline |
| `bg-amber-500/[0.08] border-amber-500/50 ring-1 ring-amber-500/20` (today chip) | `<Card variant="hero">` |
| `hover:text-amber-500` | `hover:text-white` or `hover:text-gray-300` |
| `text-amber-400 font-semibold` footer label | mono small-caps `text-[10px] uppercase tracking-wider text-gray-500 font-mono` |

**Current footprint** (live files only, excluding dead `MarketOpportunitiesTable`):
`text-amber-{400,500}`: 33 · `bg-amber-500/*`: 5 · `border-amber-{400,500}`: 7.
All explicitly targeted recipes are at zero hits.

---

## Hero composition

- Two columns at `lg+` (`lg:grid-cols-[1.1fr_1fr]`), stacked below.
- Centering frame `max-w-7xl mx-auto` — same as feature cards below and the
  footer in `Layout.tsx`. All three align vertically down the page.
- Height `min-h-screen` — feature cards live fully below the fold; scroll
  reveals them.
- Right column is `aspect-square w-full max-w-[640px]`. Inside:
  - R3F canvas wrapper with `absolute inset-[24%]` + radial mask. The 24%
    inset shrinks the rendered sun to ~45% of column diameter so the dial's
    Type I ring sits cleanly outside the sun's corona.
  - SVG `<KardashevDialOverlay />` on top, `pointer-events-none` so the sun's
    drag-to-rotate and cursor-deflection pass through to the canvas.

### KardashevDialOverlay geometry

ViewBox `-120 -120 240 240`. Ring radii **60 / 82 / 105** (ratio 1 : 1.37 : 1.75).
Tuned against R3F `camera.position.z=5`, `camera.fov=45`, `<SolarGlobe scale={1.8}>`.
**If any of those R3F params change, scale the three ring radii together.**

---

## Hard constraints

| Constraint | Why |
|---|---|
| **Do not touch `components/three/*`** | Shader code + interaction logic; brittle. Adjust the sun's apparent size via canvas wrapper inset (see hero composition), never via R3F. |
| **`KardashevIcon` motion: static by default; `pulse` only on loading states** | Brand mark must read as solid, not animated. |
| **No drop-shadows or scrims for text-on-image readability** | Solved structurally by the two-column hero layout. Adding them back is a regression. |
| **Amber budget ≤ 2 elements per card surface** | See "Amber budget." |
| **All card surfaces `rounded-xl`** | Consistency; the `<Card>` primitive enforces. |
| **Geist Mono for numerics, Inter for prose** | Mixed typography signals data vs narrative. |

---

## Conventions

- **Type sizes:** use the six semantic tokens (see "Type scale"), never raw
  `text-xs/sm/lg/xl/…` or bracket sizes in component code.
- **Numbers, tickers, percentages:** `font-mono` (Geist Mono stack). Applied
  to forecast temps, hero metrics, prices, consensus values as of 2026-05-20.
- **Prose, headlines:** `font-display` or default (Inter stack).
- **Skeletons:** `<SkelBar />`, never bespoke `animate-pulse` divs.
- **Surfaces:** `<Card variant="…">`, never raw `bg-black/40 border …`.
- **Active state:** elevation step (e.g. `variant="hero"`) + `text-white` —
  not color shift.
- **Borders:** `white/[0.06]` default, `white/[0.1]` for nested-strong,
  `white/[0.15]` for active emphasis. Never gray.
- **Hover on inactive controls:** `text-gray-300` or `text-white`, opacity
  steps over color shifts.

---

## Migration state

| Migration | Status | Notes |
|---|---|---|
| Surface system (3-tier tokens + `<Card>`) | **Merged** | 4 commits, 2026-05-19. `<Card>` in 12 files; `<SkelBar>` in 6. Dashboard page migrated to `surface-*` tokens via class swaps 2026-05-20 (hero metric → `surface-hero`, cards → `surface-card`, lock/buttons → `surface-nested`); still raw `<section>`, not `<Card>` — convert if revisited. |
| Brand floor (`<KardashevIcon>` v2 Anchor, F2 footer, `bg-surface-page`) | **Merged** | Bundled into surface system Commit A (`ec4a8f0`). Old `Footer.tsx` deleted. |
| Hero L1 (two-column, dial overlay, centering frame) | **Merged** | 6 commits, 2026-05-20. Pre-existing scrim/drop-shadow recipe removed. |
| Amber budget | **Merged** (live targets) | 3 commits, 2026-05-20. Dead-code targets skipped. |
| Type scale (six semantic tokens) | **Merged** (components) | 4 commits, 2026-05-20. All weather components, hero, Layout footer, PaymentGate, WalletSelector, CitySelector migrated. Pages still pending (see follow-ups). |
| SolarMeter retirement | **Merged** | 2026-05-20. Deleted orphaned `SolarMeter.tsx`. The `SolarValueCard` bell-curve replacement (handoff in `docs/solar-retirement/`) was **not** adopted — no inherited call site; ships type-scale violations (bracket sizes, 9px labels); adoption deferred as a net-new decision. |

**Handoff folders:** `docs/amber-budget/` and `docs/type-scale/` remain in tree
(untracked). Surface-system, brand-floor, and hero-l1 handoff packages were
removed after implementation — DESIGN_STATE.md replaces them as the durable
reference.

---

## Retired / dead code (still in tree, do not migrate)

| File | Status | Why |
|---|---|---|
| `src/components/weather/MarketOpportunitiesTable.tsx` | **Dead** — 0 imports | Sweet Spot retirement 2026-05-02 (commit `88fcd3e`). Contains 2 `bg-amber-500/20…` active-pill recipes; do not "fix" them. |
| ~~`src/components/SolarMeter.tsx`~~ | **DELETED 2026-05-20** | Was already orphaned (0 references). Removed. `SolarValueCard` (bell-curve) handoff exists in `docs/solar-retirement/` but was NOT adopted — it has no inherited call site; adoption is a separate net-new decision (candidate slot: dashboard GHI display). |
| `globals.css` legacy classes: `.glow-amber`, `.glow-yellow`, `.glow-solar*`, `.glass-*`, `.card-dark*`, `.gradient-text*` | **Mostly dead** | Pre-surface-system. Spot-check before referencing; many are orphaned. |
| `.animate-spin-slow`, `.animate-spin-reverse` (tailwind.config.ts) | Possibly orphaned | Flagged for cleanup after surface migration. Verify before deleting. |

---

## Known follow-ups

| Item | Surface | Status |
|---|---|---|
| `HeroSection.tsx` feature card icons still use old amber recipe (`bg-amber-900/30 border-amber-700/30`) | Hero below-fold | **Within amber budget** (1 amber per card). Leave unless redesigning. |
| `ConsensusMetrics.tsx:72` hardcoded `85.9%` accuracy figure | Weather data | Numeric should be data-driven; flagged for replacement. |
| Mobile-menu wordmark lockup | Brand | Doesn't yet match new KardashevIcon Anchor. |
| Tagline placeholder | Brand | Not committed. Brand-floor handoff floated copy but unresolved. |
| `LocationSearch`, `CitySelector`, `PaymentGate` | Various | Out-of-scope for surface migration "second pass"; verify they still use old recipes. |
| Surface-detail second-pass amber audit | `PaymentStatus`, `LocationSearch`, `WeatherIcon`, `CitySelector`, `SignalsDisclaimer`, `WeekForecast`, `RoofAnalysis`, `SolarCurve`, `SunroofMap` | Not in amber-budget handoff scope. Inspect when touching these files. |
| Type scale — **pages** still on raw Tailwind | `trading-readiness.tsx` (~60 sites), `api-docs.tsx` (~52), `about.tsx` (~12), `weather-forecast.tsx` (~4), `_error.tsx` (~2) | Type-scale handoff scoped components only. Pages are a follow-up migration; trading-readiness is an internal audit page (lower priority). |
| `dashboard.tsx:362` uses `text-display` for a `$` metric | Dashboard | Per the new scale, `display` = marketing hero only; a dollar value should be `text-headline`. Left as-is — needs a visual check before changing (display shrank clamp 48-72→36-60 in the reconcile). |
| `SolarMeter.tsx` (~6 raw text sites) | Data viz | Flagged for retirement; don't migrate unless retirement is deferred. |
| Segmented-control grays: `WalletSelector` tabs (lines 78/85/200), `PaymentGate` chain-toggle track (178) | Controls | Still `bg-gray-*`. NOT sub-surfaces — they're active-state segmented controls. Need the active-state treatment (track → `surface-nested`, active → `white/[0.1]`), not a naive surface swap. Deferred from the 2026-05-20 deep surface pass. |
| `RoofAnalysis` quality badge (HIGH/MED/LOW) | Roof card | Uses amber/yellow/gray as a semantic 3-level scale (like edge-intensity tiers). Kept colored intentionally. Revisit only if the amber budget should exclude data-quality indicators. |

---

## How to keep this doc alive

Every PR touching a design surface should update this doc — usually 1–2 lines.
Specifically:
- New token / variant → add to "Surface system."
- Component migrated to `<Card>` → bump count in "Migration state."
- Retired component → move from "Known follow-ups" to "Retired."
- New rule established → add to "Conventions" or "Hard constraints."

If you're an AI reading this cold: verify counts and file paths still match
reality before quoting them. Discrepancy = doc is stale; flag it.

---

## Appendix · Domain glossary

Reference-only. Skim when you hit an unfamiliar term.

- **METAR** — Hourly airport weather observation (ICAO airport codes).
  Source for some forecast data; no longer used as ground truth for accuracy
  scoring.
- **NWS** — US National Weather Service. Highest-accuracy forecast source
  (MAE 1.75°F clean-era).
- **Open-Meteo / AccuWeather / Tomorrow.io / Google Weather** — Other forecast
  sources, weighted in the ensemble.
- **ECMWF** — European weather model. Referenced occasionally in docs; not a
  live source.
- **Kalshi** — Prediction market platform. Weather markets settle on next-day
  temperature ranges (brackets).
- **x402** — Micropayment protocol over HTTP 402 responses. EVM (Base) +
  Solana (devnet) supported. Used for premium solar data.
- **Kardashev (Type I / II / III)** — Civilization scale by energy harnessing
  capacity (planetary / stellar / galactic). Brand namesake; rendered as the
  dial overlay's three rings.
- **BMA** — Bayesian Model Averaging. The current probability model for
  Kalshi brackets. In maintenance mode (deprecation scheduled ~2026-06).
- **Bracket / inner bracket / threshold bracket** — Kalshi market structure.
  Inner brackets are mid-range ("65°-69°"); threshold brackets are
  open-ended ("above 90°", "below 30°").
- **Tail-sell** — The currently-profitable trading strategy. Sell YES on
  brackets ≥6°F from forecast at low prices (5-15¢), collect premium when
  they expire worthless. ~97% win rate by construction.
- **Four-quadrant framework** — Tail-sell variants: HIGH cold-tail (LIVE),
  HIGH hot-tail (paper), LOW warm-tail (paper), LOW cold-tail (paper).
- **Forecast bracket** — The Kalshi bracket containing Kardashev's predicted
  temperature. Gets an amber left-border on row UI.
- **Sweet Spot** — Retired 2026-05-02. A combined-criteria signal filter for
  inner brackets that turned out unprofitable.
- **Brier Score / BSS** — Probability-calibration metric. Lower Brier = better
  calibrated; positive BSS = beats baseline.
- **EV** — Expected Value per $1 stake. Positive EV = profitable in expectation.
- **Calibration** — Re-mapping raw model probabilities to historical
  realization rates. Re-trained periodically from resolved markets.
- **Phase 0 / Phase 1 / Item B** — Internal milestone names for atmospheric
  feature ingestion and BMA refit experiments. See `docs/working-checklist.md`
  for current status.
- **"WE ARE HERE"** — Locator dot on the Kardashev dial's Type I ring,
  marking humanity's current civilization scale.
