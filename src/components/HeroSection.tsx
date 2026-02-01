'use client';

import dynamic from 'next/dynamic';
import LocationSearch from './LocationSearch';

// Dynamically import 3D sun scene to avoid SSR issues
const SolarGlobeScene = dynamic(() => import('./three/SolarGlobeScene'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-[#050505]">
      {/* Small glowing dot that matches the starting point of the spring animation */}
      <div className="w-8 h-8 rounded-full bg-gradient-radial from-[#FFD700] via-[#FF8C00] to-transparent opacity-60 blur-[2px]" />
    </div>
  ),
});

export default function HeroSection() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#050505] ">
      {/* 3D Sun Background */}
      <div className="absolute inset-0 top-20 z-0">
        <SolarGlobeScene />
      </div>

      {/* Gradient overlay for text readability */}
      <div className="absolute inset-0 z-10 pointer-events-none">
        <div className="absolute top-0 left-0 right-0 h-64 bg-gradient-to-b from-[#050505] via-[#050505]/60 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 h-48 bg-gradient-to-t from-[#050505]/80 to-transparent" />
      </div>

      {/* Content - pointer-events-none allows clicking through to canvas */}
      <div className="relative z-20 flex flex-col items-center justify-center min-h-screen px-6 lg:px-8 pointer-events-none">
        <div className="max-w-2xl text-center">
          {/* Badge */}
          <div className="mb-5 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-cyan-300/30 border border-cyan-700/20 pointer-events-auto animate-hero-fade-in hero-delay-1">
            <span className="w-2 h-2 rounded-full bg-cyan-300 animate-pulse" />
            <span className="text-sm text-cyan-300 font-medium">Live Solar Data</span>
          </div>

          <h1 className="text-3xl font-bold tracking-tight text-white sm:text-5xl lg:text-6xl animate-hero-fade-in hero-delay-2">
            Every second, millions in solar energy goes{' '}
            <span className="gradient-text">uncaptured</span>
          </h1>

          <p className="mt-5 text-lg sm:text-xl leading-7 text-gray-300 max-w-xl mx-auto animate-hero-fade-in hero-delay-3">
            See how much energy is hitting your location right now — and the dollar value of what&apos;s being wasted.
          </p>

          <div className="mt-6 max-w-md mx-auto pointer-events-auto animate-hero-fade-in hero-delay-4">
            <LocationSearch navigateToDashboard />
          </div>

          <p className="mt-3 text-sm text-gray-100 animate-hero-fade-in hero-delay-4">
            Enter your location or allow access to see real-time solar irradiance data
          </p>

          {/* Trust indicators */}
          <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-sm text-gray-100 animate-hero-fade-in hero-delay-5">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-cyan-700" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <span>Real-time data</span>
            </div>
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-cyan-700" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <span>Powered by Base</span>
            </div>
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-cyan-700" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <span>x402 micropayments</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
