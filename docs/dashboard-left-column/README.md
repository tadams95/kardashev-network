# Dashboard left-column · handoff

Two changes, scoped together because they're conceptually linked:

1. **Ship `HomeEnergyCard`** — replaces the existing "Uncaptured Today" card. New visual + the full data payload the old card carried (the swap is a strict information upgrade, not a tradeoff).
2. **Reorder the left column** to a time-scale ladder: `now → today → forecast`. Eliminates the `$1.19 UNCAPTURED TODAY` vs `TODAY $1` duplication and the unit-mixing in the 3-stat row.

---

## Read order

1. This file — context, concerns, sequencing
2. `components/HomeEnergyCard.tsx` — the new component, production-ready (Tailwind, surface system, amber budget aware)
3. `migration.md` — per-card changes for the left-column reorder

---

## Decision summary

| | |
|---|---|
| **Replaces** | The existing "Uncaptured Today" card |
| **New component** | `components/HomeEnergyCard.tsx` |
| **Visual** | Modern shed-roof home silhouette; amber particles fall, some hit the roof (captured), some miss (uncaptured) |
| **Carried data** | Captured $/h · Uncaptured $/h · Current rate · Condition badge · Cloud cover % · Irradiance range bar |
| **Surface** | `<Card variant="hero">` — the live-data treatment |
| **Render** | SVG + SMIL animations · ~7KB · GPU-cheap |
| **A11y** | Respects `prefers-reduced-motion` (static frame fallback) |
| **Type** | Headline numbers `font-mono` per DESIGN_STATE convention |
| **Column reorder** | Address → HomeEnergyCard (now) → Today summary → Forecast / Monthly Potential |

---

## Areas of concern · please address before / during implementation

These are the things I can't see from a design preview. **Don't merge until each is resolved** — call out in PR.

### C1 · Data plumbing audit

`HomeEnergyCard` needs **8 props**, several of which the existing "Uncaptured Today" card already computes. Before implementing:

- Confirm the hook(s) feeding "Uncaptured Today" today (likely `useSolarValue` or similar).
- Confirm `sunrise` / `sunset` are available at the dashboard scope. If not, that's a small lift to add — the weather ensemble response already includes them.
- Map old field names → new prop names:

| Old field (estimate) | New prop |
|---|---|
| `uncapturedTodayUsd` | `uncapturedTodayUsd` ✓ |
| `currentRateUsdPerHour` | `currentRateUsdPerHour` ✓ |
| `condition` ("Moderate") | `condition` ✓ |
| `cloudCoverPct` | `cloudCoverPct` ✓ |
| `irradianceNowWm2` | `irradianceNowWm2` ✓ |
| `peakIrradianceWm2` | `peakIrradianceWm2` ✓ |
| **NEW** | `capturedTodayUsd` — needs derivation: total potential − uncaptured |
| **NEW** | `sunrise` / `sunset` |

**If `capturedTodayUsd` doesn't exist:** it's `peakUsd - uncapturedUsd` or similar; check the data model. If you have to add it, flag for review — the math should be sourced, not invented.

### C2 · The `TODAY $1` vs `UNCAPTURED $1.19` discrepancy

Two different numbers labeled almost identically in the screenshot. **I don't know if these are intentional.** Three possibilities:

1. **Different windows** — one is "today so far," the other is "today total" (incl. forecast for remaining hours). In which case, label them as such.
2. **Different definitions** — one is "captured value if we had panels," the other is "actual market price." Same — label.
3. **Bug** — one of the calculations is stale.

**Before reordering the column**, get clarity on what these values mean. If they're both legitimate, the new "Today" card surfaces both with disambiguating labels. If one is wrong, fix it before shipping the reorder so we're not enshrining a bug.

### C3 · Existing "Uncaptured Today" card features I can't see

The screenshot shows the card statically. Things to confirm before swapping:

- Is the card clickable? (e.g., expand to detail view)
- Are there hover states / tooltips?
- Does it have a loading / error state? `HomeEnergyCard` has a `<HomeEnergyCardSkeleton>` but the error state needs a path.
- Does the page persist some user setting tied to this card?
- Are there mobile-specific layouts that change its proportions?

If any of these exist, `HomeEnergyCard` needs to honor them. Drop me a note with what's there and I'll spec the additions.

### C4 · Particle animation cost

The card runs **16 simultaneous SMIL animations** per render. Concerns:

- **Multiple cards on screen** — if the dashboard renders this card multiple times (e.g., comparison view), animation count multiplies. Test with 4 cards open.
- **Tab visibility** — browsers throttle background tabs, but if the dashboard is the active tab on a low-end laptop, GPU usage matters. The card should be tested on a 5-year-old MacBook Air baseline.
- **Firefox SMIL bugs** — Firefox has historic issues with `animateMotion` and `animate` chains that loop indefinitely. If QA flags weirdness in Firefox, we may need to migrate to CSS keyframes or Framer Motion.

The component includes `prefers-reduced-motion` handling — verify it renders a clean static frame when set.

### C5 · Column reorder may collide with existing state

The dashboard left column may be:
- Configurable by the user (some cards hideable, reorderable)
- Tied to a specific route/state schema
- Animated on mount/route changes

Before changing the JSX order, confirm:
- Cards aren't dynamically rendered from a config array (if they are, change the array order, not the JSX)
- No `<motion.div layoutId>` props depend on the existing order
- Persisted user preferences don't reference card indices

### C6 · Card height parity

The existing "Uncaptured Today" card has a specific rendered height. `HomeEnergyCard`'s SVG is `aspect-[10/7]` by default which may differ. If the column's other cards rely on consistent heights for visual rhythm, the new card may need a `min-h-[X]` constraint.

---

## Sequencing

**Recommended order, each step independently shippable:**

1. **Commit A · Ship `HomeEnergyCard` as a side-by-side card** (no removal yet). Adds it below "Uncaptured Today" or in a feature flag. Validates the visual + data wiring in production data conditions without committing.
2. **Commit B · Swap the cards** once A's data conditions are confirmed clean. Remove "Uncaptured Today" component (or hide behind flag).
3. **Commit C · Reorder the column** per the time-scale ladder. This depends on the "TODAY $1" vs "UNCAPTURED $1.19" question being resolved (see C2).
4. **Commit D · Retire the old card** entirely once Commit B has been in prod with no regressions for ~1 week.

Steps A and B can ship within 24h. C and D depend on the open questions.

---

## What I'm NOT recommending

Just to be explicit about scope:

- **Don't restyle the existing "Today" or "Monthly Potential" cards** in this round. They work; touching them invites bike-shedding.
- **Don't add new charts.** The rain card is the visualization. Adding another (e.g., a sparkline) would compete for attention.
- **Don't migrate this card to Rive / Framer Motion.** SVG + SMIL is sufficient for the scale of motion needed. Migrate only if Firefox QA forces it.

---

## DESIGN_STATE.md updates

After implementation, append:

- **Surface system** section: bump `<Card variant="hero">` usage count
- **Conventions** section: add — *"`HomeEnergyCard` is the canonical 'right-now' visualization for the dashboard left column. Time-scale ordering convention: cards stack `now → today → forecast` top-to-bottom."*
- **Known follow-ups**: remove "Uncaptured Today card visual" if listed; add follow-up for `capturedTodayUsd` calculation if it was newly derived
