# Type scale · handoff

Implementation package for the six-size semantic type scale.

**Read order:** this file → `tailwind.config.snippet.ts` → `migration.md` → land commits in order (A → B → C → D).

---

## The scale

Six tokens. Each has one job. Every token ships line-height and (where relevant) letter-spacing baked in — no more `leading-X` / `tracking-X` salt scattered across components.

| Token | Size | Line-height | Letter-spacing | Used for |
|---|---|---|---|---|
| `text-micro` | 11px | 14px | +0.5px | Mono caps labels · SVG axis labels · badges · weight bars |
| `text-caption` | 12px | 18px | — | Secondary text · metadata · sub-labels · eyebrow |
| `text-body` | 14px | 21px | — | Default · table rows · prose · subhead under hero |
| `text-subhead` | 18px | 26px | — | Card titles · section headers · modal titles · brand wordmark |
| `text-headline` | 32px | 36px | −0.5px | Big numbers · dashboard hero metrics · payment price |
| `text-display` | clamp(36→60px) | 1.05 | −1.5px | Marketing hero only |

### What goes away

- **All bracket sizes** — `text-[8px]`, `text-[9px]`, `text-[10px]`. The smallest readable size in the app becomes 11px (WCAG comfort floor).
- **Tailwind size sprawl** — `text-base`, `text-xl`, `text-2xl`, `text-5xl`, `text-6xl` all collapse into the new tokens.

### What stays

Tailwind's default `text-*` utilities remain available (Tailwind ships them out of the box). **They should not be used in component code after this lands.** Convention enforced by review.

---

## Files in this package

```
handoff/type-scale/
├── README.md                    ← you are here
├── tailwind.config.snippet.ts   ← fontSize tokens to merge
└── migration.md                 ← per-file diffs (PRIMARY DELIVERABLE)
```

---

## Sequencing

No external dependencies. Can land independently of any in-flight work.

The `text-micro` and `text-caption` tokens combine with the surface-system tokens already merged — confirming `DESIGN_STATE.md` is current is the only prerequisite.

---

## Commit plan (4 commits, ~90 min total)

### Commit A · scaffolding (5 min)

Merge `tailwind.config.snippet.ts` into the existing config. Additive only — no deletions. After this, all six new tokens resolve; existing `text-*` defaults still work.

### Commit B · weather components (~35 min · 11 files)

The data-dense ones. Most ad-hoc bracket sizes live here.

- `WeatherHeroCard.tsx` (10 sites · full diff in migration.md)
- `TemperatureGraph.tsx` (14 sites · full diff)
- `ForecastCards.tsx` (6)
- `HourlyForecast.tsx` (7)
- `ConsensusMetrics.tsx` (7)
- `DataFreshnessIndicator.tsx` (4)
- `TradingStrategiesTable.tsx` (22)
- `SourceDetailBreakdown.tsx` (7)
- `SignalsDisclaimer.tsx` (2)
- `SectionDivider.tsx` (1)
- `ScrollableCardRow.tsx` (1)

### Commit C · hero + chrome (~25 min · 4 files)

- `HeroSection.tsx` (5 sites · full diff)
- `Layout.tsx` (4 sites)
- `PaymentGate.tsx` (18 sites · full diff)
- `WalletSelector.tsx` (11 sites)

### Commit D · cleanup (~10 min)

- `CitySelector.tsx` (2 sites)
- Remove `leading-relaxed` / `leading-snug` / `leading-tight` utilities that were paired with old size classes — the new tokens have built-in line-heights, so these are dead.
- Audit grep (see Verification below).

---

## Out of scope

| File | Why |
|---|---|
| `MarketOpportunitiesTable.tsx` | Dead code (0 imports per DESIGN_STATE 2026-05-02). |
| `SolarMeter.tsx` | Flagged for retirement. Apply tokens only if retirement is deferred. |

---

## Two opinions baked into the migration

These will be the questions Opus surfaces during code review. Both are deliberate.

### 1 · `text-base` collapses to `text-body` (16 → 14px)

Only used in `CitySelector.tsx`'s listbox (`text-base sm:text-sm`). The responsive 16→14 pattern was probably a Headless UI default. The dropdown list reads fine at 14px on mobile — Safari's auto-zoom prevention only applies to `<input>` elements, not list rows. **If a real input is found below 14px after migration, preserve it at 16px to avoid mobile auto-zoom.**

### 2 · SVG chart text uses the same scale (no special case)

`TemperatureGraph.tsx` axis labels move from `text-[8px]` / `text-[9px]` to `text-micro` (11px). That's a 22–37% bump in viewBox-relative font size. **If labels crowd, reduce label density** (show every 4th hour instead of every 3rd) — don't shrink the font.

The design call: readability over density. If you ship the migration and the chart looks crowded, the fix is fewer ticks, not smaller text.

---

## Verification

After all four commits land:

```bash
# These should report ZERO hits:
rg 'text-\[(8|9|10)px\]' components/                     # bracket sizes gone
rg 'text-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl)\b' components/ \
  | grep -v MarketOpportunitiesTable                     # dead code excluded

# These should be the ONLY text-size hits in components/:
rg 'text-(micro|caption|body|subhead|headline|display)\b' components/ | wc -l
# expect ~120 hits across the migrated files
```

A second visual smoke-test:

- [ ] Open `/dashboard`. Source weights bar inside WeatherHeroCard reads at 11px (text-micro), all labels above floor.
- [ ] Open `/weather-forecast`. Temperature graph axis labels visibly bumped vs main, but still readable.
- [ ] Open `/`. Hero headline still hits ~60px on desktop (clamp ceiling); subhead reads at 18px and pairs cleanly.
- [ ] Open `PaymentGate`. "Unlock Premium" h3 reads at 18px; price at 32px. Both feel intentional.
- [ ] Resize from 1920 → 360px width. The hero headline scales smoothly via clamp; no jarring breakpoint jumps.

If anything looks off, the migration is mechanical — find the size class and confirm it mapped per the table in `migration.md`.
