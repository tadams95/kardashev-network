// components/SolarValueCard.tsx
//
// Replaces components/SolarMeter.tsx.
//
// A Card<hero> showing the current global horizontal irradiance (GHI) value
// in big mono type, framed by a PERFECT BELL CURVE (half-sine wave). The
// curve's shape is identical regardless of weather or location — it's a
// brand signature, not a chart. The sun dot's position along it represents
// time-of-day; the headline number represents the actual GHI.
//
// API is intentionally minimal and a near-superset of the old SolarMeter:
//
//   <SolarValueCard
//     ghi={752}                 // current W/m²
//     peakGhi={1000}            // for the % of peak readout
//     sunrise={isoString}       // ISO date string or Date
//     sunset={isoString}
//     size="md"                 // 'sm' | 'md' | 'lg'  (same as SolarMeter)
//   />
//
// Sites without sunrise/sunset available need a small data plumbing fix —
// every page that renders solar data has these values in the weather
// ensemble response; they just need passing through.

import { useMemo } from 'react';
import Card from '@/components/Card';

// ─── Types ─────────────────────────────────────────────────────────────────

export type SolarValueCardSize = 'sm' | 'md' | 'lg';

export interface SolarValueCardProps {
  ghi: number;
  sunrise: Date | string;
  sunset: Date | string;
  peakGhi?: number;
  size?: SolarValueCardSize;
  /** Render the "Peak X at HH:MM · Sunset HH:MM" footer. Default: true on md/lg. */
  showFooter?: boolean;
  /** Current time override — defaults to new Date() at render. */
  now?: Date;
}

// ─── Size dimensions ───────────────────────────────────────────────────────

const DIMS: Record<SolarValueCardSize, {
  w: number;
  padding: number;
  headline: string;
  label: string;
  arcW: number;
  arcH: number;
}> = {
  sm: { w: 200, padding: 14, headline: 'text-[22px]', label: 'text-micro', arcW: 172, arcH: 58 },
  md: { w: 280, padding: 18, headline: 'text-headline', label: 'text-micro', arcW: 244, arcH: 80 },
  lg: { w: 400, padding: 22, headline: 'text-[44px]', label: 'text-caption', arcW: 356, arcH: 116 },
};

// ─── Component ─────────────────────────────────────────────────────────────

export default function SolarValueCard({
  ghi,
  sunrise,
  sunset,
  peakGhi = 1000,
  size = 'md',
  showFooter,
  now,
}: SolarValueCardProps) {
  const dims = DIMS[size];

  const { currentT, peakOfDayDisplay, sunsetDisplay, currentTimeDisplay, isDaytime } = useMemo(() => {
    const sunriseDate = typeof sunrise === 'string' ? new Date(sunrise) : sunrise;
    const sunsetDate = typeof sunset === 'string' ? new Date(sunset) : sunset;
    const nowDate = now ?? new Date();

    const span = sunsetDate.getTime() - sunriseDate.getTime();
    const t = span > 0 ? (nowDate.getTime() - sunriseDate.getTime()) / span : 0.5;
    const clamped = Math.max(0, Math.min(1, t));
    const day = nowDate >= sunriseDate && nowDate <= sunsetDate;

    const peakTime = new Date(sunriseDate.getTime() + span / 2);
    const fmt = (d: Date) =>
      d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: false });

    return {
      currentT: clamped,
      peakOfDayDisplay: fmt(peakTime),
      sunsetDisplay: fmt(sunsetDate),
      currentTimeDisplay: fmt(nowDate),
      isDaytime: day,
    };
  }, [sunrise, sunset, now]);

  const pctOfPeak = peakGhi > 0 ? Math.round((ghi / peakGhi) * 100) : 0;
  const renderFooter = showFooter ?? size !== 'sm';

  return (
    <Card variant="hero" style={{ width: dims.w, padding: dims.padding }} noPadding className="flex flex-col gap-2.5">
      {/* Top row: "Right Now" eyebrow + current time */}
      <div className="flex items-baseline justify-between">
        <span className="text-micro font-mono uppercase tracking-wider text-gray-500">
          Right Now
        </span>
        <span className="text-micro font-mono text-gray-400">
          {currentTimeDisplay}
        </span>
      </div>

      {/* Headline GHI + % of peak */}
      <div className="flex items-baseline gap-1.5 -mt-0.5">
        <span
          className={`${dims.headline} font-mono font-medium text-amber-400 leading-none`}
          style={{ letterSpacing: '-0.04em' }}
        >
          {ghi}
        </span>
        <span className="text-caption font-mono text-gray-400">W/m²</span>
        <span className="ml-auto text-caption font-mono text-gray-500">
          {pctOfPeak}% of peak
        </span>
      </div>

      {/* The bell curve */}
      <BellCurve
        width={dims.arcW}
        height={dims.arcH}
        currentT={currentT}
        sunriseLabel={typeof sunrise === 'string' ? formatTimeLabel(new Date(sunrise)) : formatTimeLabel(sunrise)}
        sunsetLabel={typeof sunset === 'string' ? formatTimeLabel(new Date(sunset)) : formatTimeLabel(sunset)}
        compact={size === 'sm'}
        showSunDot={isDaytime}
      />

      {/* Footer: peak + sunset readouts */}
      {renderFooter && (
        <div className="flex items-baseline gap-3.5 mt-0.5 text-caption font-mono text-gray-500">
          <span>
            Peak <span className="text-white">{peakGhi}</span> at {peakOfDayDisplay}
          </span>
          <span className="text-white/20">·</span>
          <span>Sunset {sunsetDisplay}</span>
        </div>
      )}
    </Card>
  );
}

function formatTimeLabel(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: false });
}

// ─── BellCurve — the brand signature ──────────────────────────────────────
//
// Pure half-sine wave: y = sin(t × π) for t ∈ [0, 1].
//   t = 0 → sunrise (horizon left)
//   t = 0.5 → solar noon (apex)
//   t = 1 → sunset (horizon right)
//
// Identical shape regardless of input data. Only the sun dot's position
// varies. This is INTENTIONAL — the curve is a brand mark, not a chart.

interface BellCurveProps {
  width: number;
  height: number;
  currentT: number;
  sunriseLabel: string;
  sunsetLabel: string;
  compact?: boolean;
  showSunDot?: boolean;
}

function BellCurve({
  width,
  height,
  currentT,
  sunriseLabel,
  sunsetLabel,
  compact = false,
  showSunDot = true,
}: BellCurveProps) {
  const PAD = { top: 6, right: 6, bottom: compact ? 4 : 16, left: 6 };
  const innerW = width - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
  const horizonY = PAD.top + innerH;

  // 80 samples is plenty smooth and stays under SVG-path-complexity heuristics.
  const N = 80;
  const points = Array.from({ length: N + 1 }, (_, i) => {
    const t = i / N;
    return {
      x: PAD.left + t * innerW,
      y: horizonY - Math.sin(t * Math.PI) * (innerH - 4) - 2,
    };
  });

  const stroke = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const area = `${stroke} L ${points[points.length - 1].x} ${horizonY} L ${points[0].x} ${horizonY} Z`;

  const tClamped = Math.max(0, Math.min(1, currentT));
  const sunX = PAD.left + tClamped * innerW;
  const sunY = horizonY - Math.sin(tClamped * Math.PI) * (innerH - 4) - 2;

  // Unique IDs per instance so multiple cards on a page don't share defs.
  const uid = `${width}-${height}-${Math.round(currentT * 1000)}`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-auto block"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`bell-grad-${uid}`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.32" />
          <stop offset="60%" stopColor="#f97316" stopOpacity="0.10" />
          <stop offset="100%" stopColor="#f97316" stopOpacity="0" />
        </linearGradient>
        <filter
          id={`bell-glow-${uid}`}
          x="-100%"
          y="-100%"
          width="300%"
          height="300%"
        >
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Horizon */}
      <line
        x1={PAD.left}
        y1={horizonY}
        x2={width - PAD.right}
        y2={horizonY}
        stroke="rgba(255,255,255,0.18)"
        strokeWidth="1"
        strokeDasharray="3 3"
      />

      {/* Area fill (under the curve) */}
      <path d={area} fill={`url(#bell-grad-${uid})`} />

      {/* Curve stroke */}
      <path
        d={stroke}
        fill="none"
        stroke="#9ca3af"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.55"
      />

      {/* Sun dot — hidden at night */}
      {showSunDot && (
        <g filter={`url(#bell-glow-${uid})`}>
          <circle cx={sunX} cy={sunY} r={compact ? 4 : 5} fill="#f59e0b" />
        </g>
      )}

      {/* Sunrise / sunset labels (only when not compact) */}
      {!compact && (
        <>
          <text
            x={PAD.left + 2}
            y={height - 2}
            className="font-mono fill-gray-500"
            style={{ fontSize: 9 }}
          >
            {sunriseLabel}
          </text>
          <text
            x={width - PAD.right - 2}
            y={height - 2}
            textAnchor="end"
            className="font-mono fill-gray-500"
            style={{ fontSize: 9 }}
          >
            {sunsetLabel}
          </text>
        </>
      )}
    </svg>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────

export function SolarValueCardSkeleton({ size = 'md' }: { size?: SolarValueCardSize }) {
  const dims = DIMS[size];
  return (
    <Card variant="hero" style={{ width: dims.w, padding: dims.padding }} className="animate-pulse">
      <div className="h-3 w-20 bg-white/[0.06] rounded mb-3" />
      <div className="h-9 w-32 bg-white/[0.06] rounded mb-3" />
      <div className="bg-white/[0.04] rounded" style={{ height: dims.arcH }} />
    </Card>
  );
}
