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
    <div className="relative min-h-screen overflow-hidden bg-[#050505] -mt-20 md:-mt-24">
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
      <div className="relative z-20 flex flex-col items-center justify-center h-screen px-6 lg:px-8 pointer-events-none">
        <div className="max-w-2xl text-center">
          <h1 className="text-3xl font-bold tracking-tight text-white sm:text-5xl lg:text-6xl drop-shadow-[0_2px_20px_rgba(0,0,0,0.8)] animate-hero-fade-in hero-delay-1">
            Every second, millions in solar energy goes{' '}
            <span className="gradient-text">uncaptured</span>
          </h1>

          <p className="mt-5 text-lg sm:text-xl leading-7 text-gray-300 max-w-xl mx-auto drop-shadow-[0_2px_15px_rgba(0,0,0,0.9)] animate-hero-fade-in hero-delay-2">
            See how much energy is hitting your location right now — and the dollar value of what&apos;s being wasted.
          </p>

          <div className="relative z-20 mt-8 max-w-md mx-auto pointer-events-auto animate-hero-fade-in hero-delay-3">
            <LocationSearch navigateToDashboard />
          </div>
        </div>
      </div>
    </div>
  );
}
