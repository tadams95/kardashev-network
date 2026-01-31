'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  ConnectWallet,
  Wallet,
  WalletDropdown,
  WalletDropdownLink,
  WalletDropdownDisconnect,
} from '@coinbase/onchainkit/wallet'
import { Address, Avatar, Name, Identity } from '@coinbase/onchainkit/identity'
import KardashevIcon from './KardashevIcon'

const navigation = [
  { name: 'Dashboard', href: '/dashboard' },
  { name: 'API', href: '#api' },
  { name: 'About', href: '#about' },
]

interface LayoutProps {
  children: React.ReactNode
}

export default function Layout({ children }: LayoutProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  return (
    <div className="min-h-screen bg-black flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-black/95 backdrop-blur-md border-b border-gray-800/50">
        <nav className="relative flex items-center justify-between px-4 sm:px-6 lg:px-8 py-4 max-w-7xl mx-auto">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-3 group flex-shrink-0">
            <div className="transition-transform group-hover:scale-110">
              <KardashevIcon size="md" />
            </div>
            <span className="text-lg font-bold gradient-text hidden sm:block">
              Kardashev
            </span>
          </Link>

          {/* Desktop Navigation Links - centered */}
          <div className="hidden md:flex absolute left-1/2 -translate-x-1/2 items-center gap-2">
            {navigation.map((item) => (
              <Link
                key={item.name}
                href={item.href}
                className="text-sm font-medium text-gray-300 hover:text-cyan-500 transition-colors px-4 py-2 rounded-lg hover:bg-gray-800/50"
              >
                {item.name}
              </Link>
            ))}
          </div>

          {/* Right side: Wallet + Mobile Menu Button */}
          <div className="flex items-center gap-3 flex-shrink-0">
            {/* Wallet */}
            <Wallet>
              <ConnectWallet className="!bg-cyan-700 hover:!bg-cyan-700 !rounded-xl !px-3 sm:!px-5 !py-2 !font-medium !shadow-lg !shadow-cyan-700/20 hover:!shadow-cyan-700/30 transition-all !text-sm">
                <Avatar className="h-5 w-5" />
                <Name className="!text-white hidden sm:inline" />
              </ConnectWallet>
              <WalletDropdown className="!bg-[#0a0a0a] !border-gray-700 !rounded-xl !shadow-xl">
                <Identity className="px-4 pt-3 pb-2" hasCopyAddressOnClick>
                  <Avatar className="!h-10 !w-10" />
                  <Name className="!text-white !font-medium" />
                  <Address className="!text-gray-400" />
                </Identity>
                <WalletDropdownLink
                  icon="wallet"
                  href="https://wallet.coinbase.com"
                  target="_blank"
                  className="!text-gray-300 hover:!text-white"
                >
                  View Wallet
                </WalletDropdownLink>
                <WalletDropdownDisconnect className="!text-red-400 hover:!text-red-300" />
              </WalletDropdown>
            </Wallet>

            {/* Mobile Menu Button */}
            <button
              type="button"
              className="md:hidden p-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800/50 transition-colors"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>
          </div>
        </nav>

        {/* Mobile Navigation Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-gray-800/50 bg-black/95 backdrop-blur-md">
            <div className="px-4 py-3 space-y-1">
              {navigation.map((item) => (
                <Link
                  key={item.name}
                  href={item.href}
                  className="block text-base font-medium text-gray-300 hover:text-cyan-500 transition-colors px-4 py-3 rounded-lg hover:bg-gray-800/50"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {item.name}
                </Link>
              ))}
            </div>
          </div>
        )}
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col">{children}</main>

      {/* Footer */}
      <footer className="border-t border-gray-800/50 bg-black">
        <div className="max-w-7xl mx-auto px-4 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-gray-500">
          <div className="flex items-center gap-2">
            <KardashevIcon size="sm" className="opacity-70" />
            <span>Kardashev Network</span>
          </div>
          <div className="flex items-center gap-4 text-xs sm:text-sm">
            <a
              href="https://github.com/tadams95/kardashev-network"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-gray-300 transition-colors"
            >
              GitHub
            </a>
            <span className="text-gray-700">|</span>
            <span>Powered by Base</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
