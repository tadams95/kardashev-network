// components/HomeEnergyCard.tsx
//
// Replaces the existing "Uncaptured Today" card in the dashboard left
// column.
//
// Visual: modern shed-roof home silhouette. Amber particles fall from the
// top of the frame. Particles that fall onto the roof flash with an
// expanding ring (captured). Particles that fall outside the roof
// continue to the ground line and fade (uncaptured). The ratio is the
// story; the readout below quantifies it.
//
// Information parity with the old card:
//   - Captured + Uncaptured $/hour (the two stats)
//   - Current rate sublabel
//   - Condition badge (Sunny / Moderate / Cloudy / Heavy)
//   - Cloud cover %
//   - Irradiance range bar (0–1000 W/m²) with a tick at current value
//
// Accessibility:
//   - prefers-reduced-motion: renders a clean static frame (no particles
//     in motion, no flash rings); the still composition still communicates
//     "roof catches some, ground catches the rest" via positioning alone.
//   - aria-label summarizes the captured/uncaptured ratio in plain text.

import { useMemo } from "react";
import Card from "@/components/Card";

// ─── Types ────────────────────────────────────────────────────────────────

export type SolarCondition = "Sunny" | "Moderate" | "Cloudy" | "Heavy";

export interface HomeEnergyCardProps {
  /** Today's captured-energy value in USD. */
  capturedTodayUsd: number;
  /** Today's uncaptured-energy value in USD. */
  uncapturedTodayUsd: number;
  /** Current $/hour rate (e.g., 0.59 → "$0.59/hr"). */
  currentRateUsdPerHour: number;
  /** Condition badge. */
  condition: SolarCondition;
  /** Cloud cover percentage (0–100). */
  cloudCoverPct: number;
  /** Current irradiance, W/m². */
  irradianceNowWm2: number;
  /** Today's peak irradiance so far, W/m². For the range-bar context. */
  peakIrradianceWm2?: number;
  /** City label shown in the header. */
  cityLabel?: string;
  /** Optional opt-out: render a static frame (no animation). */
  staticFrame?: boolean;
}

// ─── Geometry constants ───────────────────────────────────────────────────
//
// viewBox: 0 0 400 280. Modern shed-roof front elevation: single sloped
// roof, horizontal proportions, large picture window, narrow door on the
// right. The slope and proportions are tuned to read as 'contemporary' at
// a glance.
const GEO = {
  width: 400,
  height: 280,
  groundY: 250,

  // Roof — top edge of the visible roof slab (this is where particles land)
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

/**
 * For a given particle x, returns the y of the roof's top edge (where the
 * particle would land), or null if x is outside the roof's footprint.
 */
function roofYAt(x: number): number | null {
  if (x < GEO.roofTopLeftX || x > GEO.roofTopRightX) return null;
  const t = (x - GEO.roofTopLeftX) / (GEO.roofTopRightX - GEO.roofTopLeftX);
  return GEO.roofTopLeftY + t * (GEO.roofTopRightY - GEO.roofTopLeftY);
}

/**
 * 16 particles spread across the frame. Each one's x position is
 * deterministic so the visual is stable across renders.
 */
function makeParticles() {
  // Slight irregularity so it doesn't look like a grid.
  const xs = [14, 38, 68, 92, 124, 154, 178, 204, 228, 258, 282, 310, 332, 358, 384, 188];
  return xs.map((x, i) => {
    const roofY = roofYAt(x);
    const isHit = roofY != null;
    return {
      id: i,
      x,
      isHit,
      targetY: isHit ? roofY - 1 : GEO.groundY,
      dur: 2.4 + ((i * 7) % 5) * 0.18,
      delay: (i * 0.21) % 3.2,
    };
  });
}

// ─── Condition badge color (semantic, NOT amber — see DESIGN_STATE) ──────

const CONDITION_TONE: Record<SolarCondition, string> = {
  Sunny: "text-emerald-400",
  Moderate: "text-amber-400", // edge case: condition IS the model's "right-now" assessment, fits the amber budget
  Cloudy: "text-gray-400",
  Heavy: "text-gray-500",
};

// ─── Component ────────────────────────────────────────────────────────────

export default function HomeEnergyCard({
  capturedTodayUsd,
  uncapturedTodayUsd,
  currentRateUsdPerHour,
  condition,
  cloudCoverPct,
  irradianceNowWm2,
  peakIrradianceWm2 = 1000,
  cityLabel,
  staticFrame = false,
}: HomeEnergyCardProps) {
  const particles = useMemo(makeParticles, []);

  // Tick position on the 0–1000 bar (clamped)
  const irradianceTickPct = Math.max(0, Math.min(100, (irradianceNowWm2 / 1000) * 100));

  const a11yLabel = `Captured $${capturedTodayUsd.toFixed(2)} per hour. Uncaptured $${uncapturedTodayUsd.toFixed(
    2
  )} per hour. Current rate $${currentRateUsdPerHour.toFixed(2)} per hour.`;

  return (
    <Card variant="hero" className="flex flex-col gap-3.5" aria-label={a11yLabel}>
      {/* ─── Header: eyebrow + condition + city ──────────────────────── */}
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2.5">
          <span className="text-micro font-mono uppercase tracking-wider text-gray-500 font-semibold">
            Right Now
          </span>
          <span className={`text-micro font-mono uppercase tracking-wider ${CONDITION_TONE[condition]}`}>
            {condition}
          </span>
          <span className="text-micro font-mono text-gray-500">
            · {Math.round(cloudCoverPct)}% cloud
          </span>
        </div>
        {cityLabel && <span className="text-micro font-mono text-gray-400">{cityLabel}</span>}
      </div>

      {/* ─── The scene ───────────────────────────────────────────────── */}
      <svg
        viewBox={`0 0 ${GEO.width} ${GEO.height}`}
        className="w-full h-auto block motion-reduce:[&_animate]:hidden motion-reduce:[&_animateMotion]:hidden"
        role="img"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="hec-sky" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.05" />
            <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
          </linearGradient>
          <filter id="hec-glow" x="-200%" y="-200%" width="400%" height="400%">
            <feGaussianBlur stdDeviation="1.4" />
          </filter>
        </defs>

        {/* Sky wash — implies the sun is "up there" without drawing it */}
        <rect x="0" y="0" width={GEO.width} height="180" fill="url(#hec-sky)" />

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

        {/* ── Modern shed-roof house ──────────────────────────────── */}
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

          {/* Eave shadow */}
          <line
            x1={GEO.bodyTopLeftX}
            y1={GEO.bodyTopLeftY + 0.5}
            x2={GEO.bodyTopRightX}
            y2={GEO.bodyTopRightY + 0.5}
            stroke="rgba(255,255,255,0.1)"
            strokeWidth="0.5"
          />

          {/* Picture window */}
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
          <rect
            x={GEO.windowLeftX + 0.6}
            y={GEO.windowTopY + 0.6}
            width={GEO.windowRightX - GEO.windowLeftX - 1.2}
            height={GEO.windowBottomY - GEO.windowTopY - 1.2}
            fill="rgba(245,158,11,0.05)"
          />

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

        {/* ── Particles ──────────────────────────────────────────── */}
        {particles.map((p) => (
          <g key={p.id}>
            <circle cx={p.x} cy="0" r="1.6" fill="#fbbf24" filter="url(#hec-glow)">
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
              {staticFrame && (
                // Render the particle in a representative mid-fall position
                <animate
                  attributeName="cy"
                  values={`${p.targetY * 0.6}`}
                  dur="0.001s"
                  fill="freeze"
                />
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

      {/* ─── Captured / Uncaptured stats ─────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3.5 pt-3 border-t border-white/[0.06]">
        <Stat
          label="Captured"
          value={capturedTodayUsd}
          accentClass="text-amber-400"
        />
        <Stat
          label="Uncaptured"
          value={uncapturedTodayUsd}
          accentClass="text-white"
          muted
        />
      </div>

      {/* ─── Current-rate sublabel ───────────────────────────────────── */}
      <div className="text-caption font-mono text-gray-400 -mt-1">
        ${currentRateUsdPerHour.toFixed(2)}/hr right now
      </div>

      {/* ─── Irradiance range bar ────────────────────────────────────── */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between text-micro font-mono">
          <span className="text-gray-500 uppercase tracking-wider">Irradiance</span>
          <span className="text-gray-300">
            {Math.round(irradianceNowWm2)} <span className="text-gray-500">W/m²</span>
          </span>
        </div>
        <div className="relative h-1 rounded-full bg-white/[0.06] overflow-hidden">
          <div
            className="absolute top-0 left-0 h-full bg-amber-500/60 rounded-full"
            style={{ width: `${irradianceTickPct}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-[9px] font-mono text-gray-600">
          <span>0</span>
          <span>{peakIrradianceWm2} W/m²</span>
        </div>
      </div>
    </Card>
  );
}

// ─── Stat sub-component ───────────────────────────────────────────────────

function Stat({
  label,
  value,
  accentClass,
  muted,
}: {
  label: string;
  value: number;
  accentClass: string;
  muted?: boolean;
}) {
  return (
    <div>
      <div className="text-micro font-mono uppercase tracking-wider text-gray-500 font-semibold mb-1.5">
        {label}
      </div>
      <div className="flex items-baseline gap-0.5">
        <span className={`text-micro font-mono ${muted ? "text-gray-500" : "text-gray-500"}`}>$</span>
        <span
          className={`text-headline font-mono font-medium leading-none ${accentClass}`}
          style={{ letterSpacing: "-0.03em" }}
        >
          {value.toFixed(2)}
        </span>
        <span className={`text-micro font-mono ml-0.5 ${muted ? "text-gray-600" : "text-gray-500"}`}>
          /hr
        </span>
      </div>
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────

export function HomeEnergyCardSkeleton() {
  return (
    <Card variant="hero" className="animate-pulse">
      <div className="h-3 w-32 bg-white/[0.06] rounded mb-3.5" />
      <div className="bg-white/[0.04] rounded aspect-[10/7] mb-3.5" />
      <div className="grid grid-cols-2 gap-3.5 pt-3 border-t border-white/[0.06]">
        <div>
          <div className="h-2 w-16 bg-white/[0.06] rounded mb-1.5" />
          <div className="h-7 w-20 bg-white/[0.06] rounded" />
        </div>
        <div>
          <div className="h-2 w-20 bg-white/[0.06] rounded mb-1.5" />
          <div className="h-7 w-20 bg-white/[0.06] rounded" />
        </div>
      </div>
      <div className="h-3 w-32 bg-white/[0.06] rounded mt-2" />
      <div className="h-1 w-full bg-white/[0.06] rounded mt-3" />
    </Card>
  );
}
