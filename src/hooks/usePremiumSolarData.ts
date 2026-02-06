import { useState, useCallback, useMemo } from 'react'
import useSWR from 'swr'
import { wrapFetchWithPayment } from 'x402-fetch'
import { settleResponseFromHeader } from 'x402/types'
import { useX402 } from './useX402'
import { calculateWastedValueFromData } from '@/lib/calculations/solarValue'
import { X402_PRICING } from '@/lib/x402/config'
import type { SolarData, SolarApiResponse, WastedEnergy } from '@/types/solar'
import type { X402PaymentRequired } from '@/types/x402'

const NETWORK = process.env.NEXT_PUBLIC_X402_NETWORK || 'base-sepolia'
const RECEIVER_ADDRESS = process.env.NEXT_PUBLIC_X402_RECEIVER_ADDRESS || ''

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
}

export function usePremiumSolarData(
  lat: number | null | undefined,
  lng: number | null | undefined
): UsePremiumSolarDataReturn {
  const [isPremium, setIsPremium] = useState(false)
  const [showPaymentGate, setShowPaymentGate] = useState(false)

  const {
    paymentState,
    setPaymentState,
    resetPayment,
    isConnected,
    address,
    walletClient,
  } = useX402()

  const solarPricing = X402_PRICING['/api/solar/irradiance']
  const defaultPaymentRequired = useMemo<X402PaymentRequired>(() => ({
    x402Version: 1,
    accepts: [{
      scheme: 'exact',
      network: NETWORK,
      maxAmountRequired: solarPricing?.price.replace('$', '') || '0.001',
      resource: '/api/solar/irradiance',
      description: solarPricing?.description || 'Real-time solar irradiance data',
      mimeType: 'application/json',
      payTo: RECEIVER_ADDRESS,
      maxTimeoutSeconds: 300,
      asset: 'USDC',
    }],
  }), [solarPricing?.price, solarPricing?.description])

  const shouldFetch = lat != null && lng != null && !isNaN(lat) && !isNaN(lng)
  const baseUrl = shouldFetch ? `/api/solar/irradiance?lat=${lat}&lng=${lng}` : null

  // Include premium+address in SWR key so session-aware refetches work
  const swrKey = shouldFetch
    ? isPremium && address
      ? `${baseUrl}&session=${address}`
      : baseUrl
    : null

  // SWR fetcher - always fetches free data by default
  // When premium+address, includes wallet address header for session recognition
  const fetcher = useCallback(async (url: string): Promise<SolarApiResponse> => {
    // Strip session param from URL before fetching
    const fetchUrl = url.replace(/&session=0x[a-fA-F0-9]+$/, '')
    const headers: Record<string, string> = {}
    if (isPremium && address) {
      headers['X-Wallet-Address'] = address
    }
    const res = await fetch(fetchUrl, { headers })
    if (!res.ok && res.status !== 402) {
      throw new Error('Failed to fetch solar data')
    }
    return res.json()
  }, [isPremium, address])

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
    if (!walletClient || !baseUrl) return null

    setPaymentState({
      isPending: true,
      isSuccess: false,
      isError: false,
      error: null,
      txHash: null,
    })

    try {
      const premiumFetch = wrapFetchWithPayment(fetch, walletClient as unknown as Parameters<typeof wrapFetchWithPayment>[1])
      const response = await premiumFetch(baseUrl, {
        headers: { 'X-Request-Premium': 'true' },
      })
      const result: SolarApiResponse = await response.json()

      // Extract tx hash from settlement response header
      const paymentResponseHeader = response.headers.get('x-payment-response')
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
      const message = error instanceof Error ? error.message : 'Payment failed'
      setPaymentState({
        isPending: false,
        isSuccess: false,
        isError: true,
        error: message,
        txHash: null,
      })
    }

    return null
  }, [walletClient, baseUrl, mutate, setPaymentState])

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
  }
}
