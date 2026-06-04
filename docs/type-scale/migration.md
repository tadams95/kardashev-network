# Migration · per-file diffs

Four commits, top to bottom. Each independently shippable.

**Translation rule** — apply mechanically; full table in README:

| Old | New |
|---|---|
| `text-[8px]` / `text-[9px]` / `text-[10px]` | `text-micro` |
| `text-xs` | `text-caption` |
| `text-sm` / `text-base` | `text-body` |
| `text-lg` / `text-xl` / `text-2xl` | `text-subhead` |
| `text-3xl` / `text-4xl` (dashboard) | `text-headline` |
| `text-4xl sm:text-5xl lg:text-6xl` (hero only) | `text-display` |

**Also drop** `leading-relaxed` / `leading-snug` / `leading-tight` / `leading-[1.05]` paired with the old size classes — the new tokens ship line-height baked in.

---

## Commit A · scaffolding

Merge `tailwind.config.snippet.ts` into the project's `tailwind.config.ts`. Additive only.

---

## Commit B · weather components

### B1 · `components/weather/WeatherHeroCard.tsx`

Ten sites. Full diff:

```diff
         {/* City Name */}
-        <div className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-1">
+        <div className="text-caption font-semibold text-gray-400 uppercase tracking-wide mb-1">
           {city.name}
         </div>

         {/* Temperature */}
-        <div className="text-4xl font-bold text-amber-400 mb-1">
+        <div className="text-headline font-bold text-amber-400 font-mono mb-1">
           {celsiusToFahrenheit(currentTemp).toFixed(1)}°F
         </div>

         {/* High / Low */}
-        <div className="text-sm text-gray-300 mb-1">
+        <div className="text-body text-gray-300 mb-1">
           H: {dailyHigh != null ? `${celsiusToFahrenheit(dailyHigh).toFixed(1)}°F` : '--'}{' '}
           L: {dailyLow != null ? `${celsiusToFahrenheit(dailyLow).toFixed(1)}°F` : '--'}
         </div>

         {/* Precipitation */}
-        <div className="flex items-center gap-1.5 text-sm mb-0">
+        <div className="flex items-center gap-1.5 text-body mb-0">
           <CloudIcon className="w-4 h-4 text-blue-400" />
           <span className="text-gray-300">{(precipProb * 100).toFixed(0)}% rain</span>
         </div>

         {/* Atmospheric secondary row */}
         {(currentHumidity != null || currentApparent != null) && (
-          <div className="flex items-center gap-3 text-xs text-gray-400 mt-1">
+          <div className="flex items-center gap-3 text-caption text-gray-400 mt-1">
             {currentHumidity != null && (
               <span>{Math.round(currentHumidity)}% humidity</span>
             )}
             ...

       {/* Meta-Diagnostics Footer */}
-      <Card variant="nested" className="m-2.5 mt-0 text-xs space-y-1.5">
+      <Card variant="nested" className="m-2.5 mt-0 text-caption space-y-1.5">
         ...

           <button onClick={() => setShowWeights(!showWeights)} ...>
             Source Weights{' '}
-            <span className={`inline-block text-[9px] px-1.5 py-0.5 rounded-full font-medium font-mono uppercase tracking-wider ${...}`}>
+            <span className={`inline-block text-micro px-1.5 py-0.5 rounded-full font-medium font-mono uppercase ${...}`}>
               {sourceWeights.isDynamic ? 'Dynamic' : 'Static'}
             </span>
-            <span className="ml-1 text-[10px]">{showWeights ? '▲' : '▼'}</span>
+            <span className="ml-1 text-micro">{showWeights ? '▲' : '▼'}</span>
           </button>

           {showWeights && (
             ...
                 <div key={source} className="flex items-center gap-1.5">
-                  <span className="text-gray-500 w-16 truncate text-[10px]" title={source}>
+                  <span className="text-gray-500 w-16 truncate text-micro" title={source}>
                     {source.replace(...)}
                   </span>
                   <div className="flex-1 h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                     <div className="h-full bg-amber-500/60 rounded-full" style={{...}} />
                   </div>
-                  <span className="text-gray-400 w-8 text-right text-[10px]">
+                  <span className="text-gray-400 w-8 text-right text-micro">
                     {(w * 100).toFixed(0)}%
                   </span>
                 </div>
```

> Also drop the redundant `tracking-wider` on the Dynamic badge — `text-micro` ships +0.5px letter-spacing built-in.

> Add `font-mono` to the big temperature value if it's not already there. Per DESIGN_STATE convention: numbers use the mono stack.

### B2 · `components/weather/TemperatureGraph.tsx`

Fourteen sites. Mix of DOM and SVG text. **All SVG axis labels move to `text-micro`.** If the result is too dense, reduce label density (skip ticks), not the font size.

```diff
   // Loading / empty states
-      <div className="flex items-center justify-center h-40 text-gray-500 text-sm">
+      <div className="flex items-center justify-center h-40 text-gray-500 text-body">

   // SVG axis labels (24h chart)
-           <text x={PADDING.left - 8} y={y + 3} textAnchor="end" className="fill-gray-500 text-[9px]">
+           <text x={PADDING.left - 8} y={y + 3} textAnchor="end" className="fill-gray-500 text-micro">
             {temp.toFixed(1)}°F
           </text>

-          textAnchor="middle" className="fill-gray-500 text-[9px]"
+          textAnchor="middle" className="fill-gray-500 text-micro"

   // "Forecast High" reference label
-              textAnchor="end" className="fill-amber-400/70 text-[8px]"
+              textAnchor="end" className="fill-amber-400/70 text-micro"

   // Tooltip body
-            <text x={tooltipX + 6} y={tooltipY + 14} className="fill-amber-400 text-[10px] font-medium">
+            <text x={tooltipX + 6} y={tooltipY + 14} className="fill-amber-400 text-micro font-medium">
               {p.tempF.toFixed(1)}°F
             </text>
-            <text x={tooltipX + 6} y={tooltipY + 26} className="fill-gray-400 text-[9px]">
+            <text x={tooltipX + 6} y={tooltipY + 26} className="fill-gray-400 text-micro">
               {formatHourLabel(p.hour)}
             </text>
-            <text x={tooltipX + 6} y={tooltipY + 38} className="fill-blue-400 text-[9px]">
+            <text x={tooltipX + 6} y={tooltipY + 38} className="fill-blue-400 text-micro">

   // 7-day chart — same axis label changes (lines ~373, 387)
-            <text x={PADDING.left - 8} y={y + 3} textAnchor="end" className="fill-gray-500 text-[9px]">
+            <text x={PADDING.left - 8} y={y + 3} textAnchor="end" className="fill-gray-500 text-micro">

   // 7-day tooltip (lines ~469-479) — same pattern, all → text-micro

   // Card header
-       <h3 className="text-sm font-semibold text-white">Temperature Forecast</h3>
+       <h3 className="text-subhead font-semibold text-white">Temperature Forecast</h3>

   // Mode toggle buttons (lines ~505, 515)
-           className={`px-3 py-1 text-xs rounded-md transition-colors ${...}`}
+           className={`px-3 py-1 text-caption rounded-md transition-colors ${...}`}

   // Legend
-      <div className="flex items-center justify-center gap-5 mt-3 text-xs">
+      <div className="flex items-center justify-center gap-5 mt-3 text-caption">
```

> Note: the card's h3 jumps from 14px to 18px. That brings it in line with other card titles in the app (MarketOpportunities, ConsensusMetrics, etc., which use `text-lg`/18px). The temp graph was the outlier.

### B3 · `components/weather/ForecastCards.tsx`

Six sites. Table-style map:

| Line | Before | After |
|---|---|---|
| 31 (loading h3) | `text-sm font-semibold` | `text-subhead font-semibold` |
| 64 (day label) | `text-xs mb-1 font-medium` | `text-caption mb-1 font-medium` |
| 74 (high temp) | `text-lg font-bold` | `text-subhead font-bold` (also add `font-mono`) |
| 79 (low temp) | `text-xs text-gray-400` | `text-caption text-gray-400` (also add `font-mono`) |
| 84 (precip) | `text-xs text-blue-400` | `text-caption text-blue-400` (also add `font-mono`) |
| 90 (wind) | `text-xs text-gray-400` | `text-caption text-gray-400` (also add `font-mono`) |

### B4 · `components/weather/HourlyForecast.tsx`

Seven sites. Same pattern as ForecastCards.

| Line | Before | After |
|---|---|---|
| 65 (empty h3) | `text-sm font-semibold` | `text-subhead font-semibold` |
| 66 (empty body) | `text-gray-400 text-sm` | `text-gray-400 text-body` |
| 84 (hour label) | `text-xs font-medium mb-1` | `text-caption font-medium mb-1` |
| 94 (temp) | `text-lg font-bold mb-1` | `text-subhead font-bold mb-1` (also add `font-mono`) |
| 99 (precip) | `text-xs text-blue-400` | `text-caption text-blue-400 font-mono` |
| 105 (wind) | `text-xs text-gray-400 mt-1` | `text-caption text-gray-400 font-mono mt-1` |
| 112 (humidity) | `text-xs text-gray-500` | `text-caption text-gray-500 font-mono` |

### B5 · `components/weather/ConsensusMetrics.tsx`

Seven sites:

| Lines | Before | After |
|---|---|---|
| 25, 41 (h3) | `text-lg font-semibold` | `text-subhead font-semibold` |
| 46, 58, 70 (row labels) | `text-sm text-gray-400` | `text-body text-gray-400` |
| 47, 59, 71 (row values) | `text-lg font-semibold` | `text-subhead font-semibold font-mono` |
| 78 ("Data Sources" label) | `text-xs text-gray-400 mb-2` | `text-caption text-gray-400 mb-2` |
| 87 (source name) | `text-xs text-gray-300` | `text-caption text-gray-300` |

### B6 · `components/weather/DataFreshnessIndicator.tsx`

Four sites:

| Lines | Before | After |
|---|---|---|
| 63, 83 (h3) | `text-lg font-semibold` | `text-subhead font-semibold` |
| 98 (row) | `text-sm` | `text-body` |
| 109 (footer) | `text-xs text-gray-400` | `text-caption text-gray-400` |

### B7 · `components/weather/TradingStrategiesTable.tsx`

Twenty-two sites — table-heavy, mechanical. Apply the standard mapping to every site:

- All `text-xs` → `text-caption`
- All `text-sm` → `text-body`
- All `text-lg` (h3) → `text-subhead`

No exceptions in this file.

### B8 · `components/weather/SourceDetailBreakdown.tsx`

Seven sites:

| Lines | Before | After |
|---|---|---|
| 110 (h3) | `text-sm font-semibold` | `text-subhead font-semibold` |
| 111 (subtitle) | `text-xs text-gray-500 mt-0.5` | `text-caption text-gray-500 mt-0.5` |
| 115 (toggle) | `text-xs text-gray-400` | `text-caption text-gray-400` |
| 120 (table) | `text-xs min-w-[900px]` | `text-caption min-w-[900px]` |
| 121 (thead) | `text-[10px]` | `text-micro` |
| 154 (cell) | `text-[10px] text-gray-400` | `text-micro text-gray-400` |
| 169 (footer) | `text-[10px] text-gray-500` | `text-micro text-gray-500` |

### B9 · `components/weather/SignalsDisclaimer.tsx`

Two sites:

| Line | Before | After |
|---|---|---|
| 32 | `text-sm font-semibold` | `text-body font-semibold` |
| 44 | `text-xs text-gray-400` | `text-caption text-gray-400` |

### B10 · `components/weather/SectionDivider.tsx`

One site:

| Line | Before | After |
|---|---|---|
| 5 | `text-xs font-bold tracking-[0.2em]` | `text-caption font-bold tracking-[0.2em]` |

### B11 · `components/weather/ScrollableCardRow.tsx`

One site:

| Line | Before | After |
|---|---|---|
| 49 | `text-sm font-semibold mb-3` | `text-subhead font-semibold mb-3` |

---

## Commit C · hero + chrome

### C1 · `components/HeroSection.tsx`

Five unique transforms:

```diff
         {/* Eyebrow */}
-        <div className="text-xs font-mono font-semibold uppercase tracking-[0.2em] text-amber-400 mb-5 animate-hero-fade-in hero-delay-1">
+        <div className="text-caption font-mono font-semibold uppercase tracking-[0.2em] text-amber-400 mb-5 animate-hero-fade-in hero-delay-1">
           Kardashev · Type I infrastructure
         </div>

         {/* Headline */}
-        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-semibold tracking-tight text-white leading-[1.05] animate-hero-fade-in hero-delay-1">
+        <h1 className="text-display font-semibold tracking-tight text-white animate-hero-fade-in hero-delay-1">
           Every second, millions in solar energy goes{' '}
           <span className="text-amber-400">uncaptured</span>
         </h1>

         {/* Subhead */}
-        <p className="mt-6 text-xl lg:text-2xl text-gray-300 max-w-xl leading-relaxed animate-hero-fade-in hero-delay-2">
+        <p className="mt-6 text-subhead text-gray-300 max-w-xl animate-hero-fade-in hero-delay-2">
           See how much energy is hitting your location right now ...
         </p>

         {/* Feature card titles × 3 (lines 125, 138, 151) */}
-        <h3 className="text-lg font-semibold text-white mb-2">
+        <h3 className="text-subhead font-semibold text-white mb-2">

         {/* Feature card bodies × 3 (lines 126, 139, 152) */}
-        <p className="text-sm text-gray-400 leading-relaxed">
+        <p className="text-body text-gray-400">
```

> The hero subhead drops from 20→24px (`text-xl lg:text-2xl`) to a flat 18px (`text-subhead`). The headline-to-subhead ratio goes from 2.5× to 3.3× — more dramatic, more "Stripe-coded". If after merge it reads as too small, the override is a single class: `lg:text-[22px]`.

> Headline drops `leading-[1.05]` — already in the token. Drops `sm:text-5xl lg:text-6xl` — clamp() handles responsive.

### C2 · `components/Layout.tsx`

Four sites:

| Line | Before | After |
|---|---|---|
| 212 (footer wordmark) | `text-lg font-semibold tracking-tight` | `text-subhead font-semibold tracking-tight` |
| 218 (footer tagline) | `text-sm text-gray-400` | `text-body text-gray-400` |
| 223 (footer nav) | `text-xs text-gray-400` | `text-caption text-gray-400` |
| 265 (copyright stamp) | `text-[10px] tracking-[0.2em]` | `text-micro tracking-[0.2em]` |

### C3 · `components/PaymentGate.tsx`

Eighteen sites. Modal-heavy file. The four key ones first, then a table.

```diff
       {/* Modal title */}
-      <h3 id={titleId} className="text-xl font-bold text-white">Unlock Premium</h3>
+      <h3 id={titleId} className="text-subhead font-bold text-white">Unlock Premium</h3>
-      <p className="text-sm text-gray-400 mt-2 max-w-xs mx-auto">{description}</p>
+      <p className="text-body text-gray-400 mt-2 max-w-xs mx-auto">{description}</p>

       {/* Price */}
-      <span className="text-3xl font-bold text-white">${price}</span>
+      <span className="text-headline font-bold text-white font-mono">${price}</span>
-      <span className="text-sm text-gray-400 ml-2">USDC</span>
+      <span className="text-body text-gray-400 ml-2">USDC</span>
```

Remaining sites — apply the standard mapping:

| Line(s) | Before | After |
|---|---|---|
| 176, 207, 234, 253, 255, 279, 305, 331, 383, 427 | `text-sm` | `text-body` |
| 181, 191 (chain buttons) | `text-xs font-medium` | `text-caption font-medium` |
| 214 (explainer) | `text-xs text-gray-400` | `text-caption text-gray-400` |
| 260, 268 (helper links) | `text-xs` | `text-caption` |
| 299 (`!text-base`) | `!text-base` | `!text-body` |
| 393 (footer) | `text-xs text-gray-500` | `text-caption text-gray-500` |

> Drop `leading-relaxed` on line 214 — `text-caption` ships line-height baked in.

### C4 · `components/WalletSelector.tsx`

Eleven sites. All standard mapping:

- All `text-sm` (including `!text-sm`) → `text-body` (or `!text-body`)
- All `text-xs` → `text-caption`
- `!text-base` → `!text-body`

The "Active" labels (lines 176, 187) become `ml-auto text-amber-500 text-caption` — flag for the amber budget audit later if they violate the 2-per-card rule (probably fine, dropdowns aren't cards).

---

## Commit D · cleanup

### D1 · `components/weather/CitySelector.tsx`

Two sites. The responsive size collapses to flat `text-body`:

```diff
   // Line 66
-   <Listbox.Options className="absolute z-10 mt-2 max-h-96 w-56 overflow-auto rounded-lg bg-[#0a0a0a] border border-gray-700/50 shadow-lg py-1 text-base focus:outline-none sm:text-sm">
+   <Listbox.Options className="absolute z-10 mt-2 max-h-96 w-56 overflow-auto rounded-lg bg-[#0a0a0a] border border-gray-700/50 shadow-lg py-1 text-body focus:outline-none">

   // Line 130
-   <Listbox.Options className="absolute z-10 mt-2 max-h-96 w-full overflow-auto rounded-lg bg-gray-900 border border-gray-700/50 shadow-lg py-1 text-base focus:outline-none sm:text-sm">
+   <Listbox.Options className="absolute z-10 mt-2 max-h-96 w-full overflow-auto rounded-lg bg-gray-900 border border-gray-700/50 shadow-lg py-1 text-body focus:outline-none">
```

> Dropping `text-base sm:text-sm` to flat `text-body`. The dropdown list renders at 14px on all viewports. **Check mobile Safari doesn't auto-zoom** — should be fine since these are list rows, not inputs.

### D2 · Audit `leading-*` utilities

The new tokens ship line-height. Many `leading-relaxed` / `leading-snug` / `leading-tight` / `leading-[N]` utilities are now redundant — and worse, they OVERRIDE the token's built-in line-height.

```bash
rg 'leading-(relaxed|snug|tight|none|loose|\[)' components/
```

For each hit: decide if the line-height override is intentional. If it was paired with an old size class to fix a default that the new token already handles, **delete the leading utility**. Examples:

- `text-sm leading-relaxed` → `text-body` (token already gives 21px / 1.5)
- `text-xs leading-relaxed` → `text-caption` (already 18px / 1.5)
- `leading-[1.05]` on `text-6xl` headline → token already gives 1.05

Keep `leading-*` utilities only where they're genuinely overriding the token (e.g. `text-headline leading-none` for a very tight metric display).

### D3 · Final verification

Run the grep set from `README.md`. All zero-hit conditions should hold. If any old size class slipped through, find and fix.

---

## After-merge spot-check

- [ ] `/dashboard` — WeatherHeroCard source weights bar reads at 11px (text-micro), labels visibly above WCAG floor
- [ ] `/dashboard` — Temperature value renders in mono at 32px (text-headline)
- [ ] `/weather-forecast` — Temperature graph axis labels visibly bumped from 9px → 11px
- [ ] `/` — Hero headline scales smoothly via clamp from 360px to 1920px viewport
- [ ] `/` — Hero subhead reads at 18px; pairs cleanly with the headline
- [ ] PaymentGate modal — "Unlock Premium" h3 at 18px, price at 32px in mono
- [ ] All card titles in the app render at 18px (text-subhead). Visual consistency across components.
