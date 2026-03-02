import Layout from '@/components/Layout'

const freeEndpoints = [
  {
    path: '/api/solar/building-insights',
    description: 'Roof analysis via Google Solar API',
    params: 'lat, lng',
    cache: '24hr',
  },
  {
    path: '/api/solar/data-layers',
    description: 'Annual solar flux heatmap PNG',
    params: 'lat, lng',
    cache: '24hr',
  },
  {
    path: '/api/geocode/search',
    description: 'Forward/reverse geocoding',
    params: 'q or lat, lng, reverse=true',
    cache: 'None',
  },
  {
    path: '/api/weather/forecasts',
    description: 'Ensemble weather (4 sources)',
    params: 'city',
    cache: '15min',
  },
  {
    path: '/api/weather/bias',
    description: 'Temperature bias correction',
    params: 'cityCode',
    cache: 'None',
  },
  {
    path: '/api/kalshi/markets',
    description: 'Kalshi weather prediction markets',
    params: 'city, status (optional)',
    cache: '5min',
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
            Most endpoints are free and return cached data. One endpoint &mdash;{' '}
            <code className="text-amber-500 bg-amber-900/20 px-1.5 py-0.5 rounded text-base">/api/solar/irradiance</code>
            {' '}&mdash; supports{' '}
            <a href="https://x402.org" target="_blank" rel="noopener noreferrer" className="text-amber-500 hover:text-amber-400 underline underline-offset-2">
              x402
            </a>{' '}
            micropayments for premium live data. No API keys required.
          </p>
        </div>

        {/* Paid Endpoint */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold text-white mb-6">
            Paid Endpoint
            <span className="ml-3 inline-block text-xs font-medium uppercase tracking-wide bg-amber-500/20 text-amber-500 px-2.5 py-1 rounded-full align-middle">
              Premium
            </span>
          </h2>
          <div className="bg-black/40 border border-gray-700/50 rounded-xl p-5 sm:p-6">
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <span className="text-xs font-semibold uppercase tracking-wide bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded">GET</span>
              <code className="text-amber-500 text-sm sm:text-base">/api/solar/irradiance</code>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5 text-sm">
              <div>
                <span className="text-gray-500 text-xs uppercase tracking-wide">Params</span>
                <p className="text-gray-300 mt-1"><code className="text-amber-500/80">lat</code>, <code className="text-amber-500/80">lng</code></p>
              </div>
              <div>
                <span className="text-gray-500 text-xs uppercase tracking-wide">Price</span>
                <p className="text-white mt-1 font-mono">$0.001 USDC</p>
              </div>
              <div>
                <span className="text-gray-500 text-xs uppercase tracking-wide">Session</span>
                <p className="text-gray-300 mt-1">30 min after payment</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="bg-black/40 border border-gray-700/30 rounded-lg p-4">
                <h4 className="text-xs font-medium uppercase tracking-wide text-emerald-400 mb-2">Free Tier (cached, up to 15 min old)</h4>
                <ul className="space-y-1 text-sm text-gray-300">
                  <li>Current GHI &amp; DNI (W/m&sup2;)</li>
                  <li>Cloud cover percentage</li>
                  <li>Hourly irradiance forecast</li>
                  <li>Sunrise &amp; sunset times</li>
                </ul>
              </div>
              <div className="bg-black/40 border border-amber-500/20 rounded-lg p-4">
                <h4 className="text-xs font-medium uppercase tracking-wide text-amber-500 mb-2">Premium (live data)</h4>
                <ul className="space-y-1 text-sm text-gray-300">
                  <li>All free tier fields</li>
                  <li>7-day daily forecast</li>
                  <li>Temperature &amp; wind speed</li>
                  <li>Thermal panel efficiency</li>
                  <li>Diffuse radiation (DHI)</li>
                  <li>Weather descriptions</li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* Free Endpoints */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold text-white mb-6">
            Free Endpoints
            <span className="ml-3 inline-block text-xs font-medium uppercase tracking-wide bg-emerald-500/20 text-emerald-400 px-2.5 py-1 rounded-full align-middle">
              Free
            </span>
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-gray-700/50">
                  <th className="py-3 pr-4 text-xs uppercase tracking-wide text-gray-500 font-medium">Endpoint</th>
                  <th className="py-3 pr-4 text-xs uppercase tracking-wide text-gray-500 font-medium">Description</th>
                  <th className="py-3 pr-4 text-xs uppercase tracking-wide text-gray-500 font-medium hidden sm:table-cell">Params</th>
                  <th className="py-3 text-xs uppercase tracking-wide text-gray-500 font-medium hidden sm:table-cell">Cache</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {freeEndpoints.map(({ path, description, params, cache }) => (
                  <tr key={path}>
                    <td className="py-3 pr-4">
                      <code className="text-sm text-amber-500 bg-amber-900/20 px-2 py-0.5 rounded whitespace-nowrap">{path}</code>
                    </td>
                    <td className="py-3 pr-4 text-sm text-gray-300">{description}</td>
                    <td className="py-3 pr-4 text-sm text-gray-400 font-mono hidden sm:table-cell">{params}</td>
                    <td className="py-3 text-sm text-gray-400 hidden sm:table-cell">{cache}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* x402 Payment Flow */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold text-white mb-2">x402 Payment Flow</h2>
          <p className="text-gray-400 mb-6">
            How a developer integrates with the paid endpoint, step by step.
          </p>

          <div className="space-y-6">
            {/* Step 1 */}
            <div>
              <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wide mb-3">
                Step 1 &mdash; Free request (no headers needed)
              </h3>
              <div className="bg-black/60 border border-gray-700/50 rounded-xl p-4 overflow-x-auto">
                <pre className="text-sm text-gray-300">
                  <code>{`GET /api/solar/irradiance?lat=32.7&lng=-117.1

→ 200 OK — returns cached data (up to 15 min old)`}</code>
                </pre>
              </div>
            </div>

            {/* Step 2 */}
            <div>
              <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wide mb-3">
                Step 2 &mdash; Request premium, receive 402
              </h3>
              <div className="bg-black/60 border border-gray-700/50 rounded-xl p-4 overflow-x-auto">
                <pre className="text-sm text-gray-300">
                  <code>{`GET /api/solar/irradiance?lat=32.7&lng=-117.1
Headers:
  X-Request-Premium: true
  X-Wallet-Address: 0xYourWalletAddress

→ 402 Payment Required
{
  "accepts": [
    {
      "scheme": "exact",
      "network": "base-sepolia",
      "maxAmountRequired": "1000",
      "resource": "/api/solar/irradiance?lat=32.7&lng=-117.1",
      "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      "payTo": "0xServerWalletAddress",
      "extra": { "name": "USDC", "version": "1" }
    }
  ]
}`}</code>
                </pre>
              </div>
            </div>

            {/* Step 3 */}
            <div>
              <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wide mb-3">
                Step 3 &mdash; Sign &amp; retry with payment
              </h3>
              <p className="text-gray-400 text-sm mb-3">
                Your wallet signs a USDC payment using the details from the 402 response.
                Retry the request with the signed payment in the <code className="text-amber-500/80">x-payment</code> header.
                The server verifies the payment via the{' '}
                <a href="https://x402.org" target="_blank" rel="noopener noreferrer" className="text-amber-500 hover:text-amber-400 underline underline-offset-2">
                  x402 facilitator
                </a>.
              </p>
              <div className="bg-black/60 border border-gray-700/50 rounded-xl p-4 overflow-x-auto">
                <pre className="text-sm text-gray-300">
                  <code>{`GET /api/solar/irradiance?lat=32.7&lng=-117.1
Headers:
  X-Request-Premium: true
  X-Wallet-Address: 0xYourWalletAddress
  x-payment: <signed-payment-payload>

→ 200 OK — returns premium live data
→ X-PAYMENT-RESPONSE header included`}</code>
                </pre>
              </div>
            </div>

            {/* Step 4 */}
            <div>
              <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wide mb-3">
                Step 4 &mdash; Session (30 minutes)
              </h3>
              <p className="text-gray-400 text-sm">
                After a successful payment, the server returns a signed{' '}
                <code className="text-amber-500/80">X-SESSION-TOKEN</code> (and cookie). Subsequent requests
                using that token automatically receive premium data for 30 minutes &mdash; no further payments
                needed until session expiry. Wallet-address session lookup is supported as a legacy fallback.
              </p>
            </div>

            {/* x402-fetch snippet */}
            <div>
              <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wide mb-3">
                Automatic handling with x402-fetch
              </h3>
              <p className="text-gray-400 text-sm mb-3">
                The{' '}
                <a href="https://www.npmjs.com/package/x402-fetch" target="_blank" rel="noopener noreferrer" className="text-amber-500 hover:text-amber-400 underline underline-offset-2">
                  x402-fetch
                </a>{' '}
                library wraps <code className="text-amber-500/80">fetch</code> to handle the 402 → sign → retry flow automatically:
              </p>
              <div className="bg-black/60 border border-gray-700/50 rounded-xl p-4 overflow-x-auto">
                <pre className="text-sm text-gray-300">
                  <code>{`import { wrapFetchWithPayment } from 'x402-fetch'

const paidFetch = wrapFetchWithPayment(fetch, signer)

const res = await paidFetch(
  '/api/solar/irradiance?lat=32.7&lng=-117.1',
  {
    headers: {
      'X-Request-Premium': 'true',
      'X-Wallet-Address': address
    }
  }
)`}</code>
                </pre>
              </div>
            </div>
          </div>
        </section>

        {/* Response Examples */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold text-white mb-2">Response Examples</h2>
          <p className="text-gray-400 mb-6">
            Free vs premium responses from <code className="text-amber-500/80">/api/solar/irradiance</code>.
            Premium-only fields are highlighted.
          </p>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Free response */}
            <div>
              <h3 className="text-sm font-medium text-emerald-400 uppercase tracking-wide mb-3">Free Response</h3>
              <div className="bg-black/60 border border-gray-700/50 rounded-xl p-4 overflow-x-auto h-full">
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
    "hourly": [
      { "time": "14:00", "ghi": 542,
        "dni": 680, "cloudCover": 15 }
    ],
    "daily": {
      "sunrise": "2025-01-15T06:48:00",
      "sunset": "2025-01-15T17:12:00"
    },
    "location": {
      "latitude": 32.7,
      "longitude": -117.1,
      "timezone": "America/Los_Angeles",
      "elevation": 20
    }
  },
  "cached": true,
  "premium": false,
  "timestamp": 1736956200000
}`}</code>
                </pre>
              </div>
            </div>

            {/* Premium response */}
            <div>
              <h3 className="text-sm font-medium text-amber-500 uppercase tracking-wide mb-3">Premium Response</h3>
              <div className="bg-black/60 border border-amber-500/20 rounded-xl p-4 overflow-x-auto h-full">
                <pre className="text-sm text-gray-300">
                  <code>{`{
  "success": true,
  "data": {
    "current": {
      "ghi": 542,
      "dni": 680,
      "cloudCover": 15,
      "isDay": true,`}
                    <span className="text-amber-500">{`
      "temperature": 22.4,
      "windSpeed": 3.1,
      "diffuseRadiation": 128,
      "thermalEfficiency": 98.9,
      "weatherDescription": "Mainly clear"`}</span>{`
    },
    "hourly": [
      { "time": "14:00", "ghi": 542,
        "dni": 680, "cloudCover": 15,`}
                    <span className="text-amber-500">{`
        "diffuseRadiation": 128,
        "temperature": 22.4`}</span>{` }
    ],
    "daily": { ... },`}
                    <span className="text-amber-500">{`
    "forecast": [
      { "date": "2025-01-16",
        "radiationSum": 18.2,
        "estimatedKwh": 5.1,
        "weatherDescription": "Sunny" }
    ],`}</span>{`
    "location": { ... }
  },
  "cached": false,`}
                    <span className="text-amber-500">{`
  "premium": true,`}</span>{`
  "timestamp": 1736956200000
}`}</code>
                </pre>
              </div>
            </div>
          </div>
        </section>

        {/* Supported Networks */}
        <section className="mb-12">
          <h2 className="text-2xl font-semibold text-white mb-4">Supported Networks</h2>
          <div className="bg-black/40 border border-gray-700/50 rounded-xl p-5 space-y-4">
            <div className="flex items-start gap-3">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
              <p className="text-gray-300 text-sm">
                <strong className="text-white">Testnet (current):</strong>{' '}
                Base Sepolia (EVM, USDC), Solana Devnet
              </p>
            </div>
            <div className="flex items-start gap-3">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />
              <p className="text-gray-300 text-sm">
                <strong className="text-white">Mainnet (planned):</strong>{' '}
                Base, Solana
              </p>
            </div>
            <div className="flex items-start gap-3">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0" />
              <p className="text-gray-300 text-sm">
                <strong className="text-white">Facilitator:</strong>{' '}
                <a href="https://x402.org/facilitator" target="_blank" rel="noopener noreferrer" className="text-amber-500 hover:text-amber-400 underline underline-offset-2">
                  https://x402.org/facilitator
                </a>
              </p>
            </div>
          </div>
        </section>

        {/* Rate Limits */}
        <section>
          <h2 className="text-2xl font-semibold text-white mb-4">Rate Limits</h2>
          <div className="bg-black/40 border border-gray-700/50 rounded-xl p-5 space-y-4">
            <div className="flex items-start gap-3">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />
              <p className="text-gray-300 text-sm">
                <strong className="text-white">/api/geocode/search:</strong>{' '}
                1 request/second per IP (Nominatim upstream constraint)
              </p>
            </div>
            <div className="flex items-start gap-3">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
              <p className="text-gray-300 text-sm">
                <strong className="text-white">Free tier solar:</strong>{' '}
                Served from cache &mdash; no meaningful rate limit
              </p>
            </div>
            <div className="flex items-start gap-3">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0" />
              <p className="text-gray-300 text-sm">
                <strong className="text-white">Premium sessions:</strong>{' '}
                Higher limits during 30-minute window
              </p>
            </div>
          </div>
        </section>
      </div>
    </Layout>
  )
}
