# Migration · dashboard left column

Per-card changes for the time-scale ladder reorder.

**Current order** (top → bottom):
1. Address selector
2. UNCAPTURED TODAY (text + bar)
3. IRRADIANCE / TODAY / PEAK (3-stat row)
4. MONTHLY POTENTIAL ($406 + Unlock Premium CTA)

**New order**:
1. Address selector — *unchanged*
2. **`HomeEnergyCard`** (replaces UNCAPTURED TODAY) — "Right Now"
3. **Today summary** — captured · uncaptured · peak (all $-denominated)
4. **Monthly Potential** — *unchanged*

---

## Per-card changes

### 1 · Address selector

**No change.** Top of the column anchors location. Keep as is.

### 2 · `HomeEnergyCard` (replaces UNCAPTURED TODAY)

Drop the existing UNCAPTURED TODAY card. Replace with:

```tsx
import HomeEnergyCard from "@/components/HomeEnergyCard";

<HomeEnergyCard
  capturedTodayUsd={solar.capturedTodayUsd}
  uncapturedTodayUsd={solar.uncapturedTodayUsd}
  currentRateUsdPerHour={solar.currentRateUsdPerHour}
  condition={solar.condition}
  cloudCoverPct={solar.cloudCoverPct}
  irradianceNowWm2={solar.irradianceNowWm2}
  peakIrradianceWm2={solar.peakIrradianceWm2 ?? 1000}
  cityLabel={location.shortLabel}
/>
```

Source-field names are illustrative — adapt to the actual hook returning the solar data. **See README concern C1** for the data-mapping audit.

### 3 · Today summary (NEW shape — replaces the 3-stat row)

The current 3-stat row mixes units (W/m² and $) and duplicates "today" data already in the rain card. Restructure to a single-card "Today" summary, all $-denominated:

```tsx
<Card variant="default">
  <div className="text-micro font-mono uppercase tracking-wider text-gray-500 font-semibold mb-3">
    Today So Far
  </div>
  <div className="grid grid-cols-3 gap-3">
    <TodayStat label="Captured" value={solar.capturedTodayUsd} />
    <TodayStat label="Uncaptured" value={solar.uncapturedTodayUsd} muted />
    <TodayStat label="Peak rate" value={solar.peakRateTodayUsdPerHour} suffix="/hr" />
  </div>
</Card>
```

Where `TodayStat` follows the same `font-mono` + `text-headline` treatment as the stats inside `HomeEnergyCard`.

**Don't include irradiance/W/m² here** — that data is now inside the HomeEnergyCard's range bar. Keep this card $-denominated and parallel.

> Open question: **does `peakRateTodayUsdPerHour` exist?** If not, derive: `peakIrradianceWm2 × (uncaptured/irradiance ratio)` or similar. See README concern C2.

### 4 · Monthly Potential

**Mostly unchanged.** One small tune that pairs with the new visual hierarchy: the `$406` headline is doing the persuasion work; the "Unlock Premium · $0.001" CTA can drop one weight level to read as a secondary action. The number is the argument.

```diff
- <button className="bg-amber-500 hover:bg-amber-600 text-black font-semibold ...">
-   Unlock Premium · $0.001
- </button>
+ <button className="bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-300 font-medium ...">
+   Unlock for $0.001
+ </button>
```

Optional. Easy revert.

---

## Verification

After all four commits land:

- [ ] Left column reads top-to-bottom as: address → right now → today → monthly potential
- [ ] No card on the page shows both `$1.19 UNCAPTURED` and `$1 TODAY` — the duplication is resolved
- [ ] No card mixes W/m² and $ in the same stat row
- [ ] `HomeEnergyCard` particle animation works smoothly on a baseline laptop (test in Chrome + Safari + Firefox)
- [ ] `prefers-reduced-motion: reduce` set in OS → card renders as static frame with no animation
- [ ] Card is screen-reader accessible (the `aria-label` summarizes the captured/uncaptured ratio in plain text)
- [ ] Mobile responsive: card scales cleanly down to the smallest left-column width on the dashboard's mobile layout

## Rollback path

Each commit is independently revertable:

- Revert Commit C only → column is back to original order, `HomeEnergyCard` still in place
- Revert Commit B only → old UNCAPTURED TODAY card back, `HomeEnergyCard` removed
- Revert Commits A–D → no trace of the change

---

## DESIGN_STATE.md updates

After implementation completes:

```diff
+ ### Conventions
+ - HomeEnergyCard is the canonical 'right-now' visualization for the
+   dashboard left column.
+ - Dashboard left column orders cards by time scale: now → today → forecast.
+
+ ### Migration state
+ | HomeEnergyCard + left-column reorder | Merged | bell-curve sun + time-scale ladder; replaced 'Uncaptured Today' card |
```
