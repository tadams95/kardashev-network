# Migration · per-file diffs

Three commits. Each independently shippable, each verifiable on its own.

---

## Commit A · controls

The active-state cleanup. After this commit, no control state in the app uses amber.

### A1 · `components/Layout.tsx`

#### A1.1 · Desktop nav active link (lines ~63–79)

The most visible change. Active link goes from "amber chip" to "white + hairline underline" — quieter, more infrastructure-coded.

```diff
              return (
                <Link
                  key={item.name}
                  href={item.href}
-                  className={`nav-link-underline text-body font-semibold leading-6 uppercase tracking-wide transition-colors duration-150 hover:text-amber-500 ${
-                    isActive ? "nav-link-active text-amber-500" : "text-white"
-                  }`}
+                  className={`text-body font-semibold leading-6 uppercase tracking-wide transition-colors duration-150 hover:text-gray-300 relative ${
+                    isActive
+                      ? "text-white after:absolute after:-bottom-1.5 after:left-0 after:right-0 after:h-px after:bg-white/70"
+                      : "text-gray-400"
+                  }`}
                  aria-current={isActive ? "page" : undefined}
                >
                  {item.name}
                </Link>
              );
```

> Note: if the existing `nav-link-underline` / `nav-link-active` classes in `globals.css` are unused after this change, remove them too. If they're referenced anywhere else, leave them alone.
>
> Also: the default (non-active) link color drops from `text-white` to `text-gray-400`. This creates clearer contrast between active and inactive — today, inactive links are *brighter* than the active amber, which is backwards.

#### A1.2 · Hamburger button hover (line ~89)

```diff
-              className="md:hidden -m-2.5 inline-flex items-center justify-center h-11 w-11 rounded-inner text-gray-400 transition-all duration-150 hover:scale-110 hover:text-amber-500 active:scale-95"
+              className="md:hidden -m-2.5 inline-flex items-center justify-center h-11 w-11 rounded-inner text-gray-400 transition-all duration-150 hover:scale-110 hover:text-white active:scale-95"
```

#### A1.3 · Mobile menu close button (line ~134)

```diff
-                    className="-m-2.5 h-11 w-11 inline-flex items-center justify-center rounded-inner text-gray-400 transition-all duration-150 hover:scale-110 hover:text-amber-500 active:scale-95"
+                    className="-m-2.5 h-11 w-11 inline-flex items-center justify-center rounded-inner text-gray-400 transition-all duration-150 hover:scale-110 hover:text-white active:scale-95"
```

#### A1.4 · Mobile menu nav links (lines ~159–168)

```diff
                          <Link
                            key={item.name}
                            href={item.href}
                            onClick={handleNavClick}
-                            className={`animate-menu-item-enter -mx-3 block rounded-inner p-button-sm text-title font-semibold leading-7 transition-colors duration-200 hover:bg-gray-900 ${
-                              isActive
-                                ? "bg-gray-900 text-amber-500"
-                                : "text-white"
-                            }`}
+                            className={`animate-menu-item-enter -mx-3 block rounded-inner p-button-sm text-title font-semibold leading-7 transition-colors duration-200 hover:bg-white/[0.06] ${
+                              isActive
+                                ? "bg-white/[0.08] text-white"
+                                : "text-gray-300"
+                            }`}
                            style={{ animationDelay: `${index * 50}ms` }}
                          >
```

---

### A2 · `components/weather/MarketOpportunitiesTable.tsx` — filter & sort pills

Two pill groups in the desktop header (lines ~565–610). Same active-state recipe in both.

#### A2.1 · Market type filter (lines ~565–583)

```diff
             <div className="flex bg-gray-800/50 rounded-lg p-0.5">
               {(['all', 'high', 'low', 'precip'] as const).map((filter) => (
                 <button
                   key={filter}
                   onClick={() => setMarketFilter(filter)}
                   className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                     marketFilter === filter
-                      ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
+                      ? 'bg-white/[0.1] text-white'
                       : 'text-gray-400 hover:text-gray-300'
                   }`}
                 >
```

#### A2.2 · Sort control (lines ~586–610)

```diff
             <div className="flex bg-gray-800/50 rounded-lg p-0.5">
               {(['ev', 'edge', 'probability'] as const).map((sort) => (
                 <button
                   key={sort}
                   onClick={() => { /* … */ }}
                   className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                     sortBy === sort
-                      ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
+                      ? 'bg-white/[0.1] text-white'
                       : 'text-gray-400 hover:text-gray-300'
                   }`}
                 >
```

> **Do NOT change** the Sweet Spot toggle (lines ~545–561). It's green, not amber — and green is the correct semantic ("this signal historically wins"). It also has a count badge that the neutral treatment can't carry as well.

---

### A3 · `components/weather/TemperatureGraph.tsx` — mode toggle

Lines ~508–528. Two buttons, same recipe.

```diff
           <button
             onClick={() => setMode('24h')}
             className={`px-3 py-1 text-xs rounded-md transition-colors ${
               mode === '24h'
-                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
+                ? 'bg-white/[0.1] text-white'
                 : 'text-gray-400 hover:text-gray-300'
             }`}
           >
             24-Hour
           </button>
           <button
             onClick={() => setMode('7day')}
             className={`px-3 py-1 text-xs rounded-md transition-colors ${
               mode === '7day'
-                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
+                ? 'bg-white/[0.1] text-white'
                 : 'text-gray-400 hover:text-gray-300'
             }`}
           >
             7-Day
           </button>
```

---

## Commit B · today/now elevation

Triple-emphasis (fill + border + ring) chips drop to a single elevation step.

### B1 · `components/weather/ForecastCards.tsx` — today chip (lines ~52–93)

```diff
       {dailyForecasts.map((forecast) => {
         const dayLabel = formatDayLabel(forecast.timestamp, timezone)
         const isToday = dayLabel === 'Today'
         return (
         <div
           key={String(forecast.timestamp)}
-          className={`rounded-xl p-3.5 min-w-[110px] flex-shrink-0 transition-colors text-center ${
-            isToday
-              ? 'bg-amber-500/[0.08] border border-amber-500/50 ring-1 ring-amber-500/20'
-              : 'bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06] hover:border-amber-500/30'
-          }`}
+          className={`rounded-xl p-3.5 min-w-[110px] flex-shrink-0 transition-colors text-center ${
+            isToday
+              ? 'bg-surface-hero border border-white/[0.1]'
+              : 'bg-surface-nested border border-white/[0.06] hover:bg-white/[0.06] hover:border-white/[0.12]'
+          }`}
         >
           {/* Day of Week */}
-          <div className={`text-xs mb-1 ${isToday ? 'text-amber-400 font-medium' : 'text-gray-400'}`}>
+          <div className={`text-xs mb-1 font-medium ${isToday ? 'text-white' : 'text-gray-400'}`}>
             {dayLabel}
           </div>
```

### B2 · `components/weather/HourlyForecast.tsx` — current-hour chip (lines ~73–100)

```diff
       {hourlyData.map((data) => (
         <div
           key={`${data.date}-${data.hour}`}
-          className={`${hourlyData.length <= 8 ? 'flex-1 min-w-[90px]' : 'min-w-[110px] flex-shrink-0'} rounded-xl p-3.5 text-center transition-colors ${
-            data.isCurrentHour
-              ? 'bg-amber-500/[0.08] border border-amber-500/50 ring-1 ring-amber-500/20'
-              : 'bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06] hover:border-amber-500/30'
-          }`}
+          className={`${hourlyData.length <= 8 ? 'flex-1 min-w-[90px]' : 'min-w-[110px] flex-shrink-0'} rounded-xl p-3.5 text-center transition-colors ${
+            data.isCurrentHour
+              ? 'bg-surface-hero border border-white/[0.1]'
+              : 'bg-surface-nested border border-white/[0.06] hover:bg-white/[0.06] hover:border-white/[0.12]'
+          }`}
         >
           {/* Hour Label */}
-          <div className={`text-xs font-medium mb-1 ${data.isCurrentHour ? 'text-amber-400' : data.isNextDay ? 'text-blue-400' : 'text-gray-400'}`}>
+          <div className={`text-xs font-medium mb-1 ${data.isCurrentHour ? 'text-white' : data.isNextDay ? 'text-blue-400' : 'text-gray-400'}`}>
             {formatHourLabel(data.hour, data.isCurrentHour, data.isNextDay, tzAbbr)}
           </div>

           {/* Weather Icon */}
           <div className="flex justify-center my-1.5">
             <WeatherIcon weatherCode={data.weatherCode} className="w-7 h-7" />
           </div>

           {/* Temperature */}
-          <div className={`text-lg font-bold mb-1 ${data.isCurrentHour ? 'text-amber-400' : 'text-white'}`}>
+          <div className="text-lg font-bold mb-1 text-white">
             {celsiusToFahrenheit(data.temperature).toFixed(1)}°F
           </div>
```

> "Now" is still the obvious chip thanks to (a) the auto-scroll centering it on mount, and (b) the elevated surface. We don't need it amber too.

---

## Commit C · per-card amber cleanup

The remaining cosmetic amber that doesn't pass the "our call" test.

### C1 · `components/weather/MarketOpportunitiesTable.tsx` — `ForecastBadge` (lines ~50–60)

The badge is redundant — the amber left border on the row already says "this is the forecast bracket." But if you keep the badge for redundancy, drop the amber tint and let it read as a quiet mono caps label.

```diff
 function ForecastBadge({ exact = true }: { exact?: boolean }) {
   return (
-    <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide border ${
-      exact
-        ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
-        : 'bg-amber-500/10 text-amber-400/70 border-amber-500/20'
-    }`}>
+    <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider border font-mono ${
+      exact
+        ? 'text-gray-300 border-white/[0.12]'
+        : 'text-gray-400 border-white/[0.08]'
+    }`}>
       {exact ? 'Forecast' : '~ Forecast'}
     </span>
   );
 }
```

### C2 · `components/weather/MarketOpportunitiesTable.tsx` — actionable row backgrounds

#### Desktop table row (line ~258)

```diff
                   <tr
                     onClick={() => setExpandedRow(isExpanded ? null : opp.market.id)}
                     className={`cursor-pointer transition-colors ${
                       isForecast ? 'border-l-[3px] border-l-amber-400' : ''
                     } ${
                       isActionable
-                        ? 'bg-amber-500/5 hover:bg-amber-500/10'
+                        ? 'bg-white/[0.03] hover:bg-white/[0.05]'
                         : 'hover:bg-gray-800/30'
                     }`}
                   >
```

#### Mobile bracket row (line ~144)

```diff
-    <div className={`border-b border-gray-700/30 ${isForecast ? 'border-l-[3px] border-l-amber-400' : ''} ${isActionable ? 'bg-amber-500/5' : ''}`}>
+    <div className={`border-b border-gray-700/30 ${isForecast ? 'border-l-[3px] border-l-amber-400' : ''} ${isActionable ? 'bg-white/[0.03]' : ''}`}>
```

> The `border-l-amber-400` on actively-forecast brackets **stays** — that's the one element on this row that means "our call".

### C3 · `components/weather/MarketOpportunitiesTable.tsx` — edge value color

Edge is intensity. Use semantic (green / yellow / white) — drop the amber tier.

#### Desktop table (line ~275)

```diff
                     <td className="px-3 py-1.5 text-center">
                       {isActionable ? (
                         <span className={`text-sm font-semibold ${
                           opp.edge >= 0.15 ? 'text-green-400' :
                           opp.edge >= 0.10 ? 'text-yellow-400' :
-                          'text-amber-400'
+                          'text-white'
                         }`}>
                           {edgeDirection} {(opp.edge * 100).toFixed(1)}%
                         </span>
```

#### Mobile bracket (line ~165)

```diff
           {isActionable ? (
-            <span className={`font-semibold ${opp.edge >= 0.15 ? 'text-green-400' : opp.edge >= 0.10 ? 'text-yellow-400' : 'text-amber-400'}`}>
+            <span className={`font-semibold ${opp.edge >= 0.15 ? 'text-green-400' : opp.edge >= 0.10 ? 'text-yellow-400' : 'text-white'}`}>
               {edgeDirection} {(opp.edge * 100).toFixed(1)}%
             </span>
```

#### FlatTable (line ~395)

```diff
                 <td className="px-4 py-3 text-center">
                   <span className={`text-sm font-semibold ${
                     opp.edge >= 0.15 ? 'text-green-400' :
                     opp.edge >= 0.10 ? 'text-yellow-400' :
-                    'text-gray-400'
+                    'text-gray-400'
                   }`}>
                     {(opp.edge * 100).toFixed(1)}%
                   </span>
```

> The FlatTable's `<5%` tier is already `text-gray-400` — no change. The amber tier in EventCard was the only place using amber for edge intensity. Now removed.

### C4 · `components/weather/MarketOpportunitiesTable.tsx` — footer callouts

#### Forecast bracket footer (line ~302)

```diff
       {group.forecastBracketIndex !== null && (
         <div className="px-3 py-2 bg-gray-900/30 border-t border-gray-700/30 text-xs text-gray-400">
-          <span className="text-amber-400 font-semibold">Forecast bracket:</span>{' '}
+          <span className="text-[10px] uppercase tracking-wider text-gray-500 font-mono mr-1.5">Forecast bracket</span>
           {group.brackets[group.forecastBracketIndex].market.outcome}{' '}
           @ {(group.brackets[group.forecastBracketIndex].marketPrice * 100).toFixed(0)}&cent;
         </div>
       )}
```

#### Best edge footer (line ~311)

```diff
       {group.bestEdge && (
         <div className="px-3 py-2 bg-gray-900/30 border-t border-gray-700/30 text-xs text-gray-400">
-          <span className="text-amber-400 font-semibold">Best edge:</span>{' '}
+          <span className="text-[10px] uppercase tracking-wider text-gray-500 font-mono mr-1.5">Best edge</span>
           {group.bestEdge.market.outcome} &middot;{' '}
           <SignalBadge signal={group.bestEdge.signal} />{' '}
           @ {(group.bestEdge.marketPrice * 100).toFixed(0)}&cent; &middot;{' '}
           <span className={group.bestEdge.expectedValue > 0 ? 'text-green-400' : 'text-red-400'}>
             EV {group.bestEdge.expectedValue > 0 ? '+' : ''}${group.bestEdge.expectedValue.toFixed(2)}
           </span>
         </div>
       )}
```

> The shift from `font-semibold` colored prose label to mono-uppercase tracking is the bigger aesthetic win here. It reads as instrument-panel labeling, which is the brand mood.

### C5 · `components/weather/WeatherHeroCard.tsx` — refresh icon (line ~308)

```diff
             <ArrowPathIcon
-              className={`w-4 h-4 text-amber-400 ${isRefreshing ? 'animate-spin' : ''}`}
+              className={`w-4 h-4 text-gray-300 ${isRefreshing ? 'animate-spin' : ''}`}
             />
```

### C6 · `components/weather/WeatherHeroCard.tsx` — Dynamic badge (line ~272)

```diff
              <button
                onClick={() => setShowWeights(!showWeights)}
                className="text-gray-400 hover:text-gray-300 transition-colors w-full text-left"
              >
                Source Weights{' '}
-                <span className={`inline-block text-[9px] px-1.5 py-0.5 rounded-full font-medium ${sourceWeights.isDynamic ? 'bg-amber-500/20 text-amber-400' : 'bg-gray-600/30 text-gray-500'}`}>
+                <span className={`inline-block text-[9px] px-1.5 py-0.5 rounded-full font-medium font-mono uppercase tracking-wider ${sourceWeights.isDynamic ? 'bg-white/[0.08] text-gray-200' : 'bg-gray-600/30 text-gray-500'}`}>
                   {sourceWeights.isDynamic ? 'Dynamic' : 'Static'}
                 </span>
```

> The source-weight **bar fills** (`bg-amber-500/60`, line ~285) **stay amber** — they're data. Big temp value stays amber. Two amber elements in the hero card, which is the budget.

---

## Out of scope for this round

- `HeroSection.tsx` feature-card icons (`bg-amber-900/30 border-amber-700/30 text-amber-500`) — these are one amber element per card, within budget. Leave alone.
- `PaymentGate.tsx` and `WalletSelector.tsx` — both have amber CTAs (correct) and chain-switch UIs that already use neutral for inactive states. Untouched.
- `SolarMeter.tsx` (the radial gauge) — the entire component is a data viz; its colors are intentional. Untouched. (Separate review item: the SolarMeter component itself is flagged for retirement in favor of `SolarCurve`-style chrome, but that's its own deliverable.)
- `TradingStrategiesTable.tsx`, `SourceDetailBreakdown.tsx`, `DataFreshnessIndicator.tsx` — quick grep shows they don't use the active-amber recipe. Spot-check during code review; if any sneak through, add as a follow-up.

---

## After-merge spot-check

Pull up the app on `/trading-readiness` after Commit C. The EventCard you land on should:

- Have exactly **two** amber elements: the model probability column, and the forecast bracket left border.
- The actionable row background should be a subtle neutral tint, not amber.
- The "Forecast bracket:" and "Best edge:" footer callouts should read as `FORECAST BRACKET` in small mono caps, not amber bold.
- The filter/sort pill row above the cards should read in white, not amber.

If any of those still look amber, grep for the recipe and trace which file it slipped through in.
