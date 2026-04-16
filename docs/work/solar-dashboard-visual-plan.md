# Solar Dashboard — Visual & Design Work Plan

Companion to the read-only audit at `docs/solar-dashboard-audit.md`. This is
work stream 1 of 3 coming out of that audit. Streams 2 (payment UX) and 3
(payment-path hardening) are tracked separately and are out of scope here.

This document is a checklist Ty works through across multiple sessions. Each
item should be small enough to land in one sitting.

## 1. Goals

- The hero "$X.XX/hr" number is the unambiguous focal point on a 1440p monitor
  at normal viewing distance. No adjacent element matches its visual weight.
- A free-tier visitor who has never heard of this product understands what it
  shows within ~3 seconds of landing on `/dashboard`.
- The mobile experience is a deliberately ordered top-to-bottom scroll, not a
  desktop layout collapsed by media queries.
- Every card on the page belongs to one shared visual system: same padding
  scale, same radius scale, same typographic scale. No arbitrary
  `text-[Npx]` or `p-N` choices.
- The locked-premium vocabulary is consistent everywhere it appears, not the
  current four-different-treatments situation.

## 2. Design Principles

- **"Making the invisible visible" → numbers, not adjectives.** When in doubt,
  show a real measurement (W/m², kWh, $/hr) over a qualitative label. The
  product's value is that the data is real.
- **The free tier is the product, not the upsell trap.** Free-tier visitors
  must feel they got something complete, not a bait-and-switch demo. Locked
  premium elements are honest about what they are — never broken-looking.
- **Premium reveals data, not chrome.** Premium-tier additions appear inside
  the same card system as free-tier elements; the only difference is more
  data densely packed in. Don't change the visual language between tiers.
- **Motion is data, not decoration.** `react-countup` animates because the
  number actually changes. Skeleton-pulse exists because data is loading.
  Don't add motion that doesn't carry information.
- **Dark-only is the language.** No light-mode adaptation today — commit to it
  and stop hedging with neutral grays. Pick a deliberate amber-on-near-black
  palette and apply it ruthlessly.
- **Mobile is the default; desktop is the layout enhancement.** Design every
  element for thumb scroll first, then add desktop grid affordances.

## 3. Work Items — Checklist Format

Group order is not execution order — see section 6 for sequencing.

### 3.1 Hero & Focal Point

- [ ] **Lift the hero so it dominates the page**
      File: `src/pages/dashboard.tsx:246-291`
      What: Increase hero card padding, raise the `$X.XX/hr` number to the next
      type-scale step, reduce border weight and surrounding decoration.
      Why: Audit visual inventory shows the hero competes with the location
      card, the stats grid, and the monthly banner for attention.
      Done when: A first-time visitor's eye lands on the hero number before
      anything else, on both 1440p desktop and a phone in hand.

- [ ] **Tie the 0–1000 W/m² progress bar visually to the hero number**
      File: `src/pages/dashboard.tsx:277-288`
      What: Reduce `mt-6`, match the bar width to the number's bounding box,
      or replace with a concentric arc that wraps the number.
      Why: The bar currently reads as a separate widget below the hero,
      disconnecting "this is the dollar value" from "this is how much
      sunlight you're getting right now".
      Done when: Hero block reads as one visual unit; the bar's role as the
      irradiance gauge for the displayed number is obvious without text.

- [ ] **Resolve cloud-cover chip 0% case**
      File: `src/pages/dashboard.tsx:266-273`
      What: Either always render the chip (with a deliberate "clear sky"
      treatment when `cloudCover === 0`) or remove it from the hero entirely.
      Why: Audit flagged `cloudCover > 0` as silently hiding the chip — a
      true 0% reading is visually identical to data-missing.
      Done when: Clear-sky and data-missing states are visually distinct.

- [ ] **Make the hero skeleton match the loaded hero footprint**
      File: `src/pages/dashboard.tsx:247-251`
      What: Replace the 20×48 gray block with a skeleton that mirrors the new
      hero's number + label + bar layout.
      Why: Current skeleton is roughly half the height of the loaded hero —
      the page jumps when data arrives.
      Done when: No vertical reflow on hero data arrival.

### 3.2 Location Card

- [ ] **De-emphasize lat/lng coordinates for free tier**
      File: `src/pages/dashboard.tsx:212-214`
      What: Demote the monospace coordinate string — smaller font, hover-only,
      or move to a tooltip on the address.
      Why: Geek-noise for the 95% audience. The address line above already
      answers "where". (See open question on whether coordinates should
      survive at all.)
      Done when: Address is the visible primary identifier; coordinates are
      reachable but not prominent.

- [ ] **Reposition `TierBadge` so it doesn't sit inside the address title**
      File: `src/pages/dashboard.tsx:206-210`
      File: `src/components/PaymentStatus.tsx:67-83`
      What: Move `TierBadge` out of the `<h1>` flex row. Place it as a corner
      badge on the location card, or in the page header near `WalletSelector`.
      Why: Currently a small chip sandwiched against address text — easy to
      miss, and long addresses wrap awkwardly around it.
      Done when: `TierBadge` has a deliberate fixed position that doesn't
      compete with the address typography.

- [ ] **Connect the refresh button to the data, not the card chrome**
      File: `src/pages/dashboard.tsx:226-240`
      What: Move the refresh icon next to `TierBadge`, or pair it with a
      "last updated XXs ago" timestamp so the affordance has context.
      Why: Refresh sits in the location card today, which has nothing to do
      with refresh semantics — it's the global data refresh.
      Done when: A user who wants to manually refresh finds the control
      without scanning the whole page.

### 3.3 Stats Grid

- [ ] **Lock in a stable column count for the stats row**
      File: `src/pages/dashboard.tsx:330`
      What: Currently `grid-cols-2 sm:grid-cols-4` when `solarData` is
      truthy, `grid-cols-3` otherwise. Pick one column count for the loaded
      state and skeleton at the same dimensions.
      Why: The 3 ↔ 4 column shift on data load is a visible relayout; the
      `grid-cols-3` branch may be unreachable in practice (the locked
      Direct/Diffuse stub at 390-398 makes free tier always 4-up).
      Done when: Stats grid columns are stable from load → free → premium.

- [ ] **Resolve the Direct/Diffuse locked stub treatment**
      File: `src/pages/dashboard.tsx:390-398`
      What: Either drop to a 3-up grid for free tier (remove the stub), or
      replace the dead `--` with a designed locked-card preview.
      Why: `--` reads as broken/missing data, not as gated content. (See
      open question — coordinates with the larger locked-vocabulary
      decision in 3.5.)
      Done when: Free-tier visitor immediately reads the cell as either
      "not a feature" or "a paid feature" — never as broken.

### 3.4 SolarCurve (Hero Chart)

- [ ] **Annotate the peak point on the curve itself**
      File: `src/components/SolarCurve.tsx:307-313`
      What: When peak GHI clears a meaningful threshold, render a "Peak"
      label on the curve at the peak point, not just in the summary row
      below the chart.
      Why: The chart shows a beautiful arc but the user has to read the
      summary text to identify where the peak is. The chart has space.
      Done when: Peak point is visually labeled on the curve when above a
      threshold; redundant duplication with the summary row is intentional.

- [ ] **Polish the "Tomorrow" badge state**
      File: `src/components/SolarCurve.tsx:189-196`
      What: When the chart shifts to tomorrow's data after sunset, integrate
      the badge into the chart header or the section header at
      `dashboard.tsx:491` — not the current standalone flex row above.
      Why: The arc itself is the most polished visual on the page; the
      badge currently feels bolted on.
      Done when: "Showing tomorrow" reads as a deliberate variant of the
      chart, not a stuck-on label.

### 3.5 Locked Premium Stubs

- [ ] **Pick and apply one locked-state visual language**
      File: `src/pages/dashboard.tsx:317-327`, `390-398`, `432-444`, `520-530`
      What: Today there are four different "locked" treatments — one-line
      "Premium" label (Weather Context), `--` placeholder (Direct/Diffuse),
      header-only stub (mobile + desktop WeekForecast). Pick one approach
      (blurred preview / lock-card / removed-entirely) and apply uniformly.
      Why: Inconsistent locked-state vocabulary muddies the upgrade story.
      The locked WeekForecast in particular shows just a header bar — no
      hint of what would appear on upgrade.
      Done when: Every locked element on the free-tier dashboard uses the
      same visual pattern with the same upgrade affordance.

### 3.6 WeekForecast (7-Day Strip)

- [ ] **Visually emphasize the brightest day in the strip**
      File: `src/components/WeekForecast.tsx:74-95`
      What: Apply emphasis (border, glow, scale, color) to the day with the
      highest `radiationSum` — the "your best solar day this week" insight.
      Why: All seven cards look identical except for content. The strip
      carries seven numbers but conveys no narrative without reading them.
      Done when: The brightest forecast day is distinguishable at a glance,
      without reading numbers.

- [ ] **Replace inline weather SVGs with an expressive icon set**
      File: `src/components/WeekForecast.tsx:5-52`
      What: Six monotone hand-rolled SVGs today. Either swap to a richer
      library or color-code stroke by solar quality.
      Why: In a strip whose only differentiation is icon + numbers, the
      icon needs to do more work than "what's the weather".
      Done when: Each forecast day's icon meaningfully reflects solar
      quality, not just precipitation type.

### 3.7 RoofAnalysis Block

- [ ] **Promote "Best Roof Section" higher in the visual flow**
      File: `src/components/RoofAnalysis.tsx:118-134`
      What: Currently rendered below the 4-cell stats grid + sizing note.
      Move it to the top of the card, immediately after the title row.
      Why: It carries the "you should put panels here" judgment — the
      single most actionable insight in the whole component.
      Done when: Best-segment chip appears at or near the top of the card.

- [ ] **Compress the imagery date footer**
      File: `src/components/RoofAnalysis.tsx:151-154`
      What: "Imagery from {date} • Data powered by Google Solar API" gets a
      full text row today. Move to a hover tooltip on the "Google Solar"
      header badge or shrink to micro-text.
      Why: Card real estate is finite; this footer never changes user
      behavior.
      Done when: Date + attribution remain discoverable but don't occupy a
      full row by default.

### 3.8 SunroofMap

- [ ] **Add numeric anchors to the color legend**
      File: `src/components/SunroofMap.tsx:114-127`
      What: Legend strip is a thin gradient with "Low" / "High" labels. Add
      kWh/m²/year values at the endpoints from the actual flux range.
      Why: Without numbers, the heatmap is "pretty colors on a roof"
      rather than a data tool a user can read absolute values from.
      Done when: A user can read approximate flux at any point on the roof
      from the legend alone.

- [ ] **Reconsider the zoom-20 lock**
      File: `src/components/SunroofMap.tsx:109`
      What: Map opens at zoom 20 (very tight) with no explicit zoom-out
      affordance. Lower default zoom or surface zoom controls.
      Why: Users often want their roof in the context of property/street;
      zoom 20 frames just the rooftop.
      Done when: Default zoom shows the building plus immediate
      surroundings, OR zoom-out is unmistakably available.

### 3.9 Monthly Estimate Banner

- [ ] **Promote the monthly number as the conversion moment**
      File: `src/pages/dashboard.tsx:447-482`
      What: This banner carries the "$X/year you could capture" punch.
      Currently a horizontal banner near the bottom of the left column.
      Treat it as the primary conversion surface — bigger number, more
      breathing room, more deliberate placement.
      Why: Audit identified the monthly estimate has three different
      formula paths — whichever fires, this number drives upgrade intent.
      Done when: Monthly number is the second-most-prominent element on
      the page (after the hero `/hr` number).

- [ ] **Improve the "?" tooltip discoverability**
      File: `src/pages/dashboard.tsx:466-478`
      What: The question-mark button explains x402 micropayments. Currently
      a 24×24 circle next to the upgrade CTA. Replace with an inline copy
      line, an obvious "What is premium?" link, or pair the icon with
      copy.
      Why: A 24px circle next to a yellow CTA never wins attention; users
      who don't know what x402 is also don't think to hover a question
      mark.
      Done when: A first-time visitor unfamiliar with x402 finds an
      explanation without discovering the question mark.

### 3.10 Mobile vs Desktop

- [ ] **Consolidate the duplicated SolarCurve + WeekForecast renders**
      File: `src/pages/dashboard.tsx:401-444` (mobile blocks)
      File: `src/pages/dashboard.tsx:488-530` (desktop blocks)
      What: Two near-identical render blocks gated by `lg:hidden` /
      `hidden lg:block`. Restructure so each component renders exactly
      once and CSS (grid template areas, order utilities) handles
      placement.
      Why: Source-of-truth duplication. Every visual change has to land
      in two places — easy to drift.
      Done when: SolarCurve and WeekForecast each appear exactly once in
      JSX; layout differences are CSS-only.

- [ ] **Audit and fix the mobile column order**
      File: `src/pages/dashboard.tsx:189-549`
      What: Mobile stacks left-column-then-right-column. Verify the
      resulting top-down order matches priority for thumb scroll: hero →
      day curve → forecast → roof — locked stubs pushed below fold.
      Why: Today the order interleaves locked premium stubs in the middle
      of the free-tier scroll.
      Done when: First mobile scroll surfaces the hero, then current
      irradiance, then the day's curve. Locked stubs live below the fold.

### 3.11 Loading & Skeleton States

- [ ] **Match every skeleton to its loaded counterpart's dimensions**
      File: `src/pages/dashboard.tsx` (multiple inline)
      File: `src/components/SolarCurve.tsx:327-359`
      File: `src/components/RoofAnalysis.tsx:159-177`
      File: `src/components/WeekForecast.tsx:101-118`
      File: `src/components/SunroofMap.tsx:26-37`
      What: Walk every skeleton, compare loaded element dimensions, eliminate
      vertical jump on data arrival.
      Why: Hero, stats, and roof skeletons currently mix sizes — page
      reflows during load.
      Done when: No vertical jump anywhere on the page during
      loading → loaded transition.

- [ ] **Sequence skeletons to feel choreographed**
      File: `src/pages/dashboard.tsx` (page-level `isLoading` + `isRoofLoading`)
      What: Solar data and Google Solar load independently. Design the
      staggered reveal — e.g., hero first, then secondary stats, then
      roof block — so partial-load states feel intentional.
      Why: Uncoordinated load order reads as broken; a deliberate sequence
      reads as polish.
      Done when: Loading sequence reads as choreographed regardless of
      which API responds first.

### 3.12 Empty & Error States

- [ ] **Redesign the no-location splash to be inviting, not utilitarian**
      File: `src/pages/dashboard.tsx:97-119`
      What: Today: icon + h1 + paragraph + `LocationSearch` in a centered
      card. Add example/popular cities, raise the geolocate-now affordance,
      and tease what the dashboard will show.
      Why: This is the first screen for any visitor without a saved
      location — currently reads like a setup form, not a teaser.
      Done when: A first-time visitor understands what they'll see after
      entering a location, before they enter one.

- [ ] **Improve the error banner's visual treatment**
      File: `src/pages/dashboard.tsx:150-157`
      What: Static red strip. Add icon + heading + body structure;
      soften the tone from "Failed to load solar data. Please try again."
      to a designed error surface. (Retry behavior is out of scope —
      visual only.)
      Why: Errors are rare but high-friction; they deserve more design
      attention than the current fallback string.
      Done when: Error state feels like a deliberate UI surface, not a
      fallback string.

### 3.13 Typography & Spacing System

- [ ] **Define a typographic scale and migrate to it**
      File: `src/pages/dashboard.tsx` (page-wide)
      File: `src/components/*` (all in scope)
      What: Audit every `text-xs/sm/base/lg/xl/2xl/5xl/6xl/7xl` and
      `text-[10px]/[11px]/[9px]` usage. Define ~6 named scale tokens
      (display / headline / title / body / caption / micro) and migrate.
      Why: Audit visual inventory revealed inconsistent typography across
      the page — micro-labels at 9, 10, and 11 px appear arbitrarily.
      Done when: Every text element on the dashboard maps to a named
      scale token; no arbitrary `text-[Npx]` remains.

- [ ] **Define a section padding + radius system**
      File: `src/pages/dashboard.tsx` (page-wide)
      File: `src/components/*` (all in scope)
      What: Section padding currently mixes `p-4 sm:p-5`, `p-4 sm:p-6`,
      `p-3 sm:p-4`. Border radius mixes `rounded-lg`, `rounded-xl`,
      `rounded-2xl`, `rounded-full`. Define a system and apply.
      Why: Inconsistent spacing/radius is why peer cards "feel different"
      even when they're conceptually peers.
      Done when: Every card on the dashboard uses one of N defined padding
      scales and one of M defined radius scales.

## 4. Open Design Questions

1. **Locked-state visual language** — for items 3.5 + 3.3 + 3.6, which
   approach: (a) blurred preview of the actual premium data, (b) designed
   lock-card (icon + label + upgrade affordance, no preview), or
   (c) remove the locked element entirely from free tier? Pick one before
   work begins on the four locked surfaces; otherwise the system can't
   converge.
2. **Free-tier hero metric** — keep `$X.XX/hr` as the primary number, or
   pivot to "$X today" / "$X this month" as the headline? The /hr framing
   is honest but small; the today/month framing is more emotionally
   resonant but mixes calculations (audit notes three formula paths for
   monthly).
3. **Lat/lng coordinates** — drop entirely from free tier (cleaner), or
   keep as a credibility signal that says "this is real geographic data"?
4. **Direct/Diffuse stub** — coordinates with #1 above. If the locked
   vocabulary is "remove entirely", this becomes a 3-up grid; if it's
   "designed lock-card", this stays as 4-up. Need #1 first.
5. **Free-tier `RoofAnalysis` and `SunroofMap` placement** — these are
   not gated by x402 today (they render for free users when Google Solar
   has coverage). Should they be the page's secondary attraction (right
   column on desktop, prominent on mobile), or is that overweight for a
   non-paying visitor?

## 5. Out of Scope (Explicit)

This work stream will NOT touch:

- `PaymentGate` modal internals (chain selector buttons, USDC price card,
  pay button states, success/error treatments inside the modal). That's
  work stream 2.
- `usePremiumSolarData` state logic — `isPremium` flip, wallet-switch
  reset, mutate-key rotation, session token persistence. That's work
  stream 2.
- x402 price-source consistency, the chain-filter wrapper, session
  HMAC handling, replay locks. That's work stream 3.
- Weather Forecast / Weather Analytics / Trading Readiness pages and any
  of their components/hooks/APIs.
- API routes (`/api/solar/*`, `/api/weather/*`, `/api/kalshi/*`).
- Free-tier vs premium response-shape changes on the server — this work
  stream consumes whatever the server returns.

## 6. Sequence Recommendation

**Phase 1 — Establish visual language (items 3.13).** Land the type scale
and padding/radius system *first*, before touching individual components.
Doing this last would force every subsequent item to be revisited.

**Phase 2 — Hero + focal hierarchy (items 3.1, 3.9).** With the system in
place, lift the hero and promote the monthly banner. Establishes the
visual weight ladder for everything that follows.

**Phase 3 — Locked-state decision (item 3.5, then 3.3 stub resolution).**
Resolve open question #1 before touching the four locked surfaces.
Implement once, apply uniformly.

**Phase 4 — Per-component polish (items 3.2, 3.4, 3.6, 3.7, 3.8).** Each
component on its own session — independent and parallelizable.

**Phase 5 — Mobile + loading + error (items 3.10, 3.11, 3.12).** Save
the mobile consolidation for last; it touches the largest blast radius
(`dashboard.tsx` 401-444 + 488-530), and it's safer to do once the
component-level visuals are stable.
