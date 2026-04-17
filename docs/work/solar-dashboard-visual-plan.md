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

- [x] **Lift `today` to the hero, demote `/hr` to a live indicator**  *— shipped in `c3aeac9`*
      File: `src/pages/dashboard.tsx:246-291`
      What: Replace the hero number with `wastedEnergy.todayValue`
      (today's accumulated $). Move `wastedEnergy.currentValue` into a
      small live indicator below the hero number — caption-sized, paired
      with a pulsing dot to preserve the "live instrument" feel. Update
      the eyebrow label from "Uncaptured Value" to "Uncaptured Today".
      Lower the hero chrome (reduce border weight, strip decoration).
      Direction is **less containment, more breathing room** — aligns
      with the "premium reveals data, not chrome" principle.
      Why: Per the §6 Pre-Phase-2 Decision (resolved: today-as-hero).
      Audit visual inventory shows the hero competes with the location
      card, the stats grid, and the monthly banner for attention; the
      `/hr` number was also tiny and hit ~$0 at night.
      Done when: A first-time visitor's eye lands on the today number
      before anything else on both 1440p desktop and a phone in hand;
      the `/hr` indicator is visibly subordinate but still alive (pulsing
      or counting); the block reads as one focal unit, not three numbers
      competing.

- [x] **Tie the 0–1000 W/m² progress bar visually to the hero number**  *— shipped in `6081ede`*
      File: `src/pages/dashboard.tsx:277-288`
      What: Reduce `mt-6`, match the bar width to the number's bounding box,
      or replace with a concentric arc that wraps the number.
      Why: The bar currently reads as a separate widget below the hero,
      disconnecting "this is the dollar value" from "this is how much
      sunlight you're getting right now".
      Done when: Hero block reads as one visual unit; the bar's role as the
      irradiance gauge for the displayed number is obvious without text.

- [x] **Resolve cloud-cover chip 0% case**  *— shipped in `6081ede`*
      File: `src/pages/dashboard.tsx:266-273`
      What: Either always render the chip (with a deliberate "clear sky"
      treatment when `cloudCover === 0`) or remove it from the hero entirely.
      Why: Audit flagged `cloudCover > 0` as silently hiding the chip — a
      true 0% reading is visually identical to data-missing.
      Done when: Clear-sky and data-missing states are visually distinct.

- [x] **Make the hero skeleton match the loaded hero footprint**  *— shipped in `0ea0b9d` (subsumed by item 3.11's broader skeleton-matching pass)*
      File: `src/pages/dashboard.tsx:247-251`
      What: Replace the 20×48 gray block with a skeleton that mirrors the new
      hero's number + label + bar layout.
      Why: Current skeleton is roughly half the height of the loaded hero —
      the page jumps when data arrives.
      Done when: No vertical reflow on hero data arrival.

### 3.2 Location Card

- [x] **De-emphasize lat/lng coordinates for free tier**  *— shipped in `d8c262d`*
      File: `src/pages/dashboard.tsx:212-214`
      What: Demote the monospace coordinate string — smaller font, hover-only,
      or move to a tooltip on the address.
      Why: Geek-noise for the 95% audience. The address line above already
      answers "where". (See open question on whether coordinates should
      survive at all.)
      Done when: Address is the visible primary identifier; coordinates are
      reachable but not prominent.

- [x] **Reposition `TierBadge` so it doesn't sit inside the address title**  *— shipped in `d8c262d`*
      File: `src/pages/dashboard.tsx:206-210`
      File: `src/components/PaymentStatus.tsx:67-83`
      What: Move `TierBadge` out of the `<h1>` flex row. Place it as a corner
      badge on the location card, or in the page header near `WalletSelector`.
      Why: Currently a small chip sandwiched against address text — easy to
      miss, and long addresses wrap awkwardly around it.
      Done when: `TierBadge` has a deliberate fixed position that doesn't
      compete with the address typography.

- [x] **Connect the refresh button to the data, not the card chrome**  *— shipped in `d8c262d`*
      File: `src/pages/dashboard.tsx:226-240`
      What: Move the refresh icon next to `TierBadge`, or pair it with a
      "last updated XXs ago" timestamp so the affordance has context.
      Why: Refresh sits in the location card today, which has nothing to do
      with refresh semantics — it's the global data refresh.
      Done when: A user who wants to manually refresh finds the control
      without scanning the whole page.

### 3.3 Stats Grid

- [x] **Lock in a stable column count for the stats row**  *— shipped in `71e1bd6` (Phase 3 stats-grid logic; free tier no longer reflows on load. Premium load → loaded shift remains and is acceptable per the revised Done-when above.)*
      File: `src/pages/dashboard.tsx:330`
      What: With Direct/Diffuse removed (per the decided hybrid lock
      rule), free tier becomes a stable 3-up grid across load → loaded.
      Premium still 3 → 4 on payment. Make the skeleton column count
      match the loaded shape per tier so there's no mid-load reflow.
      Why: The biggest relayout was free `loading → loaded` (3 → 4) —
      Phase 3 fixes that as a side effect. Premium load → loaded still
      shifts 3 → 4 because the premium 4th cell can only render once
      `solarData?.current.diffuseRadiation` arrives.
      Done when: Free tier never reflows the stats grid columns. Premium
      reflows once on first data arrival per session — acceptable.

- [x] **Remove the Direct/Diffuse locked stub** *(decision per §4)*  *— shipped in `71e1bd6`*
      File: `src/pages/dashboard.tsx:390-398`
      What: Delete the `!isPremium && solarData` branch that renders the
      `--` stub. Adjust the parent grid so free tier renders 3-up; the
      premium 4-up branch (which only renders when
      `diffuseRadiation !== undefined`) remains.
      Why: §4 hybrid rule — "Direct/Diffuse" is jargon most free
      visitors don't know they want. Removing it lets the stats grid
      breathe and eliminates the broken-looking `--` placeholder.
      Done when: Free tier shows a clean 3-up grid (Irradiance / Today /
      Peak); premium shows the 4-up grid only when diffuse data is
      present.

### 3.4 SolarCurve (Hero Chart)

- [x] **Annotate the peak point on the curve itself**  *— shipped in `2009b0d`*
      File: `src/components/SolarCurve.tsx:307-313`
      What: When peak GHI clears a meaningful threshold, render a "Peak"
      label on the curve at the peak point, not just in the summary row
      below the chart.
      Why: The chart shows a beautiful arc but the user has to read the
      summary text to identify where the peak is. The chart has space.
      Done when: Peak point is visually labeled on the curve when above a
      threshold; redundant duplication with the summary row is intentional.

- [x] **Polish the "Tomorrow" badge state**  *— shipped in `2009b0d`*
      File: `src/components/SolarCurve.tsx:189-196`
      What: When the chart shifts to tomorrow's data after sunset, integrate
      the badge into the chart header or the section header at
      `dashboard.tsx:491` — not the current standalone flex row above.
      Why: The arc itself is the most polished visual on the page; the
      badge currently feels bolted on.
      Done when: "Showing tomorrow" reads as a deliberate variant of the
      chart, not a stuck-on label.

### 3.5 Locked Premium Stubs

- [x] **Apply the hybrid locked-state rule** *(decision per §4)*  *— shipped in `71e1bd6`*
      File: `src/pages/dashboard.tsx:317-327`, `390-398`, `432-444`, `520-530`
      What: Apply the §4 hybrid rule across all four locked surfaces:
      (a) **Remove** Weather Context locked stub (317-327) and
      Direct/Diffuse locked stub (390-398) — both are jargon or empty
      placeholders that don't sell premium to a free visitor.
      (b) **Replace** the WeekForecast mobile (432-444) and desktop
      (520-530) header-only stubs with a deliberate lock-card recipe:
      lock icon in a tinted container + title + subtitle copy line +
      inline `Unlock` button calling `upgradeToPremium`. Same visual
      contract in both places (deduplication is item 3.10's problem).
      Why: §4 hybrid rule. The four current treatments collapse to one
      rule applied two ways: comprehensible feature → lock-card; jargon
      / empty → remove.
      Done when: Free tier shows zero `--` stubs and zero "Premium"-only
      label rows. The two WeekForecast lock-cards (mobile + desktop)
      render with identical structure and a working Unlock button.
      Direct/Diffuse and Weather Context surfaces no longer render in
      the free-tier DOM.

### 3.6 WeekForecast (7-Day Strip)

- [x] **Visually emphasize the brightest day in the strip**  *— shipped in `6081ede`*
      File: `src/components/WeekForecast.tsx:74-95`
      What: Apply emphasis (border, glow, scale, color) to the day with the
      highest `radiationSum` — the "your best solar day this week" insight.
      Why: All seven cards look identical except for content. The strip
      carries seven numbers but conveys no narrative without reading them.
      Done when: The brightest forecast day is distinguishable at a glance,
      without reading numbers.

- [x] **Color-code existing weather SVGs by solar quality**  *— shipped in `2acc989`*
      File: `src/components/WeekForecast.tsx:5-52`
      What: Modify the existing six monotone SVGs in place — color the
      stroke based on expected solar yield (e.g., amber for sunny → muted
      gray for overcast). **Do not introduce a new icon library in this
      stream**; that's a separate decision (bundle size, license,
      cross-page consistency) outside the visual-system scope.
      Why: In a strip whose only differentiation is icon + numbers, the
      icon needs to convey solar quality, not just precipitation type.
      Done when: Each forecast day's icon stroke color reflects expected
      solar yield, distinguishable at a glance, with no new dependencies
      added.

### 3.7 RoofAnalysis Block

- [x] **Promote "Best Roof Section" higher in the visual flow**  *— shipped in `2665dd0`*
      File: `src/components/RoofAnalysis.tsx:118-134`
      What: Currently rendered below the 4-cell stats grid + sizing note.
      Move it to the top of the card, immediately after the title row.
      Why: It carries the "you should put panels here" judgment — the
      single most actionable insight in the whole component.
      Done when: Best-segment chip appears at or near the top of the card.

- [x] **Compress the imagery date footer**  *— shipped in `2665dd0`*
      File: `src/components/RoofAnalysis.tsx:151-154`
      What: "Imagery from {date} • Data powered by Google Solar API" gets a
      full text row today. Move to a hover tooltip on the "Google Solar"
      header badge or shrink to micro-text.
      Why: Card real estate is finite; this footer never changes user
      behavior.
      Done when: Date + attribution remain discoverable but don't occupy a
      full row by default.

### 3.8 SunroofMap

- [ ] **Add numeric anchors to the color legend** *— DEFERRED out of Phase 4*
      File: `src/components/SunroofMap.tsx:114-127`
      What: Legend strip is a thin gradient with "Low" / "High" labels. Add
      kWh/m²/year values at the endpoints from the actual flux range.
      Why: Without numbers, the heatmap is "pretty colors on a roof"
      rather than a data tool a user can read absolute values from.
      **Deferral reason:** the actual min/max flux values are computed
      server-side in `src/pages/api/solar/data-layers.ts:165-176` but are
      *not* returned in the API response (only the rendered PNG is). To
      satisfy the Done-when honestly we'd need to surface `fluxRange`
      through `RenderedLayer` in `@/types/googleSolar` and the data-layers
      API. Per §5 ("Out of Scope: API routes ..."), server changes don't
      belong in this work stream. Pick this back up if/when the data layer
      gets reworked, OR open it as its own item in a server-side stream.
      Done when: A user can read approximate flux at any point on the roof
      from the legend alone.

- [x] **Reconsider the zoom-20 lock**  *— shipped in `a078faf`*
      File: `src/components/SunroofMap.tsx:109`
      What: Map opens at zoom 20 (very tight) with no explicit zoom-out
      affordance. Lower default zoom or surface zoom controls.
      Why: Users often want their roof in the context of property/street;
      zoom 20 frames just the rooftop.
      Done when: Default zoom shows the building plus immediate
      surroundings, OR zoom-out is unmistakably available.

### 3.9 Monthly Estimate Banner

- [x] **Promote the monthly banner without crowding `today`**  *— shipped in `c3aeac9`*
      File: `src/pages/dashboard.tsx:447-482`
      What: With today-as-hero (per §6 decision), the conversion story is
      now split: today = "what your roof did," monthly = "what it could
      do." Promote the monthly banner so monthly is unambiguously the
      "size of opportunity" pitch — bigger number, more breathing room,
      more deliberate placement — *but* it is now ranked #3 in visual
      weight (today is #2). The upgrade CTA stays anchored to this
      banner.
      Why: Audit identified the monthly estimate has three formula
      paths; whichever fires, this is the size-of-opportunity number.
      Today owns "actual"; monthly owns "potential."
      Done when: Monthly number's vertical footprint and font size are
      **smaller than today's, never larger**; the today→monthly
      relationship reads as "this happened / this could happen" without
      label copy explaining it. If there's tension between today and
      monthly for visual weight, pull monthly back.

- [x] **Improve the "?" tooltip discoverability**  *— shipped in `6081ede`*
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

- [x] **Consolidate the duplicated SolarCurve + WeekForecast renders**  *— shipped in `9dc4ad2`*
      What landed: Section JSX extracted to three local variables
      (`solarCurveSection`, `sevenDayPremiumSection`, `sevenDayLockCard`)
      defined once in the component body. Mobile and desktop slots both
      reference the same variables under `lg:hidden` / `hidden lg:block`
      wrappers — single source of truth for any future edit.
      *Note on "appear exactly once":* a strict CSS-grid single-placement
      approach (`col-start-N` + row-pack) was prototyped and rejected.
      Grid items in the same row share row height, which produced
      visible vertical gaps below the shorter left-column items
      (Location, Stats, Monthly). The variable-extraction approach
      satisfies the practical concern (no two-place edits) without the
      layout regression. The two visibility-toggled wrappers that remain
      contain no logic — just `{variable}`.

- [x] **Audit and fix the mobile column order**  *— audit complete; no code change needed*
      Verified mobile flow as-shipped (post-Phase-3): Location → Hero →
      Weather Context (premium only) → Stats → Solar Curve → 7-Day
      (premium or lock-card) → Monthly → Sunroof → Roof. Hero is
      position 2; current irradiance (Stats) is position 4; day's curve
      is position 5 — matches the Done-when. Phase 3 replaced the
      "locked stubs" with deliberate lock-cards, so the
      "below-the-fold" guidance no longer applies (the WeekForecast
      lock-card is intentional content selling premium, kept above the
      fold by design).

### 3.11 Loading & Skeleton States

- [x] **Match every skeleton to its loaded counterpart's dimensions**  *— shipped in `0ea0b9d`*
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

- [ ] **Sequence skeletons to feel choreographed** *— DEFERRED out of Phase 5*
      File: `src/pages/dashboard.tsx` (page-level `isLoading` + `isRoofLoading`)
      What: Solar data and Google Solar load independently. Design the
      staggered reveal — e.g., hero first, then secondary stats, then
      roof block — so partial-load states feel intentional.
      **Deferral reason:** the implementation is straightforward
      (CSS animation-delays on each skeleton's `animate-pulse`), but
      validating the visual outcome requires a real browser session to
      eyeball — which is the kind of subjective polish that's hard to
      ship blind from an autonomous loop. Picking this up needs Ty in
      the loop with the dev server up.
      Done when: Loading sequence reads as choreographed regardless of
      which API responds first.

### 3.12 Empty & Error States

- [x] **Redesign the no-location splash to be inviting, not utilitarian**  *— shipped in `98d9cf1`*
      File: `src/pages/dashboard.tsx:97-119`
      What: Today: icon + h1 + paragraph + `LocationSearch` in a centered
      card. Add example/popular cities, raise the geolocate-now affordance,
      and tease what the dashboard will show.
      Why: This is the first screen for any visitor without a saved
      location — currently reads like a setup form, not a teaser.
      Done when: A first-time visitor understands what they'll see after
      entering a location, before they enter one.

- [x] **Improve the error banner's visual treatment**  *— shipped in `98d9cf1`*
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

- [x] **Define a typographic scale and migrate to it**  *— shipped in `e55b349`*
      File: `src/pages/dashboard.tsx` (page-wide)
      File: `src/components/*` (all in scope)
      What: Audit every `text-xs/sm/base/lg/xl/2xl/5xl/6xl/7xl` and
      `text-[10px]/[11px]/[9px]` usage. Define ~6 named scale tokens
      (display / headline / title / body / caption / micro) and migrate.
      Why: Audit visual inventory revealed inconsistent typography across
      the page — micro-labels at 9, 10, and 11 px appear arbitrarily.
      Done when: Every text element on the dashboard maps to a named
      scale token; no arbitrary `text-[Npx]` remains.

- [x] **Define a section padding + radius system**  *— shipped in `e55b349`*
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

1. **Free-tier `RoofAnalysis` and `SunroofMap` placement** — these are
   not gated by x402 today (they render for free users when Google Solar
   has coverage). Should they be the page's secondary attraction (right
   column on desktop, prominent on mobile), or is that overweight for a
   non-paying visitor?

**Resolved since first draft:**
- *Hero metric framing* (`$X.XX/hr` vs `$X today` vs `$X this month`) is a
  product-strategy decision, not a design question. Moved to section 6
  as a Pre-Phase-2 Decision — must be answered before lifting the hero,
  because lifting `/hr` and lifting `today` are different items.
- *Lat/lng coordinates* — decided as **keep but demote**, per item 3.2.
- *Locked-state visual language* — decided as **hybrid by surface
  comprehensibility**. Rule: if a locked feature is comprehensible to a
  free-tier visitor and demonstrates value, render a deliberate
  lock-card (icon + title + subtitle + inline Unlock affordance);
  otherwise, remove the locked element entirely. Resolves both the
  uniform-vocabulary concern (one rule, applied consistently) and item
  3.3's Direct/Diffuse stub question.
- *Direct/Diffuse stub* — decided as **remove entirely** (consequence of
  the hybrid rule above; "Direct/Diffuse" is jargon most free visitors
  don't know they want). Free tier collapses to a 3-up stats grid.

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
- The landing page's 3D solar globe and any other surfaces outside
  `/dashboard`. The visual system established here should eventually
  apply to `/` so the two pages don't drift, but cross-page rollout is a
  separate stream.

## 6. Sequence Recommendation

**Pre-Phase-2 product decision — RESOLVED.**
*Decision:* hero shows `$X today` (cumulative day total). `$X.XX/hr`
demoted to a small live indicator below the hero number to preserve the
"live instrument" feel. Monthly stays in its banner role as the
opportunity-size pitch.
*Reasoning:* `/hr` is honest but tiny ($0.10–$0.50) and goes to ~$0 at
night — a poor first impression for a midnight visitor. `today` is
monotonic, real (not estimated), stays meaningful 24h, and pairs cleanly
with monthly as "actual / potential." Item 3.1 reflects this; item 3.9
(monthly banner promotion) is now constrained: today ranks #2, monthly
#3.

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

*Tipping point:* If Phase 2-4 work has you editing both the mobile and
desktop render blocks for the same visual change three or more times,
promote item 3.10 earlier — the duplication tax exceeds the
consolidation risk at that point.
