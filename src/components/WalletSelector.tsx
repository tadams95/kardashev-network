import { useState, useEffect, useRef } from 'react'
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
  const [chainMenuOpen, setChainMenuOpen] = useState(false)
  const [connectMenuOpen, setConnectMenuOpen] = useState(false)
  const chainMenuRef = useRef<HTMLDivElement>(null)
  const connectMenuRef = useRef<HTMLDivElement>(null)

  // Auto-select tab based on connected wallet
  useEffect(() => {
    if (solConnected && !evmConnected) setActiveTab('svm')
    else if (evmConnected && !solConnected) setActiveTab('evm')
  }, [evmConnected, solConnected])

  // Close menus on click outside
  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (chainMenuRef.current && !chainMenuRef.current.contains(e.target as Node)) {
        setChainMenuOpen(false)
      }
      if (connectMenuRef.current && !connectMenuRef.current.contains(e.target as Node)) {
        setConnectMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [])

  const anyConnected = evmConnected || solConnected

  if (compact) {
    // No wallet connected
    if (!anyConnected) {
      return (
        <div className={`relative flex items-center gap-2 ${className}`} ref={connectMenuRef}>
          {/* Network Selector Pill */}
          <div className="relative">
            <button
              onClick={() => setConnectMenuOpen(!connectMenuOpen)}
              className="flex items-center gap-2 bg-gray-900 border border-gray-700 hover:border-amber-500/50 rounded-xl px-3 py-2 text-sm text-gray-300 transition-colors"
              title="Select Network"
              aria-haspopup="true"
              aria-expanded={connectMenuOpen}
            >
              <span className={`w-2 h-2 rounded-full ${activeTab === 'evm' ? 'bg-blue-500' : 'bg-purple-500'}`} />
              <span className="hidden sm:inline">{activeTab === 'evm' ? 'Base' : 'Solana'}</span>
              <svg className={`w-3 h-3 transition-transform ${connectMenuOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            
            {connectMenuOpen && (
              <div className="absolute top-full left-0 mt-2 w-40 bg-gray-900 border border-gray-700 rounded-xl shadow-xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-100">
                <div className="py-1">
                  <button
                    onClick={() => { setActiveTab('evm'); setConnectMenuOpen(false) }}
                    className={`w-full flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-gray-800 transition-colors ${activeTab === 'evm' ? 'text-white bg-gray-800/50' : 'text-gray-400'}`}
                  >
                    <span className="w-2 h-2 rounded-full bg-blue-500" />
                    Base (EVM)
                  </button>
                  <button
                    onClick={() => { setActiveTab('svm'); setConnectMenuOpen(false) }}
                    className={`w-full flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-gray-800 transition-colors ${activeTab === 'svm' ? 'text-white bg-gray-800/50' : 'text-gray-400'}`}
                  >
                    <span className="w-2 h-2 rounded-full bg-purple-500" />
                    Solana
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Active Connect Button */}
          {activeTab === 'evm' ? (
            <Wallet>
              <ConnectWallet className="!bg-amber-600 hover:!bg-amber-700 !rounded-xl !px-4 !py-2 !font-medium !shadow-lg !shadow-amber-600/20 !text-sm !text-white !h-auto !min-h-0">
                <Avatar className="h-5 w-5" />
                <Name className="!text-white" />
              </ConnectWallet>
              <WalletDropdown className="!bg-gray-900 !border-gray-700 !rounded-xl !shadow-xl">
                <Identity className="px-4 pt-3 pb-2" hasCopyAddressOnClick>
                  <Avatar className="!h-10 !w-10" />
                  <Name className="!text-white !font-medium" />
                  <Address className="!text-gray-400" />
                </Identity>
                <WalletDropdownDisconnect className="!text-red-400 hover:!text-red-300" />
              </WalletDropdown>
            </Wallet>
          ) : (
            <div className="solana-wallet-wrapper">
              <SolanaWalletButton />
            </div>
          )}
        </div>
      )
    }

    // Wallet(s) connected — show active wallet + chain-switcher
    return (
      <div className={`flex items-center gap-1.5 ${className}`}>
        {/* Active wallet button */}
        {activeTab === 'evm' ? (
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
        ) : (
          <SolanaWalletButton />
        )}

        {/* Chain switcher */}
        <div className="relative" ref={chainMenuRef}>
          <button
            onClick={() => setChainMenuOpen(!chainMenuOpen)}
            className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
            title="Switch chain"
            aria-haspopup="true"
            aria-expanded={chainMenuOpen}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
          </button>
          {chainMenuOpen && (
            <div className="absolute top-full right-0 mt-2 w-44 bg-gray-900 border border-gray-700 rounded-xl shadow-xl z-50 overflow-hidden">
              <div className="py-1">
                <button
                  onClick={() => { setActiveTab('evm'); setChainMenuOpen(false) }}
                  className={`w-full flex items-center gap-2 px-4 py-2.5 text-sm transition-colors ${
                    activeTab === 'evm' ? 'text-white bg-gray-800' : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                  }`}
                >
                  {evmConnected && <span className="w-2 h-2 rounded-full bg-emerald-400" />}
                  {!evmConnected && <span className="w-2 h-2 rounded-full bg-gray-600" />}
                  Base
                  {activeTab === 'evm' && <span className="ml-auto text-amber-500 text-xs">Active</span>}
                </button>
                <button
                  onClick={() => { setActiveTab('svm'); setChainMenuOpen(false) }}
                  className={`w-full flex items-center gap-2 px-4 py-2.5 text-sm transition-colors ${
                    activeTab === 'svm' ? 'text-white bg-gray-800' : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                  }`}
                >
                  {solConnected && <span className="w-2 h-2 rounded-full bg-emerald-400" />}
                  {!solConnected && <span className="w-2 h-2 rounded-full bg-gray-600" />}
                  Solana
                  {activeTab === 'svm' && <span className="ml-auto text-amber-500 text-xs">Active</span>}
                </button>
              </div>
            </div>
          )}
        </div>
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
          backgroundColor: '#d97706',
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
