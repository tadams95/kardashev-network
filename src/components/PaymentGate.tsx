// PaymentGate component - prompts user to pay for premium features via x402

import { ConnectWallet, Wallet } from '@coinbase/onchainkit/wallet'
import type { X402PaymentRequired } from '@/types/x402'

interface PaymentGateProps {
  paymentRequired: X402PaymentRequired
  onPay: () => void
  onCancel?: () => void
  isPending: boolean
  isSuccess: boolean
  isError: boolean
  error: string | null
  isConnected: boolean
}

export default function PaymentGate({
  paymentRequired,
  onPay,
  onCancel,
  isPending,
  isSuccess,
  isError,
  error,
  isConnected,
}: PaymentGateProps) {
  const payment = paymentRequired.accepts[0]

  if (!payment) {
    return (
      <div className="p-6 bg-red-900/20 border border-red-700/50 rounded-2xl text-red-300">
        No payment method available
      </div>
    )
  }

  const price = payment.maxAmountRequired
  const network = payment.network
  const description = payment.description

  return (
    <div className="bg-[#0a0a0a] border border-gray-700/50 rounded-2xl p-8 max-w-md w-full mx-auto shadow-2xl shadow-black/50 animate-fade-in">
      {/* Close button */}
      {onCancel && (
        <button
          onClick={onCancel}
          className="absolute top-4 right-4 text-gray-500 hover:text-white transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}

      {/* Header */}
      <div className="text-center mb-8">
        <div className="w-16 h-16 bg-gradient-to-br from-amber-600 to-amber-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-amber-600/20">
          <svg
            className="w-8 h-8 text-white"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 10V3L4 14h7v7l9-11h-7z"
            />
          </svg>
        </div>
        <h3 className="text-xl font-bold text-white">Unlock Premium</h3>
        <p className="text-sm text-gray-400 mt-2 max-w-xs mx-auto">{description}</p>
      </div>

      {/* Price Card */}
      <div className="bg-gray-800/50 rounded-xl p-5 mb-6 border border-gray-700/50">
        <div className="flex items-center justify-between mb-4">
          <span className="text-gray-400">Amount</span>
          <div className="text-right">
            <span className="text-3xl font-bold text-white">${price}</span>
            <span className="text-sm text-gray-400 ml-2">USDC</span>
          </div>
        </div>
        <div className="flex items-center justify-between pt-4 border-t border-gray-700/50">
          <span className="text-sm text-gray-400">Network</span>
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center">
              <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="12" r="10" />
              </svg>
            </div>
            <span className="text-sm text-white capitalize">{network.replace('-', ' ')}</span>
          </div>
        </div>
      </div>

      {/* Success State */}
      {isSuccess && (
        <div className="mb-6 p-4 bg-amber-900/20 border border-amber-800/50 rounded-xl">
          <div className="flex items-center gap-3 text-amber-500">
            <div className="w-10 h-10 bg-amber-600/20 rounded-full flex items-center justify-center">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <div>
              <span className="font-semibold block">Payment Settled</span>
              <span className="text-sm text-amber-600/70">Loading premium data...</span>
            </div>
          </div>
        </div>
      )}

      {/* Error State */}
      {isError && error && (
        <div className="mb-6 p-4 bg-red-900/20 border border-red-700/50 rounded-xl">
          <div className="flex items-center gap-3 text-red-400">
            <div className="w-10 h-10 bg-red-500/20 rounded-full flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <span className="text-sm">{error}</span>
          </div>
        </div>
      )}

      {/* Actions */}
      {!isConnected ? (
        <div className="space-y-4">
          <p className="text-sm text-gray-400 text-center">
            Connect your wallet to unlock premium features
          </p>
          <Wallet>
            <ConnectWallet className="!w-full !bg-amber-600 hover:!bg-amber-700 !rounded-xl !py-4 !font-semibold !text-base !justify-center !shadow-lg !shadow-amber-600/20" />
          </Wallet>
        </div>
      ) : (
        <div className="space-y-3">
          <button
            onClick={onPay}
            disabled={isPending || isSuccess}
            className="w-full py-4 px-6 bg-gradient-to-r from-amber-600 to-amber-600 hover:from-amber-700 hover:to-amber-700 disabled:from-gray-600 disabled:to-gray-600 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-all flex items-center justify-center gap-3 shadow-lg shadow-amber-600/20 disabled:shadow-none"
          >
            {isPending ? (
              <>
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>Confirming...</span>
              </>
            ) : isSuccess ? (
              <>
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
                <span>Payment Complete</span>
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                <span>Pay ${price} USDC</span>
              </>
            )}
          </button>

          {onCancel && !isSuccess && (
            <button
              onClick={onCancel}
              disabled={isPending}
              className="w-full py-3 px-4 text-gray-400 hover:text-white transition-colors text-sm font-medium"
            >
              Cancel
            </button>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="mt-6 pt-6 border-t border-gray-800">
        <div className="flex items-center justify-center gap-2 text-xs text-gray-500">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
          <span>Secured by x402 protocol on Base</span>
        </div>
      </div>
    </div>
  )
}

// Compact upgrade banner for inline use
export function UpgradeBanner({
  price,
  description,
  onUpgrade,
}: {
  price: string
  description: string
  onUpgrade: () => void
}) {
  return (
    <div className="bg-gradient-to-r from-amber-900/30 to-amber-900/30 border border-amber-800/50 rounded-xl p-5 flex items-center justify-between gap-4">
      <div className="flex items-center gap-4">
        <div className="p-2 bg-amber-600/20 rounded-lg">
          <svg className="w-6 h-6 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </div>
        <div>
          <p className="font-medium text-white">{description}</p>
          <p className="text-sm text-gray-400">Unlock for ${price} USDC</p>
        </div>
      </div>
      <button
        onClick={onUpgrade}
        className="px-5 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-medium rounded-xl transition-all shadow-lg shadow-amber-600/20 whitespace-nowrap"
      >
        Upgrade
      </button>
    </div>
  )
}
