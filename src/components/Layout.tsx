"use client";

import { useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import KardashevIcon from "./KardashevIcon";
import WalletSelector from "./WalletSelector";

const navigation = [
  { name: "Solar", href: "/dashboard" },
  { name: "Weather", href: "/weather-forecast" },
  { name: "Trading", href: "/trading-readiness" },
  { name: "API", href: "/api-docs" },
  { name: "About", href: "/about" },
];

interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const router = useRouter();

  const handleNavClick = () => {
    setMobileMenuOpen(false);
  };

  const isActiveLink = (href: string) => {
    if (href.startsWith("#")) return false;
    if (href === '/') return router.pathname === '/';
    return router.pathname.startsWith(href);
  };

  return (
    <div className="min-h-screen bg-surface-page flex flex-col">
      {/* Header - absolute on desktop, relative on mobile */}
      <header className="absolute inset-x-0 top-0 z-50">
        <nav
          className="flex items-center justify-between p-6 lg:px-8"
          aria-label="Global"
        >
          {/* Left column: Logo */}
          <div className="flex lg:flex-1">
            <Link
              href="/"
              className="-m-1.5 p-1.5 flex items-center gap-3 group"
            >
              <span className="sr-only">Kardashev Network</span>
              <div className="transition-all duration-150 hover:scale-110 active:scale-95">
                <KardashevIcon size="md" />
              </div>
              {/* <span className="text-subhead font-bold gradient-text hidden sm:block">
                Kardashev
              </span> */}
            </Link>
          </div>

          {/* Center column: Desktop Navigation - flex centering prevents collision */}
          <div className="hidden md:flex flex-1 justify-center gap-x-12">
            {navigation.map((item) => {
              const isActive = isActiveLink(item.href);
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={`text-body font-semibold leading-6 uppercase tracking-wide transition-colors duration-150 hover:text-gray-300 relative ${
                    isActive
                      ? "text-white after:absolute after:-bottom-1.5 after:left-0 after:right-0 after:h-px after:bg-white/70"
                      : "text-gray-400"
                  }`}
                  aria-current={isActive ? "page" : undefined}
                >
                  {item.name}
                </Link>
              );
            })}
          </div>

          {/* Right column: Wallet (desktop) + Hamburger (mobile) */}
          <div className="flex flex-1 justify-end items-center gap-4">
            {/* Wallet - hidden on mobile, shown on desktop */}
            <div className="hidden md:block">
              <WalletSelector compact />
            </div>

            {/* Hamburger button - shown on mobile, hidden on desktop */}
            <button
              type="button"
              className="md:hidden -m-2.5 inline-flex items-center justify-center h-11 w-11 rounded-inner text-gray-400 transition-all duration-150 hover:scale-110 hover:text-white active:scale-95"
              onClick={() => setMobileMenuOpen(true)}
            >
              <span className="sr-only">Open main menu</span>
              <svg
                className="h-6 w-6"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth="1.5"
                stroke="currentColor"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
                />
              </svg>
            </button>
          </div>
        </nav>

        {/* Mobile Menu Overlay & Panel */}
        {mobileMenuOpen && (
          <>
            {/* Overlay */}
            <div
              className="fixed inset-0 z-50 bg-black/60 animate-overlay-fade-in md:hidden"
              onClick={() => setMobileMenuOpen(false)}
              aria-hidden="true"
            />

            {/* Slide-in Panel */}
            <div className="fixed inset-y-0 right-0 z-50 w-full sm:max-w-sm bg-surface-page sm:ring-1 sm:ring-gray-800 animate-slide-in-right md:hidden">
              <div className="px-6 py-6">
                {/* Panel Header */}
                <div className="flex items-center justify-between">
                  <Link
                    href="/"
                    className="-m-1.5 p-1.5 flex items-center gap-3"
                    onClick={handleNavClick}
                  >
                    <KardashevIcon size="md" />
                    <span className="text-subhead font-bold gradient-text">
                      Kardashev
                    </span>
                  </Link>
                  <button
                    type="button"
                    className="-m-2.5 h-11 w-11 inline-flex items-center justify-center rounded-inner text-gray-400 transition-all duration-150 hover:scale-110 hover:text-white active:scale-95"
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    <span className="sr-only">Close menu</span>
                    <svg
                      className="h-6 w-6"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth="1.5"
                      stroke="currentColor"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>

                {/* Navigation Links */}
                <div className="mt-6 flow-root">
                  <div className="-my-6 divide-y divide-gray-800">
                    <div className="space-y-2 py-6">
                      {navigation.map((item, index) => {
                        const isActive = isActiveLink(item.href);
                        return (
                          <Link
                            key={item.name}
                            href={item.href}
                            onClick={handleNavClick}
                            className={`animate-menu-item-enter -mx-3 block rounded-inner p-button-sm text-subhead font-semibold leading-7 transition-colors duration-200 hover:bg-white/[0.06] ${
                              isActive
                                ? "bg-white/[0.08] text-white"
                                : "text-gray-300"
                            }`}
                            style={{ animationDelay: `${index * 50}ms` }}
                          >
                            {item.name}
                          </Link>
                        );
                      })}
                    </div>

                    {/* Wallet section in mobile */}
                    <div className="py-6">
                      <div
                        className="animate-menu-item-enter"
                        style={{
                          animationDelay: `${navigation.length * 50}ms`,
                        }}
                      >
                        <WalletSelector />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col pt-20 md:pt-24">{children}</main>

      {/* Footer — F2 Stacked. Marketing chrome lives here, in one place. */}
      <footer className="border-t border-white/[0.06] bg-surface-page">
        <div className="max-w-7xl mx-auto px-6 py-10 flex flex-col items-center gap-4 text-center">
          {/* Brand lockup */}
          <div className="flex items-center gap-3">
            <KardashevIcon size="md" />
            <span className="text-subhead font-semibold tracking-tight text-white">
              Kardashev Network
            </span>
          </div>

          {/* Tagline — edit copy as needed */}
          <p className="text-body text-gray-400">
            Measuring what falls. Pricing what&apos;s missed.
          </p>

          {/* Utility links */}
          <nav className="flex items-center gap-4 text-caption text-gray-400">
            <Link
              href="/api-docs"
              className="hover:text-gray-200 transition-colors"
            >
              Docs
            </Link>
            <span aria-hidden="true" className="text-gray-700">
              &middot;
            </span>
            <Link
              href="/api-docs"
              className="hover:text-gray-200 transition-colors"
            >
              API
            </Link>
            <span aria-hidden="true" className="text-gray-700">
              &middot;
            </span>
            <a
              href="https://github.com/tadams95/kardashev-network"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 hover:text-gray-200 transition-colors"
            >
              <svg
                className="w-3.5 h-3.5"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                />
              </svg>
              GitHub
            </a>
          </nav>

          {/* Stamp — Geist Mono if you've added it, else fallback to font-mono */}
          <p className="text-micro tracking-[0.2em] text-gray-500 font-mono uppercase mt-1">
            &copy; {new Date().getFullYear()} &middot; Built on Base &amp; Solana
          </p>
        </div>
      </footer>
    </div>
  );
}
