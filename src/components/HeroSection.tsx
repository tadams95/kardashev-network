'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
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
    <div className="relative min-h-screen overflow-hidden bg-[#050505] -mt-20 md:-mt-24">
      {/* 3D Sun Background */}
      <div className="absolute inset-0 z-0">
        <SolarGlobeScene />
      </div>

      {/* Gradient overlay for text readability */}
      <div className="absolute inset-0 z-10 pointer-events-none">
        {/* Top gradient reduced to avoid shading the sun too heavily */}
        <div className="absolute top-0 left-0 right-0 h-48 bg-gradient-to-b from-[#050505] to-transparent opacity-90" />
        
        {/* Bottom gradient kept for ground/footer blending */}
        <div className="absolute bottom-0 left-0 right-0 h-48 bg-gradient-to-t from-[#050505] to-transparent opacity-90" />
        
        {/* Overall dim slightly reduced */}
        <div className="absolute inset-0 bg-black/10" /> 
      </div>

      {/* Content - pointer-events-none allows clicking through to canvas */}
      <div className="relative z-20 flex flex-col items-center justify-center h-screen px-6 lg:px-8 pointer-events-none">
        <div className="max-w-3xl text-center">
          <h1 className="text-4xl font-bold tracking-tight text-white sm:text-6xl lg:text-7xl drop-shadow-[0_4px_4px_rgba(0,0,0,0.8)] animate-hero-fade-in hero-delay-1">
            Every second, millions in solar energy goes{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-orange-500 drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)]">uncaptured</span>
          </h1>

          <p className="mt-8 text-xl sm:text-2xl leading-8 text-gray-200 max-w-2xl mx-auto drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] animate-hero-fade-in hero-delay-2">
            See how much energy is hitting your location right now — and the dollar value of what&apos;s being wasted.
          </p>

          <div className="relative z-20 mt-8 max-w-md mx-auto pointer-events-auto animate-hero-fade-in hero-delay-3">
            <LocationSearch navigateToDashboard />
          </div>
        </div>
      </div>

      {/* Below the fold — Feature cards */}
      <div className="relative z-20 bg-[#050505] px-6 lg:px-8 py-16 sm:py-24">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {/* Card 1 */}
            <div className="bg-black/40 border border-gray-700/50 rounded-xl p-6">
              <div className="w-10 h-10 rounded-lg bg-amber-900/30 border border-amber-700/30 flex items-center justify-center mb-4">
                <svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">See Your Solar Potential</h3>
              <p className="text-sm text-gray-400 leading-relaxed">
                Real-time irradiance data for any location. Know exactly how much energy is hitting your area right now.
              </p>
            </div>

            {/* Card 2 */}
            <div className="bg-black/40 border border-gray-700/50 rounded-xl p-6">
              <div className="w-10 h-10 rounded-lg bg-amber-900/30 border border-amber-700/30 flex items-center justify-center mb-4">
                <svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Measure What&apos;s Wasted</h3>
              <p className="text-sm text-gray-400 leading-relaxed">
                Dollar value of uncaptured solar energy per hour, day, and month. See the opportunity you&apos;re missing.
              </p>
            </div>

            {/* Card 3 */}
            <div className="bg-black/40 border border-gray-700/50 rounded-xl p-6">
              <div className="w-10 h-10 rounded-lg bg-amber-900/30 border border-amber-700/30 flex items-center justify-center mb-4">
                <svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Unlock Detailed Analysis</h3>
              <p className="text-sm text-gray-400 leading-relaxed">
                Premium data for less than a penny. Hourly forecasts, 7-day predictions, and roof-level analysis.
              </p>
            </div>
          </div>

          {/* CTA */}
          <div className="mt-10 text-center">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 px-6 py-3 bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded-xl transition-all shadow-lg shadow-amber-600/20"
            >
              Explore the Dashboard
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
