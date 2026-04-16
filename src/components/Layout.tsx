"use client";

import { useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import KardashevIcon from "./KardashevIcon";
import WalletSelector from "./WalletSelector";

const navigation = [
  { name: "Solar", href: "/dashboard" },
  { name: "Weather", href: "/weather-forecast" },
  { name: "Analytics", href: "/weather-analytics" },
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
    <div className="min-h-screen bg-[#050505] flex flex-col">
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
              {/* <span className="text-title font-bold gradient-text hidden sm:block">
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
                  className={`nav-link-underline text-body font-semibold leading-6 uppercase tracking-wide transition-colors duration-150 hover:text-amber-500 ${
                    isActive ? "nav-link-active text-amber-500" : "text-white"
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
              className="md:hidden -m-2.5 inline-flex items-center justify-center h-11 w-11 rounded-inner text-gray-400 transition-all duration-150 hover:scale-110 hover:text-amber-500 active:scale-95"
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
            <div className="fixed inset-y-0 right-0 z-50 w-full sm:max-w-sm bg-[#050505] sm:ring-1 sm:ring-gray-800 animate-slide-in-right md:hidden">
              <div className="px-6 py-6">
                {/* Panel Header */}
                <div className="flex items-center justify-between">
                  <Link
                    href="/"
                    className="-m-1.5 p-1.5 flex items-center gap-3"
                    onClick={handleNavClick}
                  >
                    <KardashevIcon size="md" />
                    <span className="text-title font-bold gradient-text">
                      Kardashev
                    </span>
                  </Link>
                  <button
                    type="button"
                    className="-m-2.5 h-11 w-11 inline-flex items-center justify-center rounded-inner text-gray-400 transition-all duration-150 hover:scale-110 hover:text-amber-500 active:scale-95"
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
                            className={`animate-menu-item-enter -mx-3 block rounded-inner p-button-sm text-title font-semibold leading-7 transition-colors duration-200 hover:bg-gray-900 ${
                              isActive
                                ? "bg-gray-900 text-amber-500"
                                : "text-white"
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

      {/* Footer */}
      <footer className="  bg-[#050505]">
        <div className="max-w-7xl mx-auto px-4 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-body text-gray-500">
          <div className="flex items-center gap-2">
            <KardashevIcon size="sm" className="opacity-70" />
            <span>Kardashev Network</span>
          </div>
          <div className="flex items-center gap-4 text-caption sm:text-body">
            <a
              href="https://github.com/tadams95/kardashev-network"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-gray-300 transition-colors"
            >
              GitHub
            </a>
            <span className="text-gray-700">|</span>
            <span>Powered by Base & Solana</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
