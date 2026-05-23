// HomeEnergyCard — dashboard left-column hero (replaces "Uncaptured Today").
//
// The visual is ambient texture — sunlight falling on a house — not a chart.
// The number above is the data. Animation runs in <Card variant="hero">
// purely to make the card feel alive.
//
// AMBER BUDGET (per docs/DESIGN_STATE.md — max 2 amber elements per card):
//   Slot 1 — particles (data-viz / brand; data lines are amber-eligible)
//   Slot 2 — RESERVED. Held open until the hero number's source $/kWh is
//            location/TOU-aware. Today the cumulative uncaptured-today $ uses
//            a hardcoded US national average ($0.16/kWh) — see
//            docs/ARCHITECTURE_REVIEW.md §3.1 "Solar pipeline · hardcoded
//            $0.16/kWh." When that lands, this slot can amber-ify the hero
//            number and the dashboard's monthly-estimate together.
//
// Animation budget: 8 particles × 2 (cy + opacity) + 3 hit-rings × 2 =
// ~22 looping SMIL animations per card; ~88 at 4 cards open. Tested vs the
// real number, not the earlier 16-particle estimate.
//
// Accessibility:
//   - prefers-reduced-motion freezes particles (no looping animations) via
//     `motion-reduce:[&_animate]:hidden`. Verify pre-merge with DevTools →
//     Rendering → Emulate `prefers-reduced-motion: reduce`.
//   - aria-label on the parent <Card> summarizes the value in plain text;
//     the inner <svg> is aria-hidden (Card carries the semantic label).

import Card from "@/components/Card";

// ─── Types & helpers ──────────────────────────────────────────────────────

export type SolarCondition = "Sunny" | "Moderate" | "Cloudy" | "Heavy";

export interface HomeEnergyCardProps {
  /** Today's uncaptured-energy value in USD (e.g. 1.19). */
  uncapturedTodayUsd: number;
  /** Current rate in USD per hour. */
  currentRateUsdPerHour: number;
  /** Condition badge. Derive from cloudCoverPct via `cloudCoverToCondition`. */
  condition: SolarCondition;
  /** Cloud cover percentage (0–100). */
  cloudCoverPct: number;
  /** Current irradiance, W/m². */
  irradianceNowWm2: number;
  /** Today's peak irradiance so far, W/m². Required — no default; the
   *  dashboard already computes peakGhi from hourly data. */
  peakIrradianceWm2: number;
  /** City label shown in the header (optional). */
  cityLabel?: string;
  /** Opt-out: render a static frame (no particle animation). Reserved for
   *  tests and explicit non-motion contexts; runtime motion-reduce uses CSS. */
  staticFrame?: boolean;
}

/** Map cloud cover % → condition. Thresholds match conventional weather labels. */
export function cloudCoverToCondition(cloudCoverPct: number): SolarCondition {
  if (cloudCoverPct < 25) return "Sunny";
  if (cloudCoverPct < 50) return "Moderate";
  if (cloudCoverPct < 75) return "Cloudy";
  return "Heavy";
}

// ─── Condition palette — semantic, non-amber ──────────────────────────────
// Preserves the information channel without competing with the amber budget.
// QA note: yellow-300 (#fde047) and amber-400 (#fbbf24) are visually
// adjacent. If "Moderate" reads as "weak amber" against the Monthly
// Potential CTA in the same column, swap to text-lime-300 (one-line change).
const CONDITION_TONE: Record<SolarCondition, string> = {
  Sunny: "text-emerald-400",
  Moderate: "text-yellow-300",
  Cloudy: "text-sky-400",
  Heavy: "text-slate-400",
};

// ─── Scene geometry ───────────────────────────────────────────────────────
// viewBox 0 0 400 280. Modern shed-roof front elevation: single sloped roof,
// horizontal proportions, picture window, narrow door on the right.
const GEO = {
  width: 400,
  height: 280,
  groundY: 250,

  // Roof — top edge (where a particle would land)
  roofTopLeftX: 96,
  roofTopLeftY: 138,
  roofTopRightX: 304,
  roofTopRightY: 168,

  // Roof slab — visibly thicker than a line, with eaves
  roofBottomLeftX: 108,
  roofBottomLeftY: 146,
  roofBottomRightX: 292,
  roofBottomRightY: 176,

  // House body — sloped top, flat bottom
  bodyTopLeftX: 108,
  bodyTopLeftY: 146,
  bodyTopRightX: 292,
  bodyTopRightY: 176,
  bodyBottomY: 250,

  // Picture window
  windowLeftX: 122,
  windowRightX: 246,
  windowTopY: 188,
  windowBottomY: 232,

  // Door
  doorLeftX: 258,
  doorRightX: 278,
  doorTopY: 200,
  doorBottomY: 250,
} as const;

/** Roof Y for a given particle x, or null if x is outside the roof footprint. */
function roofYAt(x: number): number | null {
  if (x < GEO.roofTopLeftX || x > GEO.roofTopRightX) return null;
  const t = (x - GEO.roofTopLeftX) / (GEO.roofTopRightX - GEO.roofTopLeftX);
  return GEO.roofTopLeftY + t * (GEO.roofTopRightY - GEO.roofTopLeftY);
}

// 8 particles, deterministic. Module-level (no useMemo — pure with no inputs).
// Reduced from 16 → 8 per v4: ambient texture only needs enough motion to feel
// alive. The hit/miss pattern is *visual variety*, NOT a data claim — see the
// "ambient texture" comment at the top of this file. v3 (data-driven particle
// positions tied to captured/uncaptured ratio) is a separate follow-up.
const PARTICLES = (() => {
  const xs = [24, 80, 130, 178, 222, 270, 318, 372];
  return xs.map((x, i) => {
    const roofY = roofYAt(x);
    const isHit = roofY != null;
    return {
      id: i,
      x,
      isHit,
      targetY: isHit ? roofY - 1 : GEO.groundY,
      dur: 2.4 + ((i * 7) % 5) * 0.18,
      delay: (i * 0.31) % 3.2,
    };
  });
})();

// ─── Component ────────────────────────────────────────────────────────────

export default function HomeEnergyCard({
  uncapturedTodayUsd,
  currentRateUsdPerHour,
  condition,
  cloudCoverPct,
  irradianceNowWm2,
  peakIrradianceWm2,
  cityLabel,
  staticFrame = false,
}: HomeEnergyCardProps) {
  // Position the irradiance tick relative to today's actual peak (not a
  // hardcoded 1000) so cloudy-day readings don't read as artificially small.
  const irradianceTickPct = Math.max(
    0,
    Math.min(100, (irradianceNowWm2 / Math.max(peakIrradianceWm2, 1)) * 100),
  );

  const a11yLabel = `Uncaptured today $${uncapturedTodayUsd.toFixed(
    2,
  )}. Current rate $${currentRateUsdPerHour.toFixed(
    2,
  )} per hour. ${condition}, ${Math.round(cloudCoverPct)} percent cloud cover.`;

  return (
    <Card variant="hero" className="flex flex-col gap-3.5" aria-label={a11yLabel}>
      {/* ─── Header: eyebrow + condition + cloud + optional city ─────── */}
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2.5 min-w-0">
          <span className="text-micro font-mono uppercase tracking-wider text-gray-500 font-semibold">
            Right Now
          </span>
          <span
            className={`text-micro font-mono uppercase tracking-wider ${CONDITION_TONE[condition]}`}
          >
            {condition}
          </span>
          <span className="text-micro font-mono text-gray-500">
            · {Math.round(cloudCoverPct)}% cloud
          </span>
        </div>
        {cityLabel && (
          <span className="text-micro font-mono text-gray-400 truncate max-w-[40%]">
            {cityLabel}
          </span>
        )}
      </div>

      {/* ─── The scene — ambient texture, NOT a chart ────────────────── */}
      <svg
        viewBox={`0 0 ${GEO.width} ${GEO.height}`}
        className="w-full h-auto block motion-reduce:[&_animate]:hidden"
        aria-hidden="true"
      >
        <defs>
          <filter id="hec-glow" x="-200%" y="-200%" width="400%" height="400%">
            <feGaussianBlur stdDeviation="1.4" />
          </filter>
        </defs>

        {/* Ground line */}
        <line
          x1="0"
          y1={GEO.groundY}
          x2={GEO.width}
          y2={GEO.groundY}
          stroke="rgba(255,255,255,0.15)"
          strokeWidth="1"
          strokeDasharray="2 3"
        />

        {/* Modern shed-roof house */}
        <g>
          {/* Body */}
          <path
            d={`M ${GEO.bodyTopLeftX} ${GEO.bodyTopLeftY}
                L ${GEO.bodyTopRightX} ${GEO.bodyTopRightY}
                L ${GEO.bodyTopRightX} ${GEO.bodyBottomY}
                L ${GEO.bodyTopLeftX} ${GEO.bodyBottomY} Z`}
            fill="#0a0a0a"
            stroke="rgba(255,255,255,0.22)"
            strokeWidth="1"
          />

          {/* Roof slab */}
          <path
            d={`M ${GEO.roofTopLeftX} ${GEO.roofTopLeftY}
                L ${GEO.roofTopRightX} ${GEO.roofTopRightY}
                L ${GEO.roofBottomRightX} ${GEO.roofBottomRightY}
                L ${GEO.roofBottomLeftX} ${GEO.roofBottomLeftY} Z`}
            fill="#0d0d0d"
            stroke="rgba(255,255,255,0.28)"
            strokeWidth="1"
          />

          {/* Panel-array hint lines on the roof */}
          {[0.18, 0.36, 0.54, 0.72, 0.9].map((t) => {
            const tx = GEO.roofTopLeftX + t * (GEO.roofTopRightX - GEO.roofTopLeftX);
            const ty = GEO.roofTopLeftY + t * (GEO.roofTopRightY - GEO.roofTopLeftY);
            const bx = GEO.roofBottomLeftX + t * (GEO.roofBottomRightX - GEO.roofBottomLeftX);
            const by = GEO.roofBottomLeftY + t * (GEO.roofBottomRightY - GEO.roofBottomLeftY);
            return (
              <line
                key={t}
                x1={tx}
                y1={ty}
                x2={bx}
                y2={by}
                stroke="rgba(255,255,255,0.12)"
                strokeWidth="0.6"
              />
            );
          })}

          {/* Picture window — no amber glow (per v4 amber budget) */}
          <rect
            x={GEO.windowLeftX}
            y={GEO.windowTopY}
            width={GEO.windowRightX - GEO.windowLeftX}
            height={GEO.windowBottomY - GEO.windowTopY}
            fill="#070707"
            stroke="rgba(255,255,255,0.32)"
            strokeWidth="0.8"
          />
          {[1, 2].map((i) => {
            const x = GEO.windowLeftX + (i / 3) * (GEO.windowRightX - GEO.windowLeftX);
            return (
              <line
                key={i}
                x1={x}
                y1={GEO.windowTopY}
                x2={x}
                y2={GEO.windowBottomY}
                stroke="rgba(255,255,255,0.22)"
                strokeWidth="0.5"
              />
            );
          })}

          {/* Door */}
          <rect
            x={GEO.doorLeftX}
            y={GEO.doorTopY}
            width={GEO.doorRightX - GEO.doorLeftX}
            height={GEO.doorBottomY - GEO.doorTopY}
            fill="#070707"
            stroke="rgba(255,255,255,0.3)"
            strokeWidth="0.8"
          />
          <circle
            cx={GEO.doorRightX - 4}
            cy={(GEO.doorTopY + GEO.doorBottomY) / 2}
            r="0.8"
            fill="rgba(255,255,255,0.45)"
          />
        </g>

        {/* ── Particles (amber budget slot 1 — data viz / brand) ───── */}
        {PARTICLES.map((p) => (
          <g key={p.id}>
            <circle
              cx={p.x}
              cy={staticFrame ? p.targetY * 0.6 : 0}
              r="1.6"
              fill="#fbbf24"
              filter="url(#hec-glow)"
            >
              {!staticFrame && (
                <>
                  <animate
                    attributeName="cy"
                    from="-4"
                    to={p.targetY}
                    dur={`${p.dur}s`}
                    begin={`${p.delay}s`}
                    repeatCount="indefinite"
                  />
                  <animate
                    attributeName="opacity"
                    values={p.isHit ? "0;0.9;0.9;0" : "0;0.9;0.7;0"}
                    keyTimes="0;0.12;0.85;1"
                    dur={`${p.dur}s`}
                    begin={`${p.delay}s`}
                    repeatCount="indefinite"
                  />
                </>
              )}
            </circle>

            {p.isHit && !staticFrame && (
              <circle cx={p.x} cy={p.targetY} r="0" fill="none" stroke="#fbbf24" strokeWidth="1">
                <animate
                  attributeName="r"
                  from="0"
                  to="5"
                  dur="0.5s"
                  begin={`${p.delay + p.dur * 0.86}s`}
                  repeatCount="indefinite"
                />
                <animate
                  attributeName="opacity"
                  from="0.8"
                  to="0"
                  dur="0.5s"
                  begin={`${p.delay + p.dur * 0.86}s`}
                  repeatCount="indefinite"
                />
              </circle>
            )}
          </g>
        ))}
      </svg>

      {/* ─── Hero number — WHITE, NOT AMBER. ───────────────────────────
          AMBER BUDGET SLOT 2 RESERVED — see file header for the gate
          condition. Do NOT change this to text-amber-* without first
          updating the slot-2 comment and DESIGN_STATE.md. */}
      <div className="text-center">
        <div className="text-micro font-mono uppercase tracking-wider text-gray-500 font-semibold mb-1.5">
          Uncaptured Today
        </div>
        <div className="flex items-baseline justify-center gap-1">
          <span className="text-subhead sm:text-headline text-gray-400 font-light">$</span>
          <span className="text-display font-mono font-bold text-white tracking-tight">
            {uncapturedTodayUsd.toFixed(2)}
          </span>
        </div>
        {/* Sublabel — replaces the existing card's pulsing-dot live indicator.
            Particles ARE the liveness now (see file header); a second live
            indicator would be redundant motion. */}
        <div className="mt-1.5 text-caption font-mono text-gray-400">
          ${currentRateUsdPerHour.toFixed(2)}/hr right now
        </div>
      </div>

      {/* ─── Irradiance range bar (neutral fill — not amber per v4) ──── */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between text-micro font-mono">
          <span className="text-gray-500 uppercase tracking-wider">Irradiance</span>
          <span className="text-gray-300">
            {Math.round(irradianceNowWm2)} <span className="text-gray-500">W/m²</span>
          </span>
        </div>
        <div className="relative h-1 rounded-full bg-white/[0.06] overflow-hidden">
          <div
            className="absolute top-0 left-0 h-full bg-white/30 rounded-full"
            style={{ width: `${irradianceTickPct}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-micro font-mono text-gray-600">
          <span>0</span>
          <span>{Math.round(peakIrradianceWm2)} W/m²</span>
        </div>
      </div>
    </Card>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────
// Mirrors the loaded card's footprint to prevent layout jump on data arrival.

export function HomeEnergyCardSkeleton() {
  return (
    <Card variant="hero" className="animate-pulse flex flex-col gap-3.5">
      <div className="h-3 w-44 bg-white/[0.06] rounded" />
      <div className="bg-white/[0.04] rounded aspect-[10/7]" />
      <div className="flex flex-col items-center gap-2">
        <div className="h-3 w-28 bg-white/[0.06] rounded" />
        <div className="h-12 w-32 bg-white/[0.06] rounded" />
        <div className="h-3 w-36 bg-white/[0.06] rounded" />
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="h-2 w-full bg-white/[0.06] rounded" />
        <div className="h-1 w-full bg-white/[0.06] rounded" />
      </div>
    </Card>
  );
}
