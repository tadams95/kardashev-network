// x402 payment hook - handles 402 Payment Required responses

import { useState, useCallback } from 'react'
import { useAccount, useSignMessage } from 'wagmi'
import type { X402PaymentRequired } from '@/types/x402'

interface PaymentState {
  isPending: boolean
  isSuccess: boolean
  isError: boolean
  error: string | null
  txHash: string | null
}

interface UseX402Return {
  paymentState: PaymentState
  paymentRequired: X402PaymentRequired | null
  setPaymentRequired: (payment: X402PaymentRequired | null) => void
  handlePaymentRequired: (response: Response) => Promise<X402PaymentRequired | null>
  initiatePayment: (overridePayment?: X402PaymentRequired) => Promise<string | null>
  resetPayment: () => void
  isConnected: boolean
  address: string | undefined
}

const initialPaymentState: PaymentState = {
  isPending: false,
  isSuccess: false,
  isError: false,
  error: null,
  txHash: null,
}

/**
 * Hook to handle x402 payment flows
 *
 * Usage:
 * 1. Make API request
 * 2. If 402 response, call handlePaymentRequired(response)
 * 3. Show PaymentGate component with paymentRequired data
 * 4. User clicks pay, call initiatePayment()
 * 5. Retry original request with payment header
 */
export function useX402(): UseX402Return {
  const { address, isConnected } = useAccount()
  const { signMessageAsync } = useSignMessage()

  const [paymentState, setPaymentState] = useState<PaymentState>(initialPaymentState)
  const [paymentRequired, setPaymentRequired] = useState<X402PaymentRequired | null>(null)

  /**
   * Parse a 402 response and extract payment requirements
   */
  const handlePaymentRequired = useCallback(async (response: Response): Promise<X402PaymentRequired | null> => {
    if (response.status !== 402) {
      return null
    }

    try {
      const data = await response.json() as X402PaymentRequired
      setPaymentRequired(data)
      return data
    } catch (error) {
      console.error('Failed to parse 402 response:', error)
      return null
    }
  }, [])

  /**
   * Initiate payment for the current paymentRequired
   * Returns payment signature/proof to include in retry request
   * @param overridePayment - Optional payment requirements to use instead of internal state
   */
  const initiatePayment = useCallback(async (overridePayment?: X402PaymentRequired): Promise<string | null> => {
    const payment = overridePayment || paymentRequired

    if (!payment) {
      setPaymentState({
        ...initialPaymentState,
        isError: true,
        error: 'No payment requirements available',
      })
      return null
    }

    if (!isConnected || !address) {
      setPaymentState({
        ...initialPaymentState,
        isError: true,
        error: 'Wallet not connected',
      })
      return null
    }

    setPaymentState({
      ...initialPaymentState,
      isPending: true,
    })

    try {
      const acceptedPayment = payment.accepts[0]
      if (!acceptedPayment) {
        throw new Error('No payment method available')
      }

      // Create payment message to sign
      const paymentMessage = JSON.stringify({
        x402Version: payment.x402Version,
        scheme: acceptedPayment.scheme,
        network: acceptedPayment.network,
        amount: acceptedPayment.maxAmountRequired,
        resource: acceptedPayment.resource,
        payTo: acceptedPayment.payTo,
        timestamp: Date.now(),
        payer: address,
      })

      // Sign the payment authorization
      const signature = await signMessageAsync({ message: paymentMessage })

      // Create the payment header value
      const paymentHeader = btoa(JSON.stringify({
        message: paymentMessage,
        signature,
        payer: address,
      }))

      setPaymentState({
        isPending: false,
        isSuccess: true,
        isError: false,
        error: null,
        txHash: signature,
      })

      return paymentHeader
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Payment failed'
      setPaymentState({
        isPending: false,
        isSuccess: false,
        isError: true,
        error: errorMessage,
        txHash: null,
      })
      return null
    }
  }, [paymentRequired, isConnected, address, signMessageAsync])

  /**
   * Reset payment state
   */
  const resetPayment = useCallback(() => {
    setPaymentState(initialPaymentState)
    setPaymentRequired(null)
  }, [])

  return {
    paymentState,
    paymentRequired,
    setPaymentRequired,
    handlePaymentRequired,
    initiatePayment,
    resetPayment,
    isConnected,
    address,
  }
}

/**
 * Wrapper for fetch that handles x402 payments automatically
 */
export async function fetchWithX402(
  url: string,
  options: RequestInit = {},
  paymentHeader?: string
): Promise<Response> {
  const headers = new Headers(options.headers)

  if (paymentHeader) {
    headers.set('X-Payment', paymentHeader)
  }

  return fetch(url, {
    ...options,
    headers,
  })
}

/**
 * Helper to check if a response requires payment
 */
export function isPaymentRequired(response: Response): boolean {
  return response.status === 402
}

/**
 * Extract payment info from response headers (for free tier responses)
 */
export function getUpgradeInfo(response: Response): X402PaymentRequired | null {
  const upgradeHeader = response.headers.get('X-Upgrade-Info')
  if (!upgradeHeader) return null

  try {
    return JSON.parse(upgradeHeader)
  } catch {
    return null
  }
}
