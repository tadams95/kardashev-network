// components/KardashevDialOverlay.tsx
//
// Pure SVG. No state, no JS, no animation. Sits absolutely over the R3F
// canvas in HeroSection with `pointer-events: none` so drag-to-rotate and
// cursor-deflection on the sun continue to work.
//
// Three concentric rings frame the R3F sun as the dial of a Kardashev
// scale (the brand name's source). A "WE ARE HERE" tick marks Type I —
// where humanity currently operates.
//
// Tuning notes for whoever inherits this:
//   - Ring radii (60 / 82 / 105) are in SVG units against a viewBox of
//     -120..120. The inner ring should sit JUST outside the visible R3F
//     sun. If the sun is bigger/smaller than expected, scale all three
//     radii together to preserve the 1 : 1.37 : 1.75 ratio.
//   - Labels are diagonally offset (3 o'clock, 1:30, 12 o'clock) so each
//     unambiguously belongs to its ring without crowding the right side.
//   - Font family must match the rest of the app's mono stack (Geist Mono).

interface KardashevDialOverlayProps {
  className?: string;
}

export default function KardashevDialOverlay({
  className = '',
}: KardashevDialOverlayProps) {
  return (
    <svg
      viewBox="-120 -120 240 240"
      className={`absolute inset-0 w-full h-full pointer-events-none ${className}`}
      aria-hidden="true"
    >
      {/* THREE CONCENTRIC SCALE ARCS
          Each step out is a Kardashev type boundary. Stroke opacity decays
          outward (Type III is faintest); the dash pattern hardens the
          "we measure here, theoretical there" hierarchy.

          NOTE: r=60/82/105 are tuned against SolarGlobeScene's R3F camera
          (position.z=5, fov=45°) and SolarGlobe scale=1.8. If you change
          any of those in components/three/, scale these three radii
          together to preserve the 1 : 1.37 : 1.75 ratio. */}
      {[
        { r: 60, opacity: 0.35, dash: '0' },     // Type I
        { r: 82, opacity: 0.27, dash: '2 2' },   // Type II
        { r: 105, opacity: 0.19, dash: '1 3' },  // Type III
      ].map(({ r, opacity, dash }) => (
        <circle
          key={r}
          cx="0"
          cy="0"
          r={r}
          fill="none"
          stroke="#f59e0b"
          strokeWidth="0.6"
          strokeOpacity={opacity}
          strokeDasharray={dash}
        />
      ))}

      {/* 12 TICKS on the Type I (inner) ring — instrument detail */}
      {Array.from({ length: 12 }).map((_, i) => {
        const angle = (i * 30 * Math.PI) / 180;
        return (
          <line
            key={i}
            x1={Math.cos(angle) * 58}
            y1={Math.sin(angle) * 58}
            x2={Math.cos(angle) * 62}
            y2={Math.sin(angle) * 62}
            stroke="#f59e0b"
            strokeWidth="0.6"
            strokeOpacity="0.45"
          />
        );
      })}

      {/* TYPE I cluster — 3 o'clock, anchored to the "WE ARE HERE" locator
          dot. Three-line stack reading top-to-bottom:
            eyebrow (WE ARE HERE)  ← small, gray
            main label (TYPE I)    ← big, amber, anchored by leader line
            descriptor (PLANETARY) ← small, gray
          All labels textAnchor=start beginning at x=70 so the entire cluster
          sits clearly outside the sun's bright corona (sun edge at r≈54 in
          viewBox 240; cluster starts at x=70). The horizontal leader meets
          the visual center of TYPE I (which sits at y≈0). */}
      <g fontFamily="'Geist Mono', ui-monospace, monospace">
        <circle cx="60" cy="0" r="2" fill="#fbbf24" />
        <line
          x1="62"
          y1="0"
          x2="68"
          y2="0"
          stroke="#f59e0b"
          strokeWidth="0.4"
          strokeOpacity="0.55"
        />
        <text x="70" y="-5" fontSize="3.6" fill="#9ca3af" letterSpacing="0.4">
          WE ARE HERE
        </text>
        <text x="70" y="3" fontSize="5.5" fill="#fbbf24" letterSpacing="0.8">
          TYPE I
        </text>
        <text x="70" y="10" fontSize="3.6" fill="#9ca3af" letterSpacing="0.4">
          PLANETARY
        </text>
      </g>

      {/* TYPE II — 1:30 position (315° from x-axis), off the middle ring */}
      <g fontFamily="'Geist Mono', ui-monospace, monospace">
        <line
          x1="58"
          y1="-58"
          x2="66"
          y2="-66"
          stroke="#f59e0b"
          strokeWidth="0.4"
          strokeOpacity="0.4"
        />
        <text
          x="68"
          y="-62"
          fontSize="5.5"
          fill="#fbbf24"
          fillOpacity="0.7"
          letterSpacing="0.8"
        >
          TYPE II
        </text>
        <text x="68" y="-56" fontSize="3.6" fill="#6b7280" letterSpacing="0.4">
          STELLAR
        </text>
      </g>

      {/* TYPE III — 12 o'clock, at the top of the outer ring */}
      <g fontFamily="'Geist Mono', ui-monospace, monospace">
        <line
          x1="0"
          y1="-105"
          x2="0"
          y2="-111"
          stroke="#f59e0b"
          strokeWidth="0.4"
          strokeOpacity="0.28"
        />
        <text
          x="0"
          y="-115"
          textAnchor="middle"
          fontSize="5.5"
          fill="#fbbf24"
          fillOpacity="0.45"
          letterSpacing="0.8"
        >
          TYPE III
        </text>
        <text
          x="0"
          y="-110"
          textAnchor="middle"
          fontSize="3.6"
          fill="#4b5563"
          letterSpacing="0.4"
        >
          GALACTIC
        </text>
      </g>

    </svg>
  );
}
