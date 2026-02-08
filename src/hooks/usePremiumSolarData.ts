import { useState, useCallback, useMemo } from 'react'
import useSWR from 'swr'
import { wrapFetchWithPayment } from 'x402-fetch'
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
  evmConnected: boolean
  solConnected: boolean
}

export function usePremiumSolarData(
  lat: number | null | undefined,
  lng: number | null | undefined
): UsePremiumSolarDataReturn {
  const [isPremium, setIsPremium] = useState(false)
  const [showPaymentGate, setShowPaymentGate] = useState(false)

  const {
    activeChainType,
    preferredChain,
    setPreferredChain,
    x402Network,
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
  const defaultPaymentRequired = useMemo<X402PaymentRequired>(() => ({
    x402Version: 1,
    accepts: [{
      scheme: 'exact',
      network: x402Network,
      maxAmountRequired: solarPricing?.price.replace('$', '') || '0.001',
      resource: '/api/solar/irradiance',
      description: solarPricing?.description || 'Real-time solar irradiance data',
      mimeType: 'application/json',
      payTo: '',
      maxTimeoutSeconds: 300,
      asset: 'USDC',
    }],
  }), [solarPricing?.price, solarPricing?.description, x402Network])

  const shouldFetch = lat != null && lng != null && !isNaN(lat) && !isNaN(lng)
  const baseUrl = shouldFetch ? `/api/solar/irradiance?lat=${lat}&lng=${lng}` : null

  // Include premium+address in SWR key so session-aware refetches work
  const swrKey = shouldFetch
    ? isPremium && activeAddress
      ? `${baseUrl}&session=${activeAddress}`
      : baseUrl
    : null

  // SWR fetcher - always fetches free data by default
  // When premium+address, includes wallet address header for session recognition
  const fetcher = useCallback(async (url: string): Promise<SolarApiResponse> => {
    // Strip session param from URL before fetching
    const fetchUrl = url.replace(/&session=[a-zA-Z0-9]+$/, '')
    const headers: Record<string, string> = {}
    if (isPremium && activeAddress) {
      headers['X-Wallet-Address'] = activeAddress
    }
    const res = await fetch(fetchUrl, { headers })
    if (!res.ok && res.status !== 402) {
      throw new Error('Failed to fetch solar data')
    }
    return res.json()
  }, [isPremium, activeAddress])

  const { data, error, isLoading, mutate } = useSWR<SolarApiResponse>(
    swrKey,
    fetcher,
    {
      refreshInterval: isPremium ? 0 : 300000,
      revalidateOnFocus: false,
    }
  )

  const wastedEnergy = data?.data ? calculateWastedValueFromData(data.data) : undefined

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
        undefined,
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
        throw new Error(typeof reason === 'string' ? reason : JSON.stringify(reason))
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
      // Surface the underlying cause (e.g. ECONNREFUSED, HPE_HEADER_OVERFLOW)
      if (error instanceof TypeError && error.cause instanceof Error && error.cause.message) {
        message = `${message} (${error.cause.message})`
      }

      setPaymentState({
        isPending: false,
        isSuccess: false,
        isError: true,
        error: message,
        txHash: null,
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
    evmConnected: evm.isConnected,
    solConnected: sol.isConnected,
  }
}
