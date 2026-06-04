# Amber budget · handoff

Implementation package for the amber-usage rule + neutral-elevated active-control treatment.

**Read order:** this file → `migration.md` → land the commits in order (A → B → C).

---

## The rules

> ## Amber means **our call**. Nothing else.
> ## Max 2 amber elements per card surface.

### When amber is correct

- The brand mark, anywhere it appears
- Primary CTA buttons ("See it", "Explore the Dashboard", "Pay $X")
- A value Kardashev computed: model probability, model forecast temperature
- The forecast bracket left-border (visual "this is our pick")
- Data lines in charts: the temperature curve, the GHI curve, the source-weight bar fills

### When amber is currently wrong

- Active nav link
- Active filter / sort / mode-toggle pill
- "Today" / "Now" emphasis chips
- Hover states
- The `FORECAST` badge inside an EventCard (the left-border already says it)
- Footer labels like `Forecast bracket:` and `Best edge:`
- The "+5–10%" edge value (use semantic green/yellow/white instead — edge is intensity, which is semantic)
- The actionable-row background tint
- The `Dynamic` badge in source weights
- The refresh icon

### Replacement treatments

| Old | New |
|---|---|
| `bg-amber-500/20 text-amber-400 border border-amber-500/30` (active pill) | `bg-white/[0.1] text-white` |
| `text-amber-500` (active nav link) | `text-white` + hairline white underline (`after:` pseudo) |
| `bg-amber-500/[0.08] border-amber-500/50 ring-1 ring-amber-500/20` (today chip) | `bg-surface-hero border-white/[0.1]` (single elevation step) |
| `text-amber-500` (hover) | `text-white` or `text-gray-300` |
| `bg-amber-500/5 hover:bg-amber-500/10` (actionable row) | `bg-white/[0.03] hover:bg-white/[0.05]` |
| `text-amber-400 font-semibold` (footer label like "Forecast bracket:") | mono small-caps `text-[10px] uppercase tracking-wider text-gray-500 font-mono` |
| `bg-amber-500/15 text-amber-400 border-amber-500/30` (FORECAST badge) | `text-gray-300 border-white/[0.12] font-mono` |

---

## Files in this package

```
handoff/amber-budget/
├── README.md       ← you are here
└── migration.md    ← per-file diffs (PRIMARY DELIVERABLE)
```

---

## Sequencing

This depends on the **surface system handoff** for the `bg-surface-hero` and `bg-surface-nested` tokens used in the "Today/Now" chip migration. **Land the surface-system tokens (Commit A in that package) first.**

If the surface system isn't merged yet, the chip migration in Commit B will reference tokens that don't exist. Either:
1. Land surface-system Commit A first (recommended — 5 min), or
2. Inline the hex values temporarily: `bg-surface-hero` → `bg-[#1c1c1c]`, `bg-surface-nested` → `bg-[#1a1a1a]`. Swap when tokens land.

---

## Commit plan (3 commits, ~45 min total)

### Commit A · controls (~15 min)

The active-state cleanup. Three files, ~30 lines each.

- `components/Layout.tsx` — nav active link + hover + mobile menu active state
- `components/weather/MarketOpportunitiesTable.tsx` — filter pills, sort pills (NOT sweet-spot — that stays green, it's semantic)
- `components/weather/TemperatureGraph.tsx` — 24h/7-day mode toggle

After this commit, the amber-on-amber-on-amber problem in the toolbar resolves and the model-probability cells in the EventCard finally have nothing to compete with at the card-header level.

### Commit B · today/now elevation (~10 min)

Two files. Triple-emphasis chips drop to single-elevation cards.

- `components/weather/ForecastCards.tsx` — today chip
- `components/weather/HourlyForecast.tsx` — current-hour chip

### Commit C · per-card amber cleanup (~20 min)

The remaining amber elements that don't pass the "our call" test.

- `components/weather/MarketOpportunitiesTable.tsx` — FORECAST badge, footer labels, actionable bg, edge value color
- `components/weather/WeatherHeroCard.tsx` — refresh icon, Dynamic badge

---

## Verification

After all three commits land:

```bash
# These should report a SHRINKING number of hits — not zero (model probability
# cells, forecast bracket borders, CTA buttons all legitimately stay amber):
rg 'text-amber-(400|500)' components/ | wc -l       # expect ~25 → ~12
rg 'bg-amber-500/(\d+)' components/ | wc -l         # expect ~15 → ~4
rg 'border-amber-(400|500)' components/ | wc -l     # expect ~12 → ~4
```

These should be **zero** hits in the migrated files:

```bash
rg 'bg-amber-500/20.*text-amber-400.*border-amber-500/30' components/      # active pill recipe
rg 'bg-amber-500/\[0.08\].*ring-1.*ring-amber' components/                  # triple-emphasis today chip
rg 'text-amber-400 font-semibold">Forecast bracket' components/             # footer label
rg 'text-amber-400 font-semibold">Best edge' components/                    # footer label
rg 'hover:text-amber-500' components/                                       # nav hover state
```

---

## What still stays amber (intentional)

After this lands, amber should appear in this shrunk set of places only:

| File | Element | Why |
|---|---|---|
| `KardashevIcon.tsx` | the mark | brand |
| `HeroSection.tsx` | "uncaptured" highlight, "See it" + "Explore" CTAs, feature-card icons | brand + CTA |
| `Layout.tsx` | (nothing — fully neutral after this) | — |
| `WeatherHeroCard.tsx` | big temperature value, source-weight bar fills | **our call** values |
| `MarketOpportunitiesTable.tsx` | forecast bracket left border, model-forecast temp in header, model probability column | **our call** values |
| `TemperatureGraph.tsx` | temperature curve, forecast-high reference, current-hour glow dot, tooltip values, legend swatch | data lines |
| `SolarMeter.tsx` / `SolarCurve.tsx` | gauge fill, peak annotation, sun dot | data |
| `PaymentGate.tsx` | EVM-side CTA (Solana side stays purple) | CTA |
| `WalletSelector.tsx` | EVM connect button (Solana stays purple) | CTA |

If you find an amber after this list, it slipped through — flag it.
