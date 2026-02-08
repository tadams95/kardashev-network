import { useState, useEffect } from 'react'
import {
  ConnectWallet,
  Wallet,
  WalletDropdown,
  WalletDropdownLink,
  WalletDropdownDisconnect,
} from '@coinbase/onchainkit/wallet'
import { Address, Avatar, Name, Identity } from '@coinbase/onchainkit/identity'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { useWallet } from '@solana/wallet-adapter-react'
import { useAccount } from 'wagmi'
import type { ChainType } from '@/hooks/useMultiChainX402'

interface WalletSelectorProps {
  className?: string
  compact?: boolean
}

export default function WalletSelector({ className = '', compact = false }: WalletSelectorProps) {
  const { isConnected: evmConnected } = useAccount()
  const { connected: solConnected } = useWallet()

  const [activeTab, setActiveTab] = useState<ChainType>('evm')

  // Auto-select tab based on connected wallet
  useEffect(() => {
    if (solConnected && !evmConnected) setActiveTab('svm')
    else if (evmConnected && !solConnected) setActiveTab('evm')
  }, [evmConnected, solConnected])

  if (compact) {
    // Inline compact mode — just show both wallet buttons side by side
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <Wallet>
          <ConnectWallet className="!bg-amber-600 hover:!bg-amber-700 !rounded-xl !px-4 !py-2 !font-medium !shadow-lg !shadow-amber-600/20 !text-sm">
            <Avatar className="h-5 w-5" />
            <Name className="!text-white" />
          </ConnectWallet>
          <WalletDropdown className="!bg-gray-900 !border-gray-700 !rounded-xl !shadow-xl">
            <Identity className="px-4 pt-3 pb-2" hasCopyAddressOnClick>
              <Avatar className="!h-10 !w-10" />
              <Name className="!text-white !font-medium" />
              <Address className="!text-gray-400" />
            </Identity>
            <WalletDropdownLink
              icon="wallet"
              href="https://wallet.coinbase.com"
              target="_blank"
              className="!text-gray-400 hover:!text-white"
            >
              View Wallet
            </WalletDropdownLink>
            <WalletDropdownDisconnect className="!text-red-400 hover:!text-red-300" />
          </WalletDropdown>
        </Wallet>
        <SolanaWalletButton />
      </div>
    )
  }

  return (
    <div className={className}>
      {/* Tab Selector */}
      <div className="flex bg-gray-800/50 rounded-lg p-0.5 mb-3">
        <button
          onClick={() => setActiveTab('evm')}
          className={`flex-1 py-1.5 px-3 rounded-md text-xs font-medium transition-all ${
            activeTab === 'evm'
              ? 'bg-amber-600 text-white shadow-sm'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          Base {evmConnected && <span className="inline-block w-1.5 h-1.5 bg-emerald-400 rounded-full ml-1 align-middle" />}
        </button>
        <button
          onClick={() => setActiveTab('svm')}
          className={`flex-1 py-1.5 px-3 rounded-md text-xs font-medium transition-all ${
            activeTab === 'svm'
              ? 'bg-purple-600 text-white shadow-sm'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          Solana {solConnected && <span className="inline-block w-1.5 h-1.5 bg-emerald-400 rounded-full ml-1 align-middle" />}
        </button>
      </div>

      {/* Wallet Content */}
      {activeTab === 'evm' ? (
        <Wallet>
          <ConnectWallet className="!w-full !bg-amber-600 hover:!bg-amber-700 !rounded-xl !py-3 !font-semibold !text-base !justify-center !shadow-lg !shadow-amber-600/20">
            <Avatar className="h-5 w-5" />
            <Name className="!text-white" />
          </ConnectWallet>
          <WalletDropdown className="!bg-gray-900 !border-gray-700 !rounded-xl !shadow-xl">
            <Identity className="px-4 pt-3 pb-2" hasCopyAddressOnClick>
              <Avatar className="!h-10 !w-10" />
              <Name className="!text-white !font-medium" />
              <Address className="!text-gray-400" />
            </Identity>
            <WalletDropdownLink
              icon="wallet"
              href="https://wallet.coinbase.com"
              target="_blank"
              className="!text-gray-400 hover:!text-white"
            >
              View Wallet
            </WalletDropdownLink>
            <WalletDropdownDisconnect className="!text-red-400 hover:!text-red-300" />
          </WalletDropdown>
        </Wallet>
      ) : (
        <SolanaWalletButton fullWidth />
      )}
    </div>
  )
}

function SolanaWalletButton({ fullWidth = false }: { fullWidth?: boolean }) {
  return (
    <div className={`solana-wallet-button ${fullWidth ? 'w-full' : ''}`}>
      <WalletMultiButton
        style={{
          backgroundColor: '#9333ea',
          borderRadius: '0.75rem',
          fontWeight: 600,
          fontSize: fullWidth ? '1rem' : '0.875rem',
          padding: fullWidth ? '0.75rem 1.25rem' : '0.5rem 1rem',
          width: fullWidth ? '100%' : 'auto',
          justifyContent: 'center',
          height: 'auto',
        }}
      />
    </div>
  )
}
