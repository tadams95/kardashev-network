import { useState, useCallback } from 'react'
import { useAccount, useWalletClient } from 'wagmi'

export interface PaymentState {
  isPending: boolean
  isSuccess: boolean
  isError: boolean
  error: string | null
  txHash: string | null
}

const initialPaymentState: PaymentState = {
  isPending: false,
  isSuccess: false,
  isError: false,
  error: null,
  txHash: null,
}

export function useX402() {
  const { address, isConnected } = useAccount()
  const { data: walletClient } = useWalletClient()
  const [paymentState, setPaymentState] = useState<PaymentState>(initialPaymentState)

  const resetPayment = useCallback(() => {
    setPaymentState(initialPaymentState)
  }, [])

  return {
    paymentState,
    setPaymentState,
    resetPayment,
    isConnected,
    address,
    walletClient,
  }
}
