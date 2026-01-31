interface KardashevIconProps {
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

export default function KardashevIcon({ size = 'md', className = '' }: KardashevIconProps) {
  const sizeClasses = {
    sm: 'w-5 h-5',
    md: 'w-8 h-8',
    lg: 'w-12 h-12',
  }

  return (
    <svg
      viewBox="0 0 100 100"
      className={`${sizeClasses[size]} ${className}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        {/* Gradient for the core */}
        <radialGradient id="coreGradient" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fde047" />
          <stop offset="50%" stopColor="#22c55e" />
          <stop offset="100%" stopColor="#059669" />
        </radialGradient>

        {/* Gradient for rays */}
        <linearGradient id="rayGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#22c55e" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#fde047" stopOpacity="0.2" />
        </linearGradient>

        {/* Glow filter */}
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Outer rotating rays */}
      <g className="animate-spin-slow origin-center" style={{ transformOrigin: '50px 50px' }}>
        {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
          <line
            key={angle}
            x1="50"
            y1="15"
            x2="50"
            y2="25"
            stroke="url(#rayGradient)"
            strokeWidth="3"
            strokeLinecap="round"
            transform={`rotate(${angle} 50 50)`}
            className="opacity-60"
          />
        ))}
      </g>

      {/* Middle pulsing ring */}
      <circle
        cx="50"
        cy="50"
        r="28"
        fill="none"
        stroke="#22c55e"
        strokeWidth="1.5"
        className="animate-pulse opacity-40"
      />

      {/* Energy arcs - counter-rotating */}
      <g className="animate-spin-reverse origin-center" style={{ transformOrigin: '50px 50px' }}>
        <path
          d="M 50 22 A 28 28 0 0 1 78 50"
          fill="none"
          stroke="#22c55e"
          strokeWidth="2"
          strokeLinecap="round"
          className="opacity-70"
        />
        <path
          d="M 50 78 A 28 28 0 0 1 22 50"
          fill="none"
          stroke="#22c55e"
          strokeWidth="2"
          strokeLinecap="round"
          className="opacity-70"
        />
      </g>

      {/* Inner core with glow */}
      <circle
        cx="50"
        cy="50"
        r="16"
        fill="url(#coreGradient)"
        filter="url(#glow)"
        className="animate-pulse"
        style={{ animationDuration: '2s' }}
      />

      {/* Central bright point */}
      <circle
        cx="50"
        cy="50"
        r="6"
        fill="#fde047"
        className="animate-pulse"
        style={{ animationDuration: '1.5s' }}
      />
    </svg>
  )
}
