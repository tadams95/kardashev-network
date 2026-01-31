// Dashboard page - displays solar data for the selected location

import { useAccount } from 'wagmi'
import { useLocationContext } from '@/context/LocationContext'
import { usePremiumSolarData } from '@/hooks/usePremiumSolarData'
import Layout from '@/components/Layout'
import SolarMeter, { SolarMeterSkeleton } from '@/components/SolarMeter'
import WastedValue, { WastedValueSkeleton } from '@/components/WastedValue'
import LocationSearch from '@/components/LocationSearch'
import PaymentGate from '@/components/PaymentGate'
import PaymentStatus, { TierBadge, InlineUpgradePrompt } from '@/components/PaymentStatus'

export default function Dashboard() {
  const { location } = useLocationContext()
  const { isConnected } = useAccount()

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
  } = usePremiumSolarData(location?.lat, location?.lng)

  const isNighttime = solarData?.current.isDay === false
  const currentGhi = solarData?.current.ghi ?? 0
  const cloudCover = solarData?.current.cloudCover ?? 0

  // No location set - show prompt
  if (!location) {
    return (
      <Layout>
        <div className="max-w-5xl mx-auto px-4 py-16">
          <div className="text-center animate-fade-in">
            <div className="w-20 h-20 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
              <svg className="w-10 h-10 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <h1 className="text-3xl font-bold text-white mb-3">Solar Dashboard</h1>
            <p className="text-gray-400 max-w-md mx-auto mb-8">
              Enter your location to see real-time solar irradiance data and calculate your energy potential.
            </p>
            <div className="max-w-md mx-auto">
              <LocationSearch />
            </div>
          </div>
        </div>
      </Layout>
    )
  }

  // Location is set - show full dashboard
  return (
    <Layout>
      {/* Ambient background glow */}
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-green-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl" />
      </div>

      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Location Header */}
        <section className="mb-8 animate-fade-in">
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div className="w-3 h-3 rounded-full bg-green-500 animate-pulse" />
                <span className="text-sm text-gray-400 uppercase tracking-wider">Live Data</span>
                <button
                  onClick={refresh}
                  disabled={isLoading}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-800/50 hover:bg-gray-700/50 border border-gray-700/50 text-xs text-gray-300 hover:text-white transition-all disabled:opacity-50"
                >
                  <svg
                    className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  <span>{isLoading ? 'Refreshing...' : 'Refresh'}</span>
                </button>
              </div>
              <h1 className="text-3xl sm:text-4xl font-bold text-white mb-2">
                {location.city || location.address || 'Solar Dashboard'}
              </h1>
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-gray-400 font-mono text-sm">
                  {location.lat.toFixed(4)}°N, {Math.abs(location.lng).toFixed(4)}°
                  {location.lng >= 0 ? 'E' : 'W'}
                </p>
                <TierBadge isPremium={isPremium} isCached={isCached} />
              </div>
            </div>
            <div className="w-full lg:w-72">
              <LocationSearch />
            </div>
          </div>
        </section>

        {/* Error State */}
        {isError && (
          <div className="mb-8 p-4 bg-red-900/20 border border-red-800/50 rounded-2xl text-red-300 flex items-center gap-3 animate-fade-in">
            <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            Failed to load solar data. Please try again.
          </div>
        )}

        {/* Payment Status */}
        {(paymentState.isPending || paymentState.isSuccess || paymentState.isError) && (
          <div className="mb-8 animate-fade-in">
            <PaymentStatus
              status={
                paymentState.isPending
                  ? 'pending'
                  : paymentState.isSuccess
                    ? 'success'
                    : paymentState.isError
                      ? 'error'
                      : 'idle'
              }
              message={paymentState.error || undefined}
            />
          </div>
        )}

        {/* Upgrade Prompt for Free Tier */}
        {!isPremium && !isLoading && solarData && (
          <div className="mb-8 p-5 bg-gradient-to-r from-green-900/20 via-emerald-900/20 to-green-900/20 border border-green-700/30 rounded-2xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 animate-fade-in">
            <div className="flex items-start gap-4">
              <div className="p-2 bg-green-500/20 rounded-xl">
                <svg className="w-6 h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <div>
                <p className="font-semibold text-white">Upgrade to Real-Time Data</p>
                <p className="text-sm text-gray-400 mt-1">Currently viewing cached data with 15-minute delay</p>
              </div>
            </div>
            <InlineUpgradePrompt onUpgrade={upgradeToPremium} price="0.001" />
          </div>
        )}

        {/* Payment Gate Modal */}
        {showPaymentGate && paymentRequired && (
          <div className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
            <PaymentGate
              paymentRequired={paymentRequired}
              onPay={initiatePayment}
              onCancel={() => setShowPaymentGate(false)}
              isPending={paymentState.isPending}
              isSuccess={paymentState.isSuccess}
              isError={paymentState.isError}
              error={paymentState.error}
              isConnected={isConnected}
            />
          </div>
        )}

        {/* Nighttime State */}
        {isNighttime && !isLoading && (
          <div className="mb-8 p-8 bg-gradient-to-br from-gray-900/80 to-gray-800/50 border border-gray-700/50 rounded-2xl text-center animate-fade-in">
            <div className="text-6xl mb-4">🌙</div>
            <h2 className="text-2xl font-bold text-white mb-2">It&apos;s Nighttime</h2>
            <p className="text-gray-400 max-w-md mx-auto">
              No solar energy available right now. Check back after sunrise to see your location&apos;s solar potential!
            </p>
            {solarData?.hourly && (
              <p className="text-sm text-green-400 mt-4">
                Next sunlight expected around{' '}
                <span className="font-mono font-medium">
                  {solarData.hourly.find(h => h.ghi > 0)?.time.split('T')[1]?.slice(0, 5) || 'sunrise'}
                </span>
              </p>
            )}
          </div>
        )}

        {/* Main Dashboard Grid */}
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Solar Meter Card */}
          <section className="card-dark rounded-2xl p-6 card-hover animate-fade-in" style={{ animationDelay: '0.1s' }}>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
                Current Irradiance
              </h2>
              <span className="text-xs text-gray-500 uppercase tracking-wider">W/m²</span>
            </div>
            {isLoading ? (
              <SolarMeterSkeleton size="lg" />
            ) : (
              <div className="flex flex-col items-center">
                <div className={currentGhi > 0 ? 'glow-yellow' : ''}>
                  <SolarMeter ghi={currentGhi} size="lg" />
                </div>
                {cloudCover > 0 && (
                  <div className="mt-6 flex items-center gap-2 px-4 py-2 bg-gray-800/50 rounded-full text-sm text-gray-300">
                    <span>☁️</span>
                    <span>{cloudCover}% cloud cover</span>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Wasted Value Card */}
          <section className="card-dark rounded-2xl p-6 card-hover animate-fade-in" style={{ animationDelay: '0.2s' }}>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                Uncaptured Value
              </h2>
              <span className="text-xs text-gray-500 uppercase tracking-wider">USD</span>
            </div>
            {isLoading || !wastedEnergy ? (
              <WastedValueSkeleton />
            ) : (
              <div className="glow-green rounded-xl">
                <WastedValue wastedEnergy={wastedEnergy} />
              </div>
            )}
          </section>
        </div>

        {/* Hourly Forecast */}
        {solarData?.hourly && solarData.hourly.length > 0 && (
          <section className="mt-6 card-dark rounded-2xl p-6 animate-fade-in" style={{ animationDelay: '0.3s' }}>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-white">Today&apos;s Forecast</h2>
              <span className="text-xs text-gray-500">Next 12 hours</span>
            </div>
            <div className="overflow-x-auto -mx-2 px-2">
              <div className="flex gap-3 min-w-max pb-2">
                {solarData.hourly.slice(0, 12).map((hour, idx) => {
                  const time = new Date(hour.time)
                  const isNow = idx === 0
                  const hasSun = hour.ghi > 0
                  const intensity = Math.min(hour.ghi / 800, 1)

                  return (
                    <div
                      key={hour.time}
                      className={`flex flex-col items-center p-4 rounded-xl min-w-[70px] transition-all ${
                        isNow
                          ? 'bg-green-900/40 border-2 border-green-500/50 scale-105'
                          : 'bg-gray-800/30 border border-gray-700/30 hover:bg-gray-800/50'
                      }`}
                    >
                      <span className={`text-xs font-medium ${isNow ? 'text-green-400' : 'text-gray-400'}`}>
                        {isNow ? 'Now' : time.toLocaleTimeString([], { hour: 'numeric' })}
                      </span>
                      <div className="my-2 text-2xl" style={{ opacity: hasSun ? 0.5 + intensity * 0.5 : 0.5 }}>
                        {hasSun ? '☀️' : '🌙'}
                      </div>
                      <span className={`text-sm font-bold ${hasSun ? 'text-yellow-400' : 'text-gray-500'}`}>
                        {Math.round(hour.ghi)}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
            <p className="text-xs text-gray-500 mt-4 text-center">
              Values in W/m² (Global Horizontal Irradiance)
            </p>
          </section>
        )}

        {/* Info Card */}
        <section className="mt-6 bg-[#0a0a0a]/50 border border-[#1a1a1a] rounded-2xl p-6 animate-fade-in" style={{ animationDelay: '0.4s' }}>
          <div className="flex items-start gap-4">
            <div className="p-2 bg-gray-800/50 rounded-lg">
              <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-200 mb-1">How is this calculated?</h3>
              <p className="text-sm text-gray-400 leading-relaxed">
                We estimate uncaptured solar value using current irradiance, typical residential roof area (150m²),
                20% panel efficiency, and California&apos;s average rate ($0.32/kWh). Your actual potential depends
                on roof size, orientation, and local electricity rates.
              </p>
            </div>
          </div>
        </section>
      </div>
    </Layout>
  )
}
