// pages/about.tsx
//
// Docs-style narrative page. Migrated 2026-05-25 from raw Tailwind sizes
// (text-4xl/5xl/2xl/lg/sm) and `bg-black/40 border-gray-700/50` to the
// canonical 6-token type scale + `<Card variant="hero">` for the CTA shell.
// The amber treatment in this file:
//   - Hero accent word: matches the home hero (`text-amber-400`) — same idiom.
//   - Inline citation links: `text-amber-500` with `hover:text-amber-400`
//     brightness step. Amber-on-amber is allowed for branded inline links
//     (the deprecated pattern in DESIGN_STATE is hover-color-shift on nav).
//   - Bullet markers: `bg-amber-500` dots — content-enumeration semaphores,
//     not "our call" claims; the amber-budget rule is scoped to card surfaces
//     and these live in a plain `<section>`.

import Layout from '@/components/Layout'
import LocationSearch from '@/components/LocationSearch'
import Card from '@/components/Card'
import Link from 'next/link'

export default function About() {
  return (
    <Layout>
      <div className="max-w-3xl mx-auto px-4 py-12 sm:py-16">
        {/* Hero */}
        <div className="text-center mb-16">
          <h1 className="text-display font-semibold text-white">
            Making the Invisible{' '}
            <span className="text-amber-400">Visible</span>
          </h1>
          <p className="mt-4 text-subhead text-gray-400 max-w-xl mx-auto">
            Real-time solar energy intelligence for every location on Earth.
          </p>
        </div>

        <div className="space-y-12">
          {/* The Problem */}
          <section>
            <h2 className="text-subhead font-semibold text-white mb-4">The Problem</h2>
            <p className="text-body text-gray-300 leading-relaxed">
              Every second, millions of dollars in solar energy goes uncaptured. Most people have
              no idea how much energy is hitting their roof right now &mdash; or what that energy
              is worth. Without visibility, there&apos;s no action.
            </p>
          </section>

          {/* What is the Kardashev Scale? */}
          <section>
            <h2 className="text-subhead font-semibold text-white mb-4">What is the Kardashev Scale?</h2>
            <p className="text-body text-gray-300 leading-relaxed">
              In 1964, astronomer Nikolai Kardashev proposed measuring a civilization&apos;s
              advancement by how much energy it can harness. A Type I civilization captures all
              the energy available on its planet. A Type II harnesses its entire star. We&apos;re
              not even at Type I yet &mdash; and we won&apos;t get there without knowing what
              we&apos;re missing.
            </p>
          </section>

          {/* What Kardashev Network Does */}
          <section>
            <h2 className="text-subhead font-semibold text-white mb-4">What Kardashev Network Does</h2>
            <ul className="space-y-3 text-body text-gray-300">
              <li className="flex items-start gap-3">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />
                <span><strong className="text-white">Real-time solar irradiance</strong> at any location &mdash; how much energy is hitting that spot right now, measured in W/m².</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />
                <span><strong className="text-white">Dollar value of wasted energy</strong> &mdash; the money left on the table every hour, day, and month from uncaptured solar.</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />
                <span><strong className="text-white">Premium analytics</strong> &mdash; hourly forecasts, 7-day predictions, weather context, and roof-level analysis powered by Google Solar API.</span>
              </li>
            </ul>
          </section>

          {/* How Payments Work */}
          <section>
            <h2 className="text-subhead font-semibold text-white mb-4">How Payments Work</h2>
            <p className="text-body text-gray-300 leading-relaxed mb-4">
              Kardashev Network uses{' '}
              <a href="https://x402.org" target="_blank" rel="noopener noreferrer" className="text-amber-500 hover:text-amber-400 underline underline-offset-2">
                x402
              </a>
              , an open micropayment protocol. There are no accounts to create, no subscriptions
              to manage, and no API keys to juggle.
            </p>
            <p className="text-body text-gray-300 leading-relaxed">
              When you request premium data, your wallet signs a USDC transfer for a fraction of
              a cent. The payment settles on Base or Solana, and you get 30 minutes of premium
              access. Every API call is priced individually &mdash; you only pay for what you use.
            </p>
          </section>

          {/* The Vision */}
          <section>
            <h2 className="text-subhead font-semibold text-white mb-4">The Vision</h2>
            <p className="text-body text-gray-300 leading-relaxed">
              A world where every rooftop owner can see exactly what they&apos;re leaving on the
              table. Data is the first step toward action &mdash; and action is how we climb the
              Kardashev Scale.
            </p>
          </section>

          {/* Data Sources */}
          <section>
            <h2 className="text-subhead font-semibold text-white mb-4">Data Sources</h2>
            <p className="text-body text-gray-300 leading-relaxed">
              Solar irradiance and weather data from{' '}
              <a href="https://open-meteo.com" target="_blank" rel="noopener noreferrer" className="text-amber-500 hover:text-amber-400 underline underline-offset-2">
                Open-Meteo
              </a>
              . Roof analysis and building data from{' '}
              <a href="https://developers.google.com/maps/documentation/solar" target="_blank" rel="noopener noreferrer" className="text-amber-500 hover:text-amber-400 underline underline-offset-2">
                Google Solar API
              </a>
              .
            </p>
          </section>

          {/* CTA — hero-variant Card is borderless + elevated (surface-hero
              #1c1c1c) and carries the "act now" weight without needing the
              old `bg-black/40 + gray border + p-6 sm:p-8` recipe. */}
          <section className="pt-4">
            <Card variant="hero" as="section" className="text-center">
              <h2 className="text-subhead font-semibold text-white mb-2">See your solar potential</h2>
              <p className="text-body text-gray-400 mb-6">
                Enter any address to see real-time solar data.
              </p>
              <div className="max-w-md mx-auto mb-4">
                <LocationSearch navigateToDashboard />
              </div>
              <Link
                href="/dashboard"
                className="text-caption text-amber-500 hover:text-amber-400 transition-colors"
              >
                or go to the dashboard &rarr;
              </Link>
            </Card>
          </section>
        </div>
      </div>
    </Layout>
  )
}
