# Migration · per-site call-site swap

The component swap is mechanical. The only judgment call is data plumbing — every site that uses SolarMeter today has `ghi` but may or may not have `sunrise` / `sunset` already wired through.

---

## Standard swap

```diff
- import SolarMeter, { SolarMeterSkeleton } from '@/components/SolarMeter';
+ import SolarValueCard, { SolarValueCardSkeleton } from '@/components/SolarValueCard';

  // …somewhere in JSX:
- <SolarMeter ghi={data.ghi} maxGhi={1000} size="md" />
+ <SolarValueCard
+   ghi={data.ghi}
+   peakGhi={1000}
+   sunrise={data.sunrise}
+   sunset={data.sunset}
+   size="md"
+ />

  // Loading state:
- <SolarMeterSkeleton size="md" />
+ <SolarValueCardSkeleton size="md" />
```

**API changes worth noting:**

| Old prop | New prop | Notes |
|---|---|---|
| `ghi` | `ghi` | Unchanged |
| `maxGhi` | `peakGhi` | Renamed for clarity; defaults to 1000 |
| `size` | `size` | Same values: `sm` / `md` / `lg` |
| `showLabel` | *removed* | Always shows label; semantic |
| — | `sunrise` | **New, required** — Date or ISO string |
| — | `sunset` | **New, required** — Date or ISO string |
| — | `showFooter` | Optional; defaults to `true` on `md` / `lg` |
| — | `now` | Optional override; defaults to `new Date()` |

---

## Finding the call sites

```bash
# Find every JSX/TSX site using <SolarMeter>:
rg '<SolarMeter' --type tsx --type ts

# Find every import:
rg "from\s+['\"].*SolarMeter['\"]" --type tsx --type ts
```

For each site, apply the standard swap above.

---

## If sunrise / sunset isn't available at a call site

This is the only non-mechanical bit. Three resolution paths in priority order:

### 1 · Pull from the same response that gave you `ghi`

Solar API responses already include `sunrise` and `sunset` (they're part of the same daily payload as `ghi_hourly`). If the call site has `ghi`, it almost certainly has access to the parent object that contains both. Pass them through.

### 2 · Pull from the page's weather ensemble

If the page renders both solar and weather data, the weather ensemble has `sunrise` / `sunset` on every forecast. Lift them up one component if needed.

### 3 · Last resort: compute from latitude + date

If neither of the above is plausible (e.g. a static demo), compute astronomical sunrise/sunset from the user's location. The library `suncalc` (~3kb) covers this — but adding a dependency for this should be a discussion, not a unilateral move.

If you find a site where none of these works, **stop and ask** before adding a dependency or hardcoding times.

---

## Delete SolarMeter when done

After every call site is swapped and `rg '<SolarMeter|SolarMeterSkeleton'` returns zero hits:

```bash
rm components/SolarMeter.tsx
```

Update `components/DESIGN_STATE.md`:

- Move `SolarMeter.tsx` out of "Retired / dead code · Flagged for retirement" — it's gone, not flagged.
- Add to "Migration state" table:
  ```
  | SolarMeter retirement | Merged | Replaced by SolarValueCard with bell-curve visualization. |
  ```
- Add to "Conventions":
  > `SolarValueCard` uses a fixed half-sine bell curve as a brand signature (not a chart). Data-driven solar visualization belongs in `SolarCurve`.

---

## Verification

```bash
# Should be zero:
rg 'SolarMeter|SolarMeterSkeleton' --type tsx --type ts
rg 'from\s+[''""].*SolarMeter[''""]' --type tsx --type ts
ls components/SolarMeter.tsx 2>/dev/null && echo "OOPS still exists"
```

Visual smoke-test:

- [ ] All previous SolarMeter sites now render a bell curve with a sun dot.
- [ ] At three different times of day, the curve shape is identical; only the sun dot's horizontal position changes.
- [ ] At night, the sun dot is hidden — the curve still renders as a brand signature.
- [ ] At `size="sm"`, the card stays ≤ 110px tall.
- [ ] At `size="lg"`, the "Peak X at HH:MM · Sunset HH:MM" footer reads cleanly.
