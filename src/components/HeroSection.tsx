'use client';

import dynamic from 'next/dynamic';
import LocationSearch from './LocationSearch';

// Dynamically import 3D sun scene to avoid SSR issues
const SolarGlobeScene = dynamic(() => import('./three/SolarGlobeScene'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center">
      <div className="w-32 h-32 rounded-full bg-gradient-to-br from-[#FF4D00] to-[#FFD700] opacity-40 animate-pulse" />
    </div>
  ),
});

export default function HeroSection() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#050505]">
      {/* 3D Sun Background */}
      <div className="absolute inset-0 z-0">
        <SolarGlobeScene />
      </div>

      {/* Gradient overlay for text readability */}
      <div className="absolute inset-0 z-10 pointer-events-none">
        <div className="absolute top-0 left-0 right-0 h-64 bg-gradient-to-b from-[#050505] via-[#050505]/60 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 h-48 bg-gradient-to-t from-[#050505]/80 to-transparent" />
      </div>

      {/* Content - pointer-events-none allows clicking through to canvas */}
      <div className="relative z-20 flex flex-col items-center justify-center min-h-screen px-6 lg:px-8 pointer-events-none">
        <div className="max-w-3xl text-center">
          {/* Badge */}
          <div className="mb-6 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-cyan-300/30 border border-cyan-700/20 pointer-events-auto">
            <span className="w-2 h-2 rounded-full bg-cyan-300 animate-pulse" />
            <span className="text-sm text-cyan-300 font-medium">Live Solar Data</span>
          </div>

          <h1 className="text-4xl font-bold tracking-tight text-white sm:text-6xl lg:text-7xl">
            Every second, millions in solar energy goes{' '}
            <span className="gradient-text">uncaptured</span>
          </h1>

          <p className="mt-6 text-lg sm:text-xl leading-8 text-gray-300 max-w-2xl mx-auto">
            See how much energy is hitting your location right now — and the dollar value of what&apos;s being wasted.
          </p>

          <div className="mt-8 max-w-lg mx-auto pointer-events-auto">
            <LocationSearch navigateToDashboard />
          </div>

          <p className="mt-4 text-sm text-gray-100">
            Enter your location or allow access to see real-time solar irradiance data
          </p>

          {/* Trust indicators */}
          <div className="mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-4 text-sm text-gray-100">
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
