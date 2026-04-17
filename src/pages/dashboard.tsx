// Dashboard page - premium solar data visualization

import { useEffect } from 'react'
import { useRouter } from 'next/router'
import { useLocationContext } from '@/context/LocationContext'
import { usePremiumSolarData } from '@/hooks/usePremiumSolarData'
import { useGoogleSolar } from '@/hooks/useGoogleSolar'
import { getIrradianceLevel } from '@/lib/calculations/solarValue'
import Layout from '@/components/Layout'
import LocationSearch from '@/components/LocationSearch'
import PaymentGate from '@/components/PaymentGate'
import PaymentStatus, { TierBadge } from '@/components/PaymentStatus'
import SolarCurve, { SolarCurveSkeleton } from '@/components/SolarCurve'
import RoofAnalysis, { RoofAnalysisSkeleton } from '@/components/RoofAnalysis'
import SunroofMap from '@/components/SunroofMap'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import WeekForecast from '@/components/WeekForecast'
import CountUp from 'react-countup'
import { LockClosedIcon, LockOpenIcon } from '@heroicons/react/20/solid'

function formatTime(timeStr?: string): string {
  if (!timeStr) return ''
  return new Date(timeStr).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export default function Dashboard() {
  const router = useRouter()
  const { location, setLocation } = useLocationContext()

  // Hydrate location from URL query params on mount/refresh
  useEffect(() => {
    if (!location && router.isReady && router.query.lat && router.query.lng) {
      setLocation({
        lat: parseFloat(router.query.lat as string),
        lng: parseFloat(router.query.lng as string),
        city: (router.query.city as string) || undefined,
        address: (router.query.address as string) || undefined,
      })
    }
  }, [router.isReady, router.query, location, setLocation])

  // Sync URL when location changes (e.g. via inline search on dashboard)
  useEffect(() => {
    if (location && router.isReady) {
      const query: Record<string, string> = { lat: String(location.lat), lng: String(location.lng) }
      if (location.city) query.city = location.city
      if (location.address) query.address = location.address
      router.replace({ pathname: '/dashboard', query }, undefined, { shallow: true })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location])

  // Google Solar API for roof analysis (called first so we can pass roof area below)
  const {
    roofSummary,
    isLoading: isRoofLoading,
    isAvailable: hasRoofData,
  } = useGoogleSolar(location?.lat, location?.lng)

  const {
    solarData,
    wastedEnergy,
    isLoading,
    isError,
    isPremium,
    isCached,
    paymentRequired,
    showPaymentGate,
    setShowPaymentGate,
    initiatePayment,
    paymentState,
    refresh,
    upgradeToPremium,
    isWrongChain,
    switchToCorrectChain,
    isSwitchingChain,
    requiredChainName,
    activeChainType,
    setPreferredChain,
    getExplorerTxUrl,
    isConnected,
    signerReady,
    evmConnected,
    solConnected,
  } = usePremiumSolarData(location?.lat, location?.lng, roofSummary?.recommendedAreaM2, roofSummary?.electricityRate, roofSummary?.yearlySavings)

  const isNighttime = solarData?.current.isDay === false
  const currentGhi = solarData?.current.ghi ?? 0
  const cloudCover = solarData?.current.cloudCover ?? 0
  const { label: irradianceLabel, color: irradianceColor } = getIrradianceLevel(currentGhi)

  // Calculate peak GHI from hourly data
  const peakGhi = solarData?.hourly ? Math.max(...solarData.hourly.map(h => h.ghi)) : 0

  // ── Shared section JSX (item 3.10) ─────────────────────────────────────
  // Defined once, rendered into both the mobile and desktop column slots
  // below via lg:hidden / hidden lg:block wrappers. A pure CSS-grid
  // single-placement approach was rejected because items in the same grid
  // row share row height, which created visible vertical gaps below the
  // shorter left-column items (Location, Stats, Monthly).
  const solarCurveSection = solarData?.hourly && solarData.hourly.length > 0 ? (
    <section className="bg-black/40 border border-gray-700/50 rounded-card p-card">
      <div className="mb-3 sm:mb-4">
        <h2 className="text-body font-medium text-gray-300">Solar Forecast</h2>
      </div>
      {isLoading ? (
        <SolarCurveSkeleton />
      ) : (
        <SolarCurve
          hourly={solarData.hourly}
          sunrise={solarData.daily?.sunrise ?? ''}
          sunset={solarData.daily?.sunset ?? ''}
        />
      )}
    </section>
  ) : null

  const sevenDayPremiumSection = isPremium && solarData?.forecast && solarData.forecast.length > 0 ? (
    <section className="bg-black/40 border border-amber-800/20 rounded-card p-card">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-body font-medium text-gray-300">7-Day Solar Forecast</h2>
        <span className="text-micro text-amber-500 uppercase tracking-wide font-medium flex items-center gap-1">
          <LockOpenIcon className="w-3 h-3" />
          Premium
        </span>
      </div>
      <WeekForecast forecast={solarData.forecast} usableAreaM2={roofSummary?.recommendedAreaM2} />
    </section>
  ) : null

  // Lock-card per plan §4 hybrid rule — see Phase 3 commit for context.
  const sevenDayLockCard = !isPremium && solarData ? (
    <section className="bg-black/30 border border-dashed border-gray-700/50 rounded-card p-card">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex-shrink-0 w-9 h-9 rounded-card bg-amber-900/20 border border-amber-700/30 flex items-center justify-center">
            <LockClosedIcon className="w-4 h-4 text-amber-500" />
          </div>
          <div className="min-w-0">
            <h2 className="text-body font-medium text-white">7-Day Solar Forecast</h2>
            <p className="text-caption text-gray-400">Daily irradiance, weather, and projected energy output</p>
          </div>
        </div>
        <button
          onClick={upgradeToPremium}
          className="flex-shrink-0 p-button-sm bg-amber-600/10 hover:bg-amber-600/20 border border-amber-600/30 rounded-inner text-caption font-medium text-amber-500 hover:text-amber-400 transition-all whitespace-nowrap"
        >
          Unlock
        </button>
      </div>
    </section>
  ) : null

  // No location set — show prompt with feature tease + popular city
  // shortcuts. Per plan §3.12: "redesign to be inviting, not utilitarian".
  if (!location) {
    const popularCities: { city: string; lat: number; lng: number }[] = [
      { city: 'New York',    lat: 40.7128,  lng: -74.0060 },
      { city: 'Los Angeles', lat: 34.0522,  lng: -118.2437 },
      { city: 'Chicago',     lat: 41.8781,  lng: -87.6298 },
      { city: 'Phoenix',     lat: 33.4484,  lng: -112.0740 },
    ]
    return (
      <Layout>
        <div className="flex-1 flex items-center justify-center px-4 py-12">
          <div className="text-center max-w-md">
            <div className="w-16 h-16 bg-amber-600/20 rounded-card flex items-center justify-center mx-auto mb-6 border border-amber-600/20">
              <svg className="w-8 h-8 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <h1 className="text-headline font-semibold text-white mb-2">Solar Dashboard</h1>
            <p className="text-body text-gray-400 mb-6">
              See live solar irradiance, hourly forecasts, roof analysis, and the dollar value of uncaptured energy at your location.
            </p>
            <div className="max-w-sm mx-auto mb-6">
              <LocationSearch />
            </div>
            <div className="flex flex-col items-center gap-3">
              <span className="eyebrow text-gray-500">Or jump to a city</span>
              <div className="flex flex-wrap justify-center gap-2">
                {popularCities.map(loc => (
                  <button
                    key={loc.city}
                    onClick={() => setLocation(loc)}
                    className="p-button-sm bg-black/40 hover:bg-amber-900/20 border border-gray-700/50 hover:border-amber-700/50 rounded-inner text-caption text-gray-300 hover:text-amber-400 transition-all"
                  >
                    {loc.city}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      {/* Payment Gate Modal */}
      {showPaymentGate && paymentRequired && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-50 p-card-banner">
          <PaymentGate
            paymentRequired={paymentRequired}
            onPay={initiatePayment}
            onCancel={() => setShowPaymentGate(false)}
            isPending={paymentState.isPending}
            isSuccess={paymentState.isSuccess}
            isError={paymentState.isError}
            error={paymentState.error}
            isConnected={isConnected}
            signerReady={signerReady}
            isWrongChain={isWrongChain}
            onSwitchChain={switchToCorrectChain}
            isSwitchingChain={isSwitchingChain}
            requiredChainName={requiredChainName}
            activeChainType={activeChainType}
            onChainSelect={setPreferredChain}
            evmConnected={evmConnected}
            solConnected={solConnected}
          />
        </div>
      )}

      <div className="max-w-6xl mx-auto px-4 py-4 sm:py-6">
        {/* Error State — designed surface mirroring the lock-card pattern
            (icon container + title + body copy). Per plan §3.12: visual
            treatment only — retry behavior is out of scope here, points
            users to the existing refresh button in the location card. */}
        {isError && (
          <div className="mb-6 p-card-banner bg-red-900/20 border border-red-800/50 rounded-card flex items-start gap-3">
            <div className="flex-shrink-0 w-9 h-9 rounded-card bg-red-500/10 border border-red-700/30 flex items-center justify-center">
              <svg className="w-4 h-4 text-red-400" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="min-w-0">
              <h2 className="text-body font-medium text-red-300">Couldn&apos;t load solar data</h2>
              <p className="text-caption text-red-400/80 mt-0.5">
                The data source didn&apos;t respond. Wait a moment, then use the refresh button in the location card above.
              </p>
            </div>
          </div>
        )}

        {/* Payment Status */}
        {(paymentState.isPending || paymentState.isSuccess || paymentState.isError) && (
          <div className="mb-6">
            <PaymentStatus
              status={
                paymentState.isPending ? 'pending' :
                paymentState.isSuccess ? 'success' :
                paymentState.isError ? 'error' : 'idle'
              }
              message={paymentState.error || undefined}
            />
          </div>
        )}

        {/* Transaction hash link */}
        {isPremium && paymentState.txHash && (
          <div className="mb-4 flex items-center justify-center gap-2 text-caption text-gray-500">
            <span>Tx:</span>
            <a
              href={getExplorerTxUrl(paymentState.txHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-amber-500 hover:text-amber-400 font-mono truncate max-w-[200px]"
            >
              {paymentState.txHash}
            </a>
          </div>
        )}

        {/* Two Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Column - Location, Hero Metrics & Stats */}
          <div className="space-y-6">
            {/* Location Card. Per plan §3.2: address dominates the heading
                row; TierBadge moves to the top-right paired with the refresh
                button (data-freshness signals grouped). Lat/lng demoted to
                text-micro/gray-600 — kept per OQ#3 ("keep but demote") but
                no longer competes for attention. */}
            <section className="bg-black/40 border border-gray-700/50 rounded-card p-card">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="flex-shrink-0 w-10 h-10 rounded-card bg-amber-900/30 border border-amber-700/30 flex items-center justify-center">
                    <svg className="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </div>
                  <div className="min-w-0 flex-1">
                    <h1 className="text-title font-semibold text-white truncate">
                      {location.address || location.city || 'Current Location'}
                    </h1>
                    <div className="flex items-center gap-3 mt-0.5">
                      <div className="flex items-center gap-1.5 text-caption">
                        <span className={`w-1.5 h-1.5 rounded-full ${isNighttime ? 'bg-indigo-400' : 'bg-emerald-400'} animate-pulse`} />
                        <span className="text-gray-400">
                          {isNighttime ? `Night · Sunrise ${formatTime(solarData?.daily?.sunrise)}` : 'Day'}
                        </span>
                      </div>
                      <span className="text-micro text-gray-600 font-mono">
                        {location.lat.toFixed(4)}°N, {Math.abs(location.lng).toFixed(4)}°{location.lng >= 0 ? 'E' : 'W'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Data-freshness cluster: tier badge + refresh button */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <TierBadge isPremium={isPremium} isCached={isCached} />
                  <button
                    onClick={refresh}
                    disabled={isLoading}
                    className="p-2 rounded-inner bg-black/60 hover:bg-white/10 border border-gray-700/50 text-gray-400 hover:text-white transition-all disabled:opacity-50"
                    title="Refresh data"
                    aria-label="Refresh data"
                  >
                    <svg
                      className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  </button>
                </div>
              </div>
            </section>

            {/* Hero — Uncaptured Today (today = focal, /hr = live indicator).
                See docs/work/solar-dashboard-visual-plan.md §3.1 + §6 decision. */}
            <section className="bg-black/30 rounded-card p-card-hero">
              {isLoading || !wastedEnergy ? (
                /* Hero skeleton — matches the loaded hero footprint per
                   item 3.11. Placeholders mirror: eyebrow / display
                   number / live indicator / irradiance row / progress
                   bar. Prevents layout jump on data arrival. */
                <div className="animate-pulse text-center">
                  <div className="h-4 w-32 bg-gray-700/50 rounded-chip mx-auto mb-2" />
                  <div className="h-20 w-48 bg-gray-700/50 rounded-inner mx-auto mb-2" />
                  <div className="h-3 w-40 bg-gray-700/50 rounded-chip mx-auto mb-4" />
                  <div className="h-4 w-36 bg-gray-700/50 rounded-chip mx-auto mb-4" />
                  <div className="max-w-xs mx-auto">
                    <div className="h-2 w-full bg-gray-700/50 rounded-full" />
                    <div className="flex justify-between mt-1.5">
                      <div className="h-3 w-4 bg-gray-700/50 rounded-chip" />
                      <div className="h-3 w-12 bg-gray-700/50 rounded-chip" />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center">
                  <div className="eyebrow text-gray-500 mb-2">Uncaptured Today</div>
                  <div className="flex items-baseline justify-center gap-1">
                    <span className="text-title sm:text-headline text-gray-400 font-light">$</span>
                    <span className="text-display font-bold text-white tracking-tight">
                      <CountUp end={wastedEnergy.todayValue} decimals={2} duration={1} preserveValue />
                    </span>
                  </div>

                  {/* Live /hr indicator — preserves the "live instrument" feel
                      after demoting /hr from the hero. Pulsing dot conveys
                      that the rate is still ticking. */}
                  <div className="mt-2 flex items-center justify-center gap-2 text-caption text-gray-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-live-pulse" />
                    <span>
                      $<CountUp end={wastedEnergy.currentValue} decimals={2} duration={1} preserveValue />/hr right now
                    </span>
                  </div>

                  <div className="mt-4 flex items-center justify-center gap-3">
                    <span className={`text-body font-medium ${irradianceColor}`}>
                      {irradianceLabel}
                    </span>
                    {/* Cloud chip renders unconditionally — "Clear sky" at 0%
                        distinguishes a real reading from data-missing
                        (per plan §3.1 cloud-cover sub-checkbox). */}
                    <span className="text-gray-600">•</span>
                    <span className="text-body text-gray-400">
                      {cloudCover === 0 ? 'Clear sky' : `${cloudCover}% cloud cover`}
                    </span>
                  </div>

                  {/* Progress bar — current irradiance intensity. Tightened
                      `mt-3` and widened to `max-w-sm` to read as part of the
                      hero block (plan §3.1 progress-bar sub-checkbox)
                      rather than a separate widget below. */}
                  <div className="mt-3 max-w-sm mx-auto">
                    <div className="h-2 bg-gray-700/50 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-amber-500 rounded-full transition-all duration-500"
                        style={{ width: `${Math.min((currentGhi / 1000) * 100, 100)}%` }}
                      />
                    </div>
                    <div className="flex justify-between mt-1.5 text-caption text-gray-500">
                      <span>0</span>
                      <span>1000 W/m²</span>
                    </div>
                  </div>
                </div>
              )}
            </section>

            {/* Weather Context - Premium */}
            {isPremium && solarData?.current.weatherDescription !== undefined && (
              <section className="bg-black/40 border border-amber-800/20 rounded-card p-card-banner">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <span className="text-body text-gray-300">{solarData.current.weatherDescription}</span>
                    {solarData.current.temperature !== undefined && (
                      <span className="text-body text-white font-medium">{solarData.current.temperature.toFixed(1)}°C</span>
                    )}
                    {solarData.current.windSpeed !== undefined && (
                      <span className="text-body text-gray-400">{solarData.current.windSpeed.toFixed(1)} m/s wind</span>
                    )}
                  </div>
                  {isPremium && solarData.current.thermalEfficiency !== undefined && solarData.current.thermalEfficiency < 100 && (
                    <span className="text-caption text-amber-400 bg-amber-900/30 border border-amber-700/30 rounded-full p-chip">
                      Panel eff. {Math.round(solarData.current.thermalEfficiency)}%{' '}
                      ({((solarData.current.thermalEfficiency - 100)).toFixed(1)}% heat)
                    </span>
                  )}
                </div>
              </section>
            )}

            {/* Weather Context locked stub removed — see plan §4 (locked-state
                vocabulary: "Weather Context" was an empty placeholder; jargon
                without a real preview, removed per the hybrid rule). */}

            {/* Stats Row — free tier renders 3-up; premium expands to 4-up
                only when diffuse data is present. The skeleton state also
                renders 3-up so free tier never reflows on load. */}
            <section className={`grid gap-2 sm:gap-3 ${
              isPremium && solarData?.current.diffuseRadiation !== undefined
                ? 'grid-cols-2 sm:grid-cols-4'
                : 'grid-cols-3'
            }`}>
              {/* Irradiance */}
              <div className="bg-black/40 border border-gray-700/50 rounded-card p-card-sm">
                <div className="text-micro sm:text-caption text-gray-500 uppercase tracking-wide mb-1">Irradiance</div>
                {isLoading ? (
                  <div className="h-6 sm:h-7 w-14 sm:w-16 bg-gray-700/50 rounded-chip animate-pulse" />
                ) : (
                  <div className="text-title font-semibold text-amber-500">
                    {Math.round(currentGhi).toLocaleString()}
                    <span className="text-caption sm:text-body font-normal text-gray-500"> W/m²</span>
                  </div>
                )}
              </div>

              {/* Today's Potential */}
              <div className="bg-black/40 border border-gray-700/50 rounded-card p-card-sm">
                <div className="text-micro sm:text-caption text-gray-500 uppercase tracking-wide mb-1">Today</div>
                {isLoading || !wastedEnergy ? (
                  <div className="h-6 sm:h-7 w-14 sm:w-16 bg-gray-700/50 rounded-chip animate-pulse" />
                ) : (
                  <div className="text-title font-semibold text-white">
                    $<CountUp end={wastedEnergy.todayValue} decimals={0} duration={1} preserveValue />
                  </div>
                )}
              </div>

              {/* Peak Today */}
              <div className="bg-black/40 border border-gray-700/50 rounded-card p-card-sm">
                <div className="text-micro sm:text-caption text-gray-500 uppercase tracking-wide mb-1">Peak</div>
                {isLoading ? (
                  <div className="h-6 sm:h-7 w-14 sm:w-16 bg-gray-700/50 rounded-chip animate-pulse" />
                ) : (
                  <div className="text-title font-semibold text-yellow-400">
                    {Math.round(peakGhi).toLocaleString()}
                    <span className="text-caption sm:text-body font-normal text-gray-500"> W/m²</span>
                  </div>
                )}
              </div>

              {/* Direct/Diffuse - Premium */}
              {isPremium && solarData?.current.diffuseRadiation !== undefined && (
                <div className="bg-black/40 border border-amber-800/20 rounded-card p-card-sm">
                  <div className="text-micro sm:text-caption text-gray-500 uppercase tracking-wide mb-1">Direct/Diffuse</div>
                  {isLoading ? (
                    <div className="h-6 sm:h-7 w-14 sm:w-16 bg-gray-700/50 rounded-chip animate-pulse" />
                  ) : (
                    <div>
                      <div className="text-title font-semibold text-white">
                        {Math.round(((currentGhi - (solarData.current.diffuseRadiation ?? 0)) / Math.max(currentGhi, 1)) * 100)}%
                        <span className="text-caption sm:text-body font-normal text-gray-500"> direct</span>
                      </div>
                      <div className="text-caption text-gray-400 mt-0.5">
                        {Math.round(solarData.current.diffuseRadiation)} W/m² diffuse
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Direct/Diffuse locked stub removed — see plan §4. The
                  jargon ("direct vs diffuse radiation") doesn't sell a free
                  visitor on premium, and the `--` placeholder read as broken.
                  Free tier collapses cleanly to a 3-up grid. */}
            </section>

            {/* Solar Curve + 7-Day Forecast — mobile slots. Source content
                lives in `solarCurveSection` / `sevenDayPremiumSection` /
                `sevenDayLockCard` defined at the top of the component
                (item 3.10). The desktop column re-uses the same variables
                via `hidden lg:block` wrappers. */}
            {solarCurveSection && <div className="lg:hidden">{solarCurveSection}</div>}
            {sevenDayPremiumSection && <div className="lg:hidden">{sevenDayPremiumSection}</div>}
            {sevenDayLockCard && <div className="lg:hidden">{sevenDayLockCard}</div>}

            {/* Monthly Estimate Banner — opportunity-size pitch.
                Promoted per §3.9, kept smaller than the today hero so
                today → monthly reads as "actual / potential". Per
                premium UX plan §4 Option D the widget renders only when
                Google Solar covers this location (yearlySavings/12 is
                grounded in actual roof imagery); without coverage we
                hide rather than substitute today's hourly-extrapolation.
                The WeekForecast lock-card still drives conversion for
                non-covered locations. */}
            {wastedEnergy && wastedEnergy.monthlyEstimate != null && !isLoading && (
              <section className="bg-amber-900/20 border border-amber-800/30 rounded-card p-card flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <div className="eyebrow text-amber-500/80 mb-1">Monthly potential</div>
                  <div className="text-headline font-bold text-white">
                    $<CountUp end={wastedEnergy.monthlyEstimate} separator="," duration={1.5} preserveValue />
                  </div>
                </div>
                {!isPremium && (
                  /* Per plan §3.9 tooltip-discoverability sub-checkbox: the
                     old "?" circle hid the x402 explainer behind a click no
                     one made. Replaced with always-visible inline copy + a
                     "Learn more" link to x402.org. */
                  <div className="flex flex-col items-stretch sm:items-end gap-1.5 w-full sm:w-auto">
                    <button
                      onClick={upgradeToPremium}
                      className="p-button-md bg-amber-600 hover:bg-amber-700 rounded-inner text-caption sm:text-body font-medium text-white transition-all flex items-center justify-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      Unlock Premium · $0.001
                    </button>
                    <p className="text-caption text-gray-500 sm:text-right max-w-[16rem]">
                      One x402 micropayment, no account.{' '}
                      <a
                        href="https://x402.org"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-amber-500 hover:text-amber-400 underline underline-offset-2"
                      >
                        Learn more
                      </a>
                    </p>
                  </div>
                )}
              </section>
            )}
          </div>

          {/* Right Column - Charts & Analysis */}
          <div className="space-y-6">
            {/* Solar Curve + 7-Day Forecast — desktop slots. Same JSX
                variables as the mobile slots above (item 3.10). */}
            {solarCurveSection && <div className="hidden lg:block">{solarCurveSection}</div>}
            {sevenDayPremiumSection && <div className="hidden lg:block">{sevenDayPremiumSection}</div>}
            {sevenDayLockCard && <div className="hidden lg:block">{sevenDayLockCard}</div>}

            {/* Solar Roof Map. Wrapped in ErrorBoundary per plan §3.8 —
                if the Google Maps load or GroundOverlay attach throws, the
                rest of the dashboard stays alive. */}
            {hasRoofData && location && (
              <ErrorBoundary sectionName="the solar roof map">
                <section className="bg-black/40 border border-gray-700/50 rounded-card p-card">
                  <SunroofMap lat={location.lat} lng={location.lng} />
                </section>
              </ErrorBoundary>
            )}

            {/* Roof Analysis - Google Solar API. Wrapped per §3.8 — bad
                roofSummary shape inside RoofAnalysis throws (e.g.,
                segments[].reduce on empty after a guard removal) won't
                take the page down. */}
            {(isRoofLoading || hasRoofData) && (
              <ErrorBoundary sectionName="the roof analysis">
                <section className="bg-black/40 border border-gray-700/50 rounded-card p-card">
                  {isRoofLoading ? (
                    <RoofAnalysisSkeleton />
                  ) : roofSummary ? (
                    <RoofAnalysis roofSummary={roofSummary} />
                  ) : null}
                </section>
              </ErrorBoundary>
            )}
          </div>
        </div>

        {/* Info Footer */}
        <p className="mt-6 text-caption text-gray-600 text-center leading-relaxed">
          {hasRoofData && roofSummary
            ? `Based on ${Math.round(roofSummary.recommendedAreaM2)}m² recommended panel area, ${roofSummary.panelCount} panels (of ${roofSummary.maxPanels} max), 20% panel efficiency, 14% system losses, and $${roofSummary.electricityRate.toFixed(2)}/kWh.`
            : 'Estimates based on 150m² roof (65% usable), 20% panel efficiency, 14% system losses, and $0.16/kWh.'
          }
          {' '}Actual values depend on your specific setup and location.
        </p>
      </div>
    </Layout>
  )
}
