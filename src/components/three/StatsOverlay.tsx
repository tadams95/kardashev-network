// Stats overlay that appears when clicking the sun

interface StatsOverlayProps {
  isVisible: boolean
  ghi: number
  currentValue: number // $/hour
  onClose: () => void
}

export default function StatsOverlay({
  isVisible,
  ghi,
  currentValue,
  onClose,
}: StatsOverlayProps) {
  if (!isVisible) return null

  return (
    <div
      className="absolute inset-0 flex items-center justify-center pointer-events-none z-10"
      style={{
        animation: 'fadeIn 0.3s ease-out',
      }}
    >
      {/* Backdrop for click-to-close */}
      <div
        className="absolute inset-0 pointer-events-auto"
        onClick={onClose}
      />

      {/* Stats card */}
      <div
        className="relative bg-black/80 backdrop-blur-md border border-yellow-500/30 rounded-2xl p-6 pointer-events-auto shadow-2xl shadow-yellow-500/20"
        style={{
          animation: 'scaleIn 0.3s ease-out',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-gray-400 hover:text-white transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Content */}
        <div className="text-center space-y-4">
          {/* Irradiance */}
          <div>
            <div className="text-4xl font-bold text-yellow-400">
              {Math.round(ghi)} <span className="text-lg font-normal">W/m²</span>
            </div>
            <div className="text-sm text-gray-400 mt-1">
              hitting this location right now
            </div>
          </div>

          {/* Divider */}
          <div className="w-16 h-px bg-gradient-to-r from-transparent via-yellow-500/50 to-transparent mx-auto" />

          {/* Value */}
          <div>
            <div className="text-3xl font-bold text-cyan-500">
              ${currentValue.toFixed(2)}
              <span className="text-lg font-normal text-gray-400">/hr</span>
            </div>
            <div className="text-sm text-gray-400 mt-1">
              uncaptured energy value
            </div>
          </div>

          {/* Pulse indicator */}
          <div className="flex items-center justify-center gap-2 text-xs text-yellow-500/70">
            <span className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse" />
            Live solar data
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        @keyframes scaleIn {
          from {
            opacity: 0;
            transform: scale(0.9);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
      `}</style>
    </div>
  )
}
