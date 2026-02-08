import Layout from '@/components/Layout'
import { X402_PRICING } from '@/lib/x402/config'

const endpoints = [
  {
    path: '/api/solar/irradiance',
    pricing: X402_PRICING['/api/solar/irradiance'],
  },
  {
    path: '/api/geocode/search',
    pricing: X402_PRICING['/api/geocode/search'],
  },
  {
    path: '/api/grid/carbon',
    pricing: X402_PRICING['/api/grid/carbon'],
  },
  {
    path: '/api/buildings/area',
    pricing: X402_PRICING['/api/buildings/area'],
  },
  {
    path: '/api/premium/analytics',
    pricing: X402_PRICING['/api/premium/analytics'],
  },
]

export default function ApiDocs() {
  return (
    <Layout>
      <div className="max-w-4xl mx-auto px-4 py-12 sm:py-16">
        {/* Header */}
        <div className="mb-12">
          <h1 className="text-4xl font-bold text-white tracking-tight">API Documentation</h1>
          <p className="mt-4 text-lg text-gray-400 max-w-2xl">
            Kardashev Network exposes solar energy data through x402-monetized REST endpoints.
            No API keys &mdash; pay per call with USDC micropayments.
          </p>
        </div>

        {/* Endpoints Table */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold text-white mb-6">Endpoints</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-gray-700/50">
                  <th className="py-3 pr-4 text-xs uppercase tracking-wide text-gray-500 font-medium">Endpoint</th>
                  <th className="py-3 pr-4 text-xs uppercase tracking-wide text-gray-500 font-medium">Price</th>
                  <th className="py-3 pr-4 text-xs uppercase tracking-wide text-gray-500 font-medium">Description</th>
                  <th className="py-3 text-xs uppercase tracking-wide text-gray-500 font-medium">Free Tier</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {endpoints.map(({ path, pricing }) => (
                  <tr key={path}>
                    <td className="py-3 pr-4">
                      <code className="text-sm text-amber-500 bg-amber-900/20 px-2 py-0.5 rounded">{path}</code>
                    </td>
                    <td className="py-3 pr-4 text-sm text-white font-mono">{pricing.price} USDC</td>
                    <td className="py-3 pr-4 text-sm text-gray-300">{pricing.description}</td>
                    <td className="py-3 text-sm">
                      {pricing.freeTier ? (
                        <span className="text-emerald-400">Yes</span>
                      ) : (
                        <span className="text-gray-500">No</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Example Request */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold text-white mb-6">Example Request</h2>

          <div className="space-y-6">
            {/* Free tier request */}
            <div>
              <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wide mb-3">Free Tier (cached data)</h3>
              <div className="bg-black/60 border border-gray-700/50 rounded-xl p-4 overflow-x-auto">
                <pre className="text-sm text-gray-300">
                  <code>{`GET /api/solar/irradiance?lat=32.7&lng=-117.1`}</code>
                </pre>
              </div>
            </div>

            {/* Premium request */}
            <div>
              <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wide mb-3">Premium (live data + forecasts)</h3>
              <div className="bg-black/60 border border-gray-700/50 rounded-xl p-4 overflow-x-auto">
                <pre className="text-sm text-gray-300">
                  <code>{`GET /api/solar/irradiance?lat=32.7&lng=-117.1
Headers:
  X-Request-Premium: true
  X-Wallet-Address: 0xYourWalletAddress`}</code>
                </pre>
              </div>
            </div>

            {/* Example response */}
            <div>
              <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wide mb-3">Response</h3>
              <div className="bg-black/60 border border-gray-700/50 rounded-xl p-4 overflow-x-auto">
                <pre className="text-sm text-gray-300">
                  <code>{`{
  "success": true,
  "data": {
    "current": {
      "ghi": 542,
      "dni": 680,
      "cloudCover": 15,
      "isDay": true
    },
    "hourly": [...],
    "daily": {
      "sunrise": "2025-01-15T06:48:00",
      "sunset": "2025-01-15T17:12:00"
    }
  },
  "cached": false,
  "timestamp": "2025-01-15T14:30:00Z"
}`}</code>
                </pre>
              </div>
            </div>
          </div>
        </section>

        {/* Authentication */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold text-white mb-4">Authentication</h2>
          <p className="text-gray-300 leading-relaxed mb-4">
            Kardashev Network uses the{' '}
            <a href="https://x402.org" target="_blank" rel="noopener noreferrer" className="text-amber-500 hover:text-amber-400 underline underline-offset-2">
              x402 protocol
            </a>{' '}
            instead of API keys. When you request premium data without a valid payment session,
            the server responds with HTTP <code className="text-amber-500 bg-amber-900/20 px-1.5 py-0.5 rounded">402 Payment Required</code> and
            includes payment details in the response body.
          </p>
          <p className="text-gray-300 leading-relaxed">
            Your wallet signs a USDC payment for the requested amount. Once confirmed, you receive
            a 30-minute session with full premium access &mdash; no further payments needed until
            it expires.
          </p>
        </section>

        {/* Pricing */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold text-white mb-4">Pricing</h2>
          <div className="bg-black/40 border border-gray-700/50 rounded-xl p-5 space-y-4">
            <div className="flex items-start gap-3">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
              <p className="text-gray-300 text-sm">
                <strong className="text-white">Free tier:</strong> Endpoints with free tier access return cached or delayed data at no cost.
              </p>
            </div>
            <div className="flex items-start gap-3">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />
              <p className="text-gray-300 text-sm">
                <strong className="text-white">Premium:</strong> Pay a fraction of a cent in USDC on Base or Solana to unlock live data, hourly forecasts, 7-day predictions, and roof-level analysis.
              </p>
            </div>
            <div className="flex items-start gap-3">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0" />
              <p className="text-gray-300 text-sm">
                <strong className="text-white">Sessions:</strong> A single payment grants 30 minutes of premium access across all endpoints.
              </p>
            </div>
          </div>
        </section>

        {/* Rate Limits */}
        <section>
          <h2 className="text-2xl font-semibold text-white mb-4">Rate Limits</h2>
          <p className="text-gray-300 leading-relaxed">
            Free tier requests are rate-limited to 1 request per second per IP. Premium sessions
            have higher limits. Geocoding requests are debounced client-side to respect upstream
            rate limits.
          </p>
        </section>
      </div>
    </Layout>
  )
}
