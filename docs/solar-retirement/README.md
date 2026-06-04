# SolarMeter retirement · handoff

Decision: **Direction C with a perfect bell curve.** SolarMeter retires; a new `SolarValueCard` component takes its place.

The curve is a half-sine wave (mathematically: `y = sin(t × π)` where `t ∈ [0, 1]` maps sunrise → sunset). It is **identical shape regardless of weather, data, or location** — by design. The bell curve is a brand signature, not a chart. The sun dot's position along it represents time-of-day; the headline number represents the actual GHI value.

---

## Decision summary

| | |
|---|---|
| **Replaces** | `components/SolarMeter.tsx` |
| **New component** | `components/SolarValueCard.tsx` |
| **Visualization** | Perfect half-sine bell curve, sun dot at `t = (now − sunrise) / (sunset − sunrise)` |
| **Data needed** | `ghi: number`, `sunrise: Date \| string`, `sunset: Date \| string` |
| **Optional** | `peakGhi` (defaults to 1000), `size` (`sm` \| `md` \| `lg`), `showFooter` |
| **Surface** | `<Card variant="hero">` — surface-system native |
| **Type** | Headline GHI uses `text-headline` + `font-mono` |
| **Sizes** | API-compatible with SolarMeter (`sm` / `md` / `lg`) |

---

## Files in this package

```
handoff/solar-retirement/
├── README.md                    ← you are here
├── components/
│   └── SolarValueCard.tsx       ← drop in
└── migration.md                 ← call-site swap guide
```

---

## Why bell curve, not data-driven curve

Three reasons, ordered by importance:

1. **Visual consistency.** Every page that uses this card shows the same shape. The user learns "the curve is the day" once; the only thing that varies is where the sun sits.
2. **Decoupled data dependency.** SolarValueCard needs only the current GHI value plus sunrise/sunset times — no hourly forecast required. SolarCurve (which keeps its data-driven shape) handles the "show me the actual day's trajectory" use case in the dashboard.
3. **Brand mark.** The bell + sun dot is small enough and recognizable enough to function as a Kardashev signature glyph at the dashboard scale.

If a future need surfaces for an actual data-driven small-card visualization, that's a different component. Don't compromise this one.

---

## Three-step migration

### 1 · Drop in the new component (5 min)

Place `SolarValueCard.tsx` in `components/`. Self-contained; only depends on `@/components/Card` (already exists).

### 2 · Swap call sites (per-site, ~5 min each)

See `migration.md`. The pattern:

```diff
- <SolarMeter ghi={currentGhi} maxGhi={1000} size="md" />
+ <SolarValueCard
+   ghi={currentGhi}
+   peakGhi={1000}
+   sunrise={data.sunrise}
+   sunset={data.sunset}
+   size="md"
+ />
```

If a call site doesn't have `sunrise` / `sunset` available, that's a data plumbing fix, not a component fix — wire it through. Every page that shows solar data already has these values nearby; they're in the weather ensemble response.

### 3 · Delete the old component (1 min)

After all call sites are migrated:

```bash
rm components/SolarMeter.tsx
```

Confirm with:

```bash
rg 'SolarMeter|SolarMeterSkeleton' --type tsx --type ts
# expect zero hits
```

---

## What stays

`SolarCurve.tsx` is **untouched**. The data-driven Apple-Watch-style hourly arc remains the dashboard hero visualization. The two components serve different purposes:

| Component | Purpose | Curve shape |
|---|---|---|
| `SolarCurve` | "Show me today's actual solar trajectory, hour by hour" | Data-driven (real hourly GHI) |
| `SolarValueCard` | "Show me the current value, framed by today's sunrise–sunset" | Perfect bell (sin × π) |

---

## DESIGN_STATE.md updates

After this lands, update `components/DESIGN_STATE.md`:

- **Retired / dead code** section: mark `SolarMeter.tsx` as deleted (move out of "Flagged for retirement").
- **Conventions** section: add a one-liner — *"`SolarValueCard` uses a fixed half-sine bell curve as a brand signature; data-driven solar visualization belongs in `SolarCurve`."*
- **Migration state** table: add a row — *"SolarMeter retirement | Merged | bell-curve `SolarValueCard` swap."*

---

## Smoke-test after merge

- [ ] Bell curve renders identically on every page that uses `SolarValueCard` — no shape variance day-to-day.
- [ ] Sun dot sits left of center in the morning, at peak around solar noon, right of center in the afternoon.
- [ ] Sun dot hides entirely before sunrise and after sunset (no rendering on the horizon line — the card is night-time-aware).
- [ ] At `size="sm"`, the card stays under ~110px tall and reads cleanly in dashboard stat-card slots.
- [ ] At `size="lg"`, the card includes the "Peak X at HH:MM · Sunset HH:MM" footer.
- [ ] No console warnings about missing `sunrise` / `sunset` props.
