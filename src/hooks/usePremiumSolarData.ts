import { useState, useCallback, useEffect, useMemo } from 'react'
import useSWR from 'swr'
import { wrapFetchWithPayment } from 'x402-fetch'
import { selectPaymentRequirements } from 'x402/client'
import { settleResponseFromHeader } from 'x402/types'
import { useMultiChainX402 } from './useMultiChainX402'
import type { ChainType } from './useMultiChainX402'
import { calculateWastedValueFromData } from '@/lib/calculations/solarValue'
import { X402_PRICING } from '@/lib/x402/config'
import type { SolarData, SolarApiResponse, WastedEnergy } from '@/types/solar'
import type { X402PaymentRequired } from '@/types/x402'

interface UsePremiumSolarDataReturn {
  solarData: SolarData | undefined
  wastedEnergy: WastedEnergy | undefined
  isLoading: boolean
  isError: boolean
  error: Error | undefined
  isPremium: boolean
  isCached: boolean
  paymentRequired: X402PaymentRequired | null
  showPaymentGate: boolean
  setShowPaymentGate: (show: boolean) => void
  initiatePayment: () => Promise<string | null>
  paymentState: {
    isPending: boolean
    isSuccess: boolean
    isError: boolean
    error: string | null
    txHash: string | null
  }
  refresh: () => void
  upgradeToPremium: () => void
  isWrongChain: boolean
  switchToCorrectChain: () => void
  isSwitchingChain: boolean
  requiredChainName: string
  activeChainType: ChainType
  preferredChain: ChainType
  setPreferredChain: (chain: ChainType) => void
  getExplorerTxUrl: (txHash: string) => string
  isConnected: boolean
  signerReady: boolean
  evmConnected: boolean
  solConnected: boolean
}

export function usePremiumSolarData(
  lat: number | null | undefined,
  lng: number | null | undefined,
  roofAreaM2?: number,
  electricityRate?: number,
  yearlySavings?: number,
): UsePremiumSolarDataReturn {
  const [isPremium, setIsPremium] = useState(false)
  const [showPaymentGate, setShowPaymentGate] = useState(false)

  const {
    activeChainType,
    preferredChain,
    setPreferredChain,
    isConnected,
    activeSigner,
    activeAddress,
    paymentState,
    setPaymentState,
    isWrongChain,
    switchToCorrectChain,
    isSwitchingChain,
    requiredChainName,
    x402FetchConfig,
    getExplorerTxUrl,
    evm,
    sol,
  } = useMultiChainX402()

  const solarPricing = X402_PRICING['/api/solar/irradiance']
  const priceAmount = solarPricing?.price.replace('$', '') || '0.001'
  const desc = solarPricing?.description || 'Real-time solar irradiance data'
  const evmNetwork = process.env.NEXT_PUBLIC_X402_NETWORK || 'base-sepolia'
  const solNetwork = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'solana-devnet'
  const defaultPaymentRequired = useMemo<X402PaymentRequired>(() => ({
    x402Version: 1,
    accepts: [
      {
        scheme: 'exact',
        network: evmNetwork,
        maxAmountRequired: priceAmount,
        resource: '/api/solar/irradiance',
        description: desc,
        mimeType: 'application/json',
        payTo: '',
        maxTimeoutSeconds: 300,
        asset: 'USDC',
      },
      {
        scheme: 'exact',
        network: solNetwork,
        maxAmountRequired: priceAmount,
        resource: '/api/solar/irradiance',
        description: desc,
        mimeType: 'application/json',
        payTo: '',
        maxTimeoutSeconds: 300,
        asset: 'USDC',
      },
    ],
  }), [priceAmount, desc, evmNetwork, solNetwork])

  const shouldFetch = lat != null && lng != null && !isNaN(lat) && !isNaN(lng)
  const baseUrl = shouldFetch ? `/api/solar/irradiance?lat=${lat}&lng=${lng}` : null

  // Include wallet address in SWR key so session-aware refetches work
  // Send it whenever connected (not just when isPremium) so the backend can
  // recognise existing sessions after page reload
  const swrKey = shouldFetch
    ? activeAddress
      ? `${baseUrl}&session=${activeAddress}`
      : baseUrl
    : null

  // SWR fetcher — always includes X-Wallet-Address when a wallet is connected
  // so the backend can match existing payment sessions (survives page refresh)
  const fetcher = useCallback(async (url: string): Promise<SolarApiResponse> => {
    // Strip session param from URL before fetching
    const fetchUrl = url.replace(/&session=[a-zA-Z0-9]+$/, '')
    const headers: Record<string, string> = {}
    if (activeAddress) {
      headers['X-Wallet-Address'] = activeAddress
    }
    const res = await fetch(fetchUrl, { headers })
    if (!res.ok && res.status !== 402) {
      throw new Error('Failed to fetch solar data')
    }
    return res.json()
  }, [activeAddress])

  const { data, error, isLoading, mutate } = useSWR<SolarApiResponse>(
    swrKey,
    fetcher,
    {
      refreshInterval: isPremium ? 0 : 300000,
      revalidateOnFocus: false,
    }
  )

  // Auto-detect premium data from backend session recognition (survives page refresh).
  // The backend sets an explicit `premium` flag on premium responses.
  useEffect(() => {
    if (!isPremium && data?.premium) {
      setIsPremium(true)
    }
  }, [data, isPremium])

  // Reset premium state when wallet disconnects
  useEffect(() => {
    if (!activeAddress) {
      setIsPremium(false)
    }
  }, [activeAddress])

  const wastedEnergy = data?.data
    ? calculateWastedValueFromData(data.data, roofAreaM2, !!roofAreaM2, electricityRate)
    : undefined

  // When Google Solar yearly savings is available, anchor monthly estimate to it
  // instead of extrapolating from today's irradiance (which overestimates on sunny days)
  if (wastedEnergy && yearlySavings) {
    wastedEnergy.monthlyEstimate = Math.round(yearlySavings / 12)
  }

  // Premium upgrade via x402-fetch
  const initiatePayment = useCallback(async () => {
    if (!activeSigner || !baseUrl) {
      if (process.env.NODE_ENV === 'development') {
        console.error('[x402] initiatePayment aborted: signer=%o, baseUrl=%s', activeSigner, baseUrl)
      }
      setPaymentState({
        isPending: false,
        isSuccess: false,
        isError: true,
        error: !activeSigner
          ? 'Wallet not ready — try disconnecting and reconnecting'
          : 'Location not set',
        txHash: null,
      })
      return null
    }

    setPaymentState({
      isPending: true,
      isSuccess: false,
      isError: false,
      error: null,
      txHash: null,
    })

    try {
      if (process.env.NODE_ENV === 'development') {
        console.log('[x402] initiatePayment: url=%s, address=%s, chain=%s', baseUrl, activeAddress, activeChainType)
      }

      const premiumFetch = wrapFetchWithPayment(
        fetch,
        activeSigner as Parameters<typeof wrapFetchWithPayment>[1],
        undefined,
        (requirements, network, scheme) => {
          const filtered = requirements.filter(r =>
            activeChainType === 'svm'
              ? r.network.startsWith('solana')
              : !r.network.startsWith('solana')
          )
          return selectPaymentRequirements(
            filtered.length > 0 ? filtered : requirements,
            network,
            scheme
          )
        },
        x402FetchConfig
      )
      const response = await premiumFetch(baseUrl, {
        headers: {
          'X-Request-Premium': 'true',
          'X-Wallet-Address': activeAddress!,
        },
      })

      // x402-fetch does NOT throw on facilitator failures — it returns the 402 response.
      // We must check response.ok to catch verify/settle failures.
      if (!response.ok) {
        const errorBody = await response.json().catch(() => null)
        if (process.env.NODE_ENV === 'development') {
          console.error('[x402] payment response error body:', errorBody)
          console.error('[x402] response status:', response.status, response.statusText)
        }
        const reason = errorBody?.error || `Payment failed (${response.status})`
        const settlement = errorBody?.settlement || null

        const err = new Error(typeof reason === 'string' ? reason : JSON.stringify(reason))
        ;(err as any).settlement = settlement
        ;(err as any).statusCode = response.status
        throw err
      }

      const result: SolarApiResponse = await response.json()

      // Extract tx hash from settlement response header
      const paymentResponseHeader = response.headers.get('x-payment-response')
      if (process.env.NODE_ENV === 'development') {
        console.log('[x402] payment response status:', response.status)
        console.log('[x402] x-payment-response header:', paymentResponseHeader)
      }
      let txHash: string | null = null
      if (paymentResponseHeader) {
        try {
          const settlement = settleResponseFromHeader(paymentResponseHeader)
          txHash = settlement.transaction || null
        } catch {
          // Fallback: try JSON parse directly
          try {
            const parsed = JSON.parse(paymentResponseHeader)
            txHash = parsed.transaction || null
          } catch {
            // Header might be the tx hash itself
            txHash = paymentResponseHeader
          }
        }
      }

      setIsPremium(true)
      setPaymentState({
        isPending: false,
        isSuccess: true,
        isError: false,
        error: null,
        txHash,
      })
      setShowPaymentGate(false)

      // Inject premium data directly into SWR cache - no refetch needed
      if (result.success && result.data) {
        mutate(result, { revalidate: false })
      }
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.error('[x402] payment error:', error)
        if (error instanceof TypeError && error.cause) {
          console.error('[x402] error cause:', error.cause)
        }
      }

      let message = error instanceof Error ? error.message : 'Payment failed'
      const settlement = (error as any)?.settlement || null
      const statusCode = (error as any)?.statusCode || null

      // Surface the underlying cause (e.g. ECONNREFUSED, HPE_HEADER_OVERFLOW)
      if (error instanceof TypeError && error.cause instanceof Error && error.cause.message) {
        message = `${message} (${error.cause.message})`
      }

      // Append actionable hint based on error pattern
      if (message.includes('transaction_failed') && activeChainType === 'svm') {
        message += '\n\nThis usually means insufficient USDC balance on Solana Devnet. Use a faucet to get devnet USDC, or check that your Phantom wallet has the correct token account.'
      } else if (message.includes('transaction_failed')) {
        message += '\n\nThis usually means insufficient USDC balance or missing token approval. Check that your wallet has testnet USDC on Base Sepolia.'
      } else if (message.includes('insufficient') && activeChainType === 'svm') {
        message += '\n\nYour Solana wallet does not have enough USDC on Devnet. Fund it via a Solana devnet USDC faucet.'
      } else if (message.includes('Payment invalid')) {
        message += '\n\nThe payment signature was rejected. Try disconnecting and reconnecting your wallet.'
      }

      if (process.env.NODE_ENV === 'development' && statusCode) {
        console.error('[x402] payment failed with status %d, settlement:', statusCode, settlement)
      }

      setPaymentState({
        isPending: false,
        isSuccess: false,
        isError: true,
        error: message,
        txHash: settlement?.transaction || null,
      })
    }

    return null
  }, [activeSigner, baseUrl, activeAddress, activeChainType, mutate, setPaymentState, x402FetchConfig])

  const upgradeToPremium = useCallback(() => {
    setShowPaymentGate(true)
  }, [])

  const refresh = useCallback(() => {
    mutate()
  }, [mutate])

  return {
    solarData: data?.data,
    wastedEnergy,
    isLoading,
    isError: !!error || data?.success === false,
    error: error || (data?.error ? new Error(data.error) : undefined),
    isPremium,
    isCached: data?.cached ?? false,
    paymentRequired: defaultPaymentRequired,
    showPaymentGate,
    setShowPaymentGate,
    initiatePayment,
    paymentState,
    refresh,
    upgradeToPremium,
    isWrongChain,
    switchToCorrectChain,
    isSwitchingChain,
    requiredChainName,
    activeChainType,
    preferredChain,
    setPreferredChain,
    getExplorerTxUrl,
    isConnected,
    signerReady: !!activeSigner,
    evmConnected: evm.isConnected,
    solConnected: sol.isConnected,
  }
}
