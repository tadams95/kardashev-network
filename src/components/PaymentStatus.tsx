// Payment status indicators for x402 transactions

interface PaymentStatusProps {
  status: 'idle' | 'pending' | 'success' | 'error'
  message?: string
}

export default function PaymentStatus({ status, message }: PaymentStatusProps) {
  if (status === 'idle') return null

  const config = {
    pending: {
      bg: 'bg-yellow-900/20',
      border: 'border-yellow-700/50',
      text: 'text-yellow-400',
      iconBg: 'bg-yellow-500/20',
      icon: (
        <div className="w-5 h-5 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />
      ),
      defaultMessage: 'Processing payment...',
    },
    success: {
      bg: 'bg-amber-900/20',
      border: 'border-amber-800/50',
      text: 'text-amber-500',
      iconBg: 'bg-amber-600/20',
      icon: (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
            clipRule="evenodd"
          />
        </svg>
      ),
      defaultMessage: 'Payment successful',
    },
    error: {
      bg: 'bg-red-900/20',
      border: 'border-red-700/50',
      text: 'text-red-400',
      iconBg: 'bg-red-500/20',
      icon: (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
            clipRule="evenodd"
          />
        </svg>
      ),
      defaultMessage: 'Payment failed',
    },
  }

  const { bg, border, text, iconBg, icon, defaultMessage } = config[status]

  return (
    <div className={`${bg} ${border} border rounded-card p-button-lg flex items-center gap-3`}>
      <div className={`${iconBg} ${text} p-2 rounded-inner`}>{icon}</div>
      <span className={`text-body font-medium ${text}`}>{message || defaultMessage}</span>
    </div>
  )
}

// Tier badge showing free vs premium
export function TierBadge({ isPremium, isCached }: { isPremium: boolean; isCached?: boolean }) {
  if (isPremium) {
    return (
      <span className="inline-flex items-center gap-1 p-chip bg-amber-600/10 border border-amber-600/20 rounded-chip text-caption font-medium text-amber-500 uppercase tracking-wide">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
        Live
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1 p-chip bg-surface-nested border border-white/[0.06] rounded-chip text-caption font-medium text-gray-500 uppercase tracking-wide">
      <span className="w-1.5 h-1.5 rounded-full bg-gray-500" />
      {isCached ? 'Cached' : 'Free'}
    </span>
  )
}
