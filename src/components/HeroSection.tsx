// components/HeroSection.tsx
//
// L1 two-column hero. Text-left, sun-right.
//
// Compared to the pre-2026-05-20 hero:
//   - Headline + subhead + search live in a left column (no scrim needed).
//   - <SolarGlobeScene /> lives in a right column with <KardashevDialOverlay />
//     drawn on top of it. Sun's interactivity is fully preserved (overlay is
//     pointer-events:none).
//   - The five "make text readable" tricks (two scrim gradients, dim layer,
//     two drop-shadows) are gone. Text and sun no longer compete for pixels.
//   - The R3F canvas (#050505) used to seam against bg-surface-page (#070707)
//     at the column edges; a soft radial mask dissolves that seam into a
//     vignette and concentrates attention on the sun. The mask sits on the
//     wrapping div, NOT on the canvas — components/three/ is unchanged.

'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import LocationSearch from './LocationSearch';
import KardashevDialOverlay from './KardashevDialOverlay';
import Card from './Card';

// Dynamically import 3D sun scene to avoid SSR issues.
const SolarGlobeScene = dynamic(() => import('./three/SolarGlobeScene'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center">
      <div className="w-8 h-8 rounded-full bg-gradient-radial from-[#FFD700] via-[#FF8C00] to-transparent opacity-60 blur-[2px]" />
    </div>
  ),
});

export default function HeroSection() {
  return (
    <div className="relative bg-surface-page -mt-20 md:-mt-24">
      {/* HERO ────────────────────────────────────────────────────────────── */}
      {/* Section is a flex container that vertically centers a max-w-7xl
          inner grid. The centering frame keeps the two columns from sprawling
          to the viewport edges on ≥1920px displays — without it, text pins
          hard-left and sun pins hard-right with no optical relationship.
          min-h-[85vh] keeps the hero feeling generous while pulling the
          feature cards visibly above the fold on a 14" laptop. */}
      <section className="relative min-h-[85vh] flex items-center pt-28 lg:pt-24 pb-20 lg:pb-0">
        <div
          className="
            w-full max-w-7xl mx-auto
            grid grid-cols-1 lg:grid-cols-[1.1fr_1fr]
            items-center gap-10 lg:gap-12
            px-6 lg:px-12
          "
        >
        {/* LEFT · TEXT COLUMN */}
        <div className="relative z-10 max-w-2xl lg:order-1">
          {/* Eyebrow names the scale up front. */}
          <div className="text-xs font-mono font-semibold uppercase tracking-[0.2em] text-amber-400 mb-5 animate-hero-fade-in hero-delay-1">
            Kardashev · Type I infrastructure
          </div>

          {/* Headline — no drop-shadow needed; it's on a clean dark column now. */}
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-semibold tracking-tight text-white leading-[1.05] animate-hero-fade-in hero-delay-1">
            Every second, millions in solar energy goes{' '}
            <span className="text-amber-400">uncaptured</span>
          </h1>

          {/* Subhead bumped one tier (text-lg→text-xl, gray-400→gray-300) so
              it doesn't whisper against the text-6xl headline. */}
          <p className="mt-6 text-xl lg:text-2xl text-gray-300 max-w-xl leading-relaxed animate-hero-fade-in hero-delay-2">
            See how much energy is hitting your location right now &mdash; and the
            dollar value of what&apos;s being wasted.
          </p>

          <div className="mt-8 max-w-md animate-hero-fade-in hero-delay-3">
            <LocationSearch navigateToDashboard />
          </div>
        </div>

        {/* RIGHT · SUN COLUMN */}
        {/* aspect-square so the sun's container is predictable regardless of
            grid sizing. max-w caps it on ultra-wide displays. mx-auto centers
            it within the column. */}
        <div className="relative aspect-square w-full max-w-[640px] mx-auto lg:order-2">
          {/* R3F canvas wrapped in a soft radial mask + 12% inset.
              The inset shrinks the rendered sun (the canvas scales to its
              container) so the dial's Type I ring sits cleanly OUTSIDE the
              sun's edge instead of bisecting it — fixes the dial-on-sun
              overlap without reaching into components/three/.
              The mask fades the canvas to transparent at the wrapper's
              edges so the #050505 R3F background doesn't seam against
              bg-surface-page. Result: sun-centered vignette, no visible
              square, dial properly orbits the sun. */}
          <div className="absolute inset-[12%] [mask-image:radial-gradient(circle_at_center,black_55%,transparent_82%)] [-webkit-mask-image:radial-gradient(circle_at_center,black_55%,transparent_82%)]">
            <SolarGlobeScene />
          </div>

          {/* The Kardashev dial as SVG overlay. Sits ABOVE the masked canvas
              wrapper so the rings stay crisp at full opacity.
              pointer-events:none lets drags pass through to the sun. */}
          <KardashevDialOverlay />
        </div>
        </div>
      </section>

      {/* BELOW THE FOLD · FEATURE CARDS ─────────────────────────────────── */}
      <div className="relative z-20 bg-surface-page px-6 lg:px-8 py-16 sm:py-24">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {/* Card 1 */}
            <Card noPadding className="p-6">
              <div className="w-10 h-10 rounded-lg bg-amber-900/30 border border-amber-700/30 flex items-center justify-center mb-4">
                <svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">See Your Solar Potential</h3>
              <p className="text-sm text-gray-400 leading-relaxed">
                Real-time irradiance data for any location. Know exactly how much energy is hitting your area right now.
              </p>
            </Card>

            {/* Card 2 */}
            <Card noPadding className="p-6">
              <div className="w-10 h-10 rounded-lg bg-amber-900/30 border border-amber-700/30 flex items-center justify-center mb-4">
                <svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Measure What&apos;s Wasted</h3>
              <p className="text-sm text-gray-400 leading-relaxed">
                Dollar value of uncaptured solar energy per hour, day, and month. See the opportunity you&apos;re missing.
              </p>
            </Card>

            {/* Card 3 */}
            <Card noPadding className="p-6">
              <div className="w-10 h-10 rounded-lg bg-amber-900/30 border border-amber-700/30 flex items-center justify-center mb-4">
                <svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Unlock Detailed Analysis</h3>
              <p className="text-sm text-gray-400 leading-relaxed">
                Premium data for less than a penny. Hourly forecasts, 7-day predictions, and roof-level analysis.
              </p>
            </Card>
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
