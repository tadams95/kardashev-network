import Link from 'next/link'
import {
  ConnectWallet,
  Wallet,
  WalletDropdown,
  WalletDropdownLink,
  WalletDropdownDisconnect,
} from '@coinbase/onchainkit/wallet'
import { Address, Avatar, Name, Identity } from '@coinbase/onchainkit/identity'

const navigation = [
  { name: 'Dashboard', href: '/dashboard' },
  { name: 'API', href: '#api' },
  { name: 'About', href: '#about' },
]

interface LayoutProps {
  children: React.ReactNode
}

export default function Layout({ children }: LayoutProps) {
  return (
    <div className="min-h-screen bg-black flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-black/95 backdrop-blur-md border-b border-gray-800/50">
        <nav className="flex items-center justify-between p-4 lg:px-8 max-w-7xl mx-auto">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-3 group flex-shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="h-8 w-auto transition-transform group-hover:scale-110"
              src="https://www.svgrepo.com/show/323986/earth-sun.svg"
              alt="Kardashev Network"
            />
            <span className="text-lg font-bold gradient-text hidden sm:block">
              Kardashev
            </span>
          </Link>

          {/* Navigation Links */}
          <div className="flex items-center gap-1 sm:gap-4">
            {navigation.map((item) => (
              <Link
                key={item.name}
                href={item.href}
                className="text-xs sm:text-sm font-medium text-gray-300 hover:text-green-400 transition-colors px-2 sm:px-3 py-2 rounded-lg hover:bg-gray-800/30"
              >
                {item.name}
              </Link>
            ))}
          </div>

          {/* Wallet */}
          <div className="flex-shrink-0">
            <Wallet>
              <ConnectWallet className="!bg-green-600 hover:!bg-green-500 !rounded-xl !px-3 sm:!px-5 !py-2 !font-medium !shadow-lg !shadow-green-500/20 hover:!shadow-green-500/30 transition-all !text-sm">
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
          </div>
        </nav>
      </header>

      {/* Main Content */}
      <main className="flex-1">{children}</main>

      {/* Footer */}
      <footer className="border-t border-gray-800/50 bg-black">
        <div className="max-w-7xl mx-auto px-4 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-gray-500">
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="h-5 w-auto opacity-50"
              src="https://www.svgrepo.com/show/323986/earth-sun.svg"
              alt=""
            />
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
