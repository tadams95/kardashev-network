import { useState, useMemo, useCallback } from 'react'
import { useX402 } from './useX402'
import { useX402Solana } from './useX402Solana'
import type { PaymentState } from './useX402'

export type ChainType = 'evm' | 'svm'

const SOLANA_NETWORK = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'solana-devnet'
const EVM_NETWORK = process.env.NEXT_PUBLIC_X402_NETWORK || 'base-sepolia'
const SOLANA_RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.devnet.solana.com'
const SOLANA_RECEIVER = process.env.NEXT_PUBLIC_SOLANA_RECEIVER_ADDRESS || ''
const EVM_RECEIVER = process.env.NEXT_PUBLIC_X402_RECEIVER_ADDRESS || ''

export function useMultiChainX402() {
  const evm = useX402()
  const sol = useX402Solana()

  // When both wallets connected, user picks preferred chain
  const [preferredChain, setPreferredChain] = useState<ChainType>('evm')

  // Auto-detect which chain is active
  const activeChainType: ChainType = useMemo(() => {
    if (evm.isConnected && sol.isConnected) return preferredChain
    if (sol.isConnected) return 'svm'
    return 'evm'
  }, [evm.isConnected, sol.isConnected, preferredChain])

  const isConnected = evm.isConnected || sol.isConnected


  const activeSigner: any = useMemo(() => {
    if (activeChainType === 'svm') return sol.solSigner
    return evm.walletClient ?? null
  }, [activeChainType, sol.solSigner, evm.walletClient])

  const activeAddress = activeChainType === 'svm' ? sol.address : evm.address ?? null

  const x402Network = activeChainType === 'svm' ? SOLANA_NETWORK : EVM_NETWORK

  const paymentState: PaymentState = activeChainType === 'svm'
    ? sol.paymentState
    : evm.paymentState

  const setPaymentState = activeChainType === 'svm'
    ? sol.setPaymentState
    : evm.setPaymentState

  const resetPayment = activeChainType === 'svm'
    ? sol.resetPayment
    : evm.resetPayment

  // EVM chain switching (Solana has no chain switching)
  const isWrongChain = activeChainType === 'evm' ? evm.isWrongChain : false
  const switchToCorrectChain = evm.switchToCorrectChain
  const isSwitchingChain = activeChainType === 'evm' ? evm.isSwitchingChain : false

  const requiredChainName = activeChainType === 'svm'
    ? sol.networkName
    : evm.requiredChainName

  const receiverAddress = activeChainType === 'svm' ? SOLANA_RECEIVER : EVM_RECEIVER

  // x402-fetch config: pass svmConfig for Solana

  const x402FetchConfig: any = useMemo(() => {
    if (activeChainType === 'svm') {
      return { svmConfig: { rpcUrl: SOLANA_RPC_URL } }
    }
    return undefined
  }, [activeChainType])

  const getExplorerTxUrl = useCallback((txHash: string): string => {
    if (activeChainType === 'svm') {
      const cluster = SOLANA_NETWORK === 'solana' ? '' : '?cluster=devnet'
      return `https://explorer.solana.com/tx/${txHash}${cluster}`
    }
    const subdomain = EVM_NETWORK === 'base' ? '' : 'sepolia.'
    return `https://${subdomain}basescan.org/tx/${txHash}`
  }, [activeChainType])

  return {
    // Chain info
    activeChainType,
    preferredChain,
    setPreferredChain,
    x402Network,
    isConnected,

    // Signer
    activeSigner,
    activeAddress,

    // Payment state
    paymentState,
    setPaymentState,
    resetPayment,

    // Chain switching (EVM only)
    isWrongChain,
    switchToCorrectChain,
    isSwitchingChain,
    requiredChainName,
    receiverAddress,

    // x402-fetch config
    x402FetchConfig,

    // Explorer
    getExplorerTxUrl,

    // Per-chain details (for WalletSelector, PaymentGate)
    evm: {
      isConnected: evm.isConnected,
      address: evm.address,
    },
    sol: {
      isConnected: sol.isConnected,
      address: sol.address,
      walletName: sol.walletName,
    },
  }
}
