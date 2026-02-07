import { useState, useCallback } from 'react'
import { useAccount, useWalletClient, useSwitchChain } from 'wagmi'
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
  const { address, isConnected, chainId: connectedChainId } = useAccount()
  const { data: walletClient } = useWalletClient()
  const { switchChain, isPending: isSwitchingChain } = useSwitchChain()
  const [paymentState, setPaymentState] = useState<PaymentState>(initialPaymentState)

  const isWrongChain = isConnected && connectedChainId !== requiredChain.id

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
