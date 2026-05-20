// components/KardashevIcon.tsx
//
// Brand mark — Direction A · Anchor (concentric: filled core + 2 rings).
// Replaces the v1 mark (radial-gradient core, 8 rotating rays, counter-
// rotating energy arcs, pulsing ring, two pulsing cores).
//
// Motion policy: static by default. Set `pulse` to true ONLY in loading
// states. The outer ring fades when pulse is on; nothing else animates.
//
// Sizes are deliberately unchanged from v1 (sm/md/lg → w-5/w-8/w-12) so
// every existing call site keeps its layout footprint.

interface KardashevIconProps {
  size?: 'sm' | 'md' | 'lg'
  className?: string
  /** Loading-state only. Adds a slow opacity pulse to the outer ring. */
  pulse?: boolean
}

const SIZE_CLASS: Record<NonNullable<KardashevIconProps['size']>, string> = {
  sm: 'w-5 h-5',
  md: 'w-8 h-8',
  lg: 'w-12 h-12',
}

export default function KardashevIcon({
  size = 'md',
  className = '',
  pulse = false,
}: KardashevIconProps) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={`${SIZE_CLASS[size]} ${className}`}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Kardashev Network"
    >
      {/* Outer ring — ghosted orbital. The only element that ever animates. */}
      <circle
        cx="50"
        cy="50"
        r="40"
        fill="none"
        stroke="#f59e0b"
        strokeWidth="2"
        opacity="0.45"
        vectorEffect="non-scaling-stroke"
        className={pulse ? 'animate-pulse' : undefined}
      />

      {/* Inner ring — strong orbital. Holds the mark together at small sizes. */}
      <circle
        cx="50"
        cy="50"
        r="28"
        fill="none"
        stroke="#f59e0b"
        strokeWidth="3"
        opacity="0.9"
        vectorEffect="non-scaling-stroke"
      />

      {/* Core — captured energy. */}
      <circle cx="50" cy="50" r="16" fill="#f59e0b" />
    </svg>
  )
}
