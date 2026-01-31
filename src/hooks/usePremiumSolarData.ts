// Hook for fetching solar data with x402 premium support

import { useState, useCallback, useMemo } from 'react'
import useSWR from 'swr'
import { useX402, fetchWithX402, isPaymentRequired } from './useX402'
import { calculateWastedValueFromData } from '@/lib/calculations/solarValue'
import { X402_PRICING } from '@/lib/x402/config'
import type { SolarData, SolarApiResponse, WastedEnergy } from '@/types/solar'
import type { X402PaymentRequired } from '@/types/x402'

// Get receiver address from env (client-side accessible)
const RECEIVER_ADDRESS = process.env.NEXT_PUBLIC_X402_RECEIVER_ADDRESS || ''
const NETWORK = process.env.NEXT_PUBLIC_X402_NETWORK || 'base-sepolia'

interface UsePremiumSolarDataReturn {
  // Data
  solarData: SolarData | undefined
  wastedEnergy: WastedEnergy | undefined

  // Loading states
  isLoading: boolean
  isError: boolean
  error: Error | undefined

  // Tier info
  isPremium: boolean
  isCached: boolean

  // Payment
  paymentRequired: X402PaymentRequired | null
  showPaymentGate: boolean
  setShowPaymentGate: (show: boolean) => void
  initiatePayment: () => Promise<string | null>
  paymentState: {
    isPending: boolean
    isSuccess: boolean
    isError: boolean
    error: string | null
  }

  // Actions
  refresh: () => void
  upgradeToPremium: () => void
}

const fetcher = async (url: string): Promise<SolarApiResponse> => {
  const res = await fetch(url)
  if (!res.ok && res.status !== 402) {
    throw new Error('Failed to fetch solar data')
  }
  return res.json()
}

/**
 * Hook for solar data with premium upgrade support via x402
 */
export function usePremiumSolarData(
  lat: number | null | undefined,
  lng: number | null | undefined
): UsePremiumSolarDataReturn {
  const [isPremium, setIsPremium] = useState(false)
  const [showPaymentGate, setShowPaymentGate] = useState(false)
  const [paymentHeader, setPaymentHeader] = useState<string | null>(null)
  const [localPaymentRequired, setLocalPaymentRequired] = useState<X402PaymentRequired | null>(null)

  const {
    paymentState,
    paymentRequired: serverPaymentRequired,
    handlePaymentRequired,
    initiatePayment: initiateX402Payment,
    resetPayment,
    isConnected,
  } = useX402()

  // Use server payment required if available, otherwise use locally constructed one
  const paymentRequired = serverPaymentRequired || localPaymentRequired

  // Construct payment requirements from config
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
  }), [])

  // Build URL based on whether we have a payment header
  const shouldFetch = lat != null && lng != null && !isNaN(lat) && !isNaN(lng)
  const baseUrl = shouldFetch ? `/api/solar/irradiance?lat=${lat}&lng=${lng}` : null

  // Custom fetcher that handles payment headers
  const premiumFetcher = useCallback(
    async (url: string): Promise<SolarApiResponse> => {
      const res = await fetchWithX402(url, {}, paymentHeader || undefined)

      // Check if payment is required
      if (isPaymentRequired(res)) {
        await handlePaymentRequired(res)
        // Return empty data to trigger payment flow
        return { success: false, error: 'Payment required' }
      }

      if (!res.ok) {
        throw new Error('Failed to fetch solar data')
      }

      const data = await res.json()

      // Check if we got premium data (not cached)
      if (paymentHeader && data.success) {
        setIsPremium(true)
      }

      return data
    },
    [paymentHeader, handlePaymentRequired]
  )

  const { data, error, isLoading, mutate } = useSWR<SolarApiResponse>(
    baseUrl,
    paymentHeader ? premiumFetcher : fetcher,
    {
      refreshInterval: 300000,
      revalidateOnFocus: false,
    }
  )

  // Calculate wasted energy
  const wastedEnergy = data?.data ? calculateWastedValueFromData(data.data) : undefined

  // Handle payment initiation
  const initiatePayment = useCallback(async () => {
    // Pass the payment requirements (local or server) to initiateX402Payment
    const header = await initiateX402Payment(paymentRequired || undefined)
    if (header) {
      setPaymentHeader(header)
      setShowPaymentGate(false)
      // Revalidate with payment header
      mutate()
    }
    return header
  }, [initiateX402Payment, paymentRequired, mutate])

  // Trigger premium upgrade flow
  const upgradeToPremium = useCallback(() => {
    // Set the payment requirements so PaymentGate has data to display
    if (!paymentRequired) {
      setLocalPaymentRequired(defaultPaymentRequired)
    }
    setShowPaymentGate(true)
  }, [paymentRequired, defaultPaymentRequired])

  // Refresh data
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
    paymentRequired,
    showPaymentGate,
    setShowPaymentGate,
    initiatePayment,
    paymentState,
    refresh,
    upgradeToPremium,
  }
}
