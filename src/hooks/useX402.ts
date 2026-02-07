import { useState, useCallback } from 'react'
import { useAccount, useWalletClient, useChainId, useSwitchChain } from 'wagmi'
import { baseSepolia, base } from 'wagmi/chains'

const requiredChain = process.env.NEXT_PUBLIC_X402_NETWORK === 'base' ? base : baseSepolia

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
  const chainId = useChainId()
  const { switchChain, isPending: isSwitchingChain } = useSwitchChain()
  const [paymentState, setPaymentState] = useState<PaymentState>(initialPaymentState)

  const isWrongChain = isConnected && chainId !== requiredChain.id

  const switchToCorrectChain = useCallback(() => {
    switchChain({ chainId: requiredChain.id })
  }, [switchChain])

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
    isWrongChain,
    switchToCorrectChain,
    isSwitchingChain,
    requiredChainName: requiredChain.name,
  }
}
