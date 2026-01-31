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
      bg: 'bg-green-900/20',
      border: 'border-green-700/50',
      text: 'text-green-400',
      iconBg: 'bg-green-500/20',
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
    <div className={`${bg} ${border} border rounded-xl px-4 py-3 flex items-center gap-3`}>
      <div className={`${iconBg} ${text} p-2 rounded-lg`}>{icon}</div>
      <span className={`text-sm font-medium ${text}`}>{message || defaultMessage}</span>
    </div>
  )
}

// Tier badge showing free vs premium
export function TierBadge({ isPremium, isCached }: { isPremium: boolean; isCached?: boolean }) {
  if (isPremium) {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-gradient-to-r from-green-500/20 to-emerald-500/20 border border-green-500/30 rounded-full text-xs font-medium text-green-400">
        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M5 2a1 1 0 011 1v1h1a1 1 0 010 2H6v1a1 1 0 01-2 0V6H3a1 1 0 010-2h1V3a1 1 0 011-1zm0 10a1 1 0 011 1v1h1a1 1 0 110 2H6v1a1 1 0 11-2 0v-1H3a1 1 0 110-2h1v-1a1 1 0 011-1zM12 2a1 1 0 01.967.744L14.146 7.2 17.5 9.134a1 1 0 010 1.732l-3.354 1.935-1.18 4.455a1 1 0 01-1.933 0L9.854 12.8 6.5 10.866a1 1 0 010-1.732l3.354-1.935 1.18-4.455A1 1 0 0112 2z"
            clipRule="evenodd"
          />
        </svg>
        Premium
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-gray-800/50 border border-gray-700/50 rounded-full text-xs font-medium text-gray-400">
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      Free{isCached && ' (cached)'}
    </span>
  )
}

// Inline upgrade prompt
export function InlineUpgradePrompt({
  onUpgrade,
  price = '0.001',
}: {
  onUpgrade: () => void
  price?: string
}) {
  return (
    <button
      onClick={onUpgrade}
      className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-500 rounded-xl text-sm font-medium text-white transition-all shadow-lg shadow-green-500/20 hover:shadow-green-500/30"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M13 10V3L4 14h7v7l9-11h-7z"
        />
      </svg>
      Upgrade ${price}
    </button>
  )
}
