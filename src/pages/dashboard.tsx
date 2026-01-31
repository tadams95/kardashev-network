// Dashboard page - premium solar data visualization

import { useAccount } from 'wagmi'
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
import CountUp from 'react-countup'

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

  // Google Solar API for roof analysis
  const {
    roofSummary,
    isLoading: isRoofLoading,
    isAvailable: hasRoofData,
  } = useGoogleSolar(location?.lat, location?.lng)

  const isNighttime = solarData?.current.isDay === false
  const currentGhi = solarData?.current.ghi ?? 0
  const cloudCover = solarData?.current.cloudCover ?? 0
  const { label: irradianceLabel, color: irradianceColor } = getIrradianceLevel(currentGhi)

  // Calculate peak GHI from hourly data
  const peakGhi = solarData?.hourly ? Math.max(...solarData.hourly.map(h => h.ghi)) : 0

  // No location set - show prompt
  if (!location) {
    return (
      <Layout>
        <div className="flex-1 flex items-center justify-center px-4">
          <div className="text-center max-w-sm">
            <div className="w-16 h-16 bg-gradient-to-br from-green-500/20 to-emerald-500/20 rounded-2xl flex items-center justify-center mx-auto mb-6 border border-green-500/20">
              <svg className="w-8 h-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <h1 className="text-2xl font-semibold text-white mb-2">Solar Dashboard</h1>
            <p className="text-gray-400 mb-8">
              Enter your location to view real-time solar irradiance data
            </p>
            <div className="max-w-sm mx-auto">
              <LocationSearch />
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
        <div className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-50 p-4">
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

      <div className="max-w-3xl mx-auto px-4 py-6">
        {/* Header Bar */}
        <header className="flex items-center justify-between gap-4 mb-8">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-white truncate">
              {location.city || location.address || 'Dashboard'}
            </h1>
            <p className="text-sm text-gray-500 font-mono">
              {location.lat.toFixed(4)}°N, {Math.abs(location.lng).toFixed(4)}°{location.lng >= 0 ? 'E' : 'W'}
            </p>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <TierBadge isPremium={isPremium} isCached={isCached} />
            <button
              onClick={refresh}
              disabled={isLoading}
              className="p-2 rounded-lg bg-gray-800/50 hover:bg-gray-700/50 border border-gray-700/50 text-gray-400 hover:text-white transition-all disabled:opacity-50"
              title="Refresh data"
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
        </header>

        {/* Error State */}
        {isError && (
          <div className="mb-6 p-4 bg-red-900/20 border border-red-800/50 rounded-xl text-red-300 text-sm flex items-center gap-3">
            <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            Failed to load solar data. Please try again.
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

        {/* Nighttime State */}
        {isNighttime && !isLoading && (
          <div className="mb-6 p-6 bg-gradient-to-br from-gray-900/80 to-gray-800/50 border border-gray-700/50 rounded-2xl text-center">
            <div className="text-4xl mb-3">🌙</div>
            <h2 className="text-lg font-semibold text-white mb-1">It&apos;s Nighttime</h2>
            <p className="text-sm text-gray-400">
              No solar energy available. Check back after sunrise.
            </p>
          </div>
        )}

        {/* Hero Metric - Current Irradiance */}
        <section className="bg-gradient-to-br from-gray-900/60 to-gray-800/40 border border-gray-700/40 rounded-2xl p-8 mb-6">
          {isLoading ? (
            <div className="animate-pulse text-center">
              <div className="h-20 w-48 bg-gray-700/50 rounded-lg mx-auto mb-3" />
              <div className="h-5 w-32 bg-gray-700/50 rounded mx-auto" />
            </div>
          ) : (
            <div className="text-center">
              <div className="flex items-baseline justify-center gap-2">
                <span className="text-6xl sm:text-7xl font-bold text-white tracking-tight">
                  {Math.round(currentGhi).toLocaleString()}
                </span>
                <span className="text-2xl text-gray-400 font-light">W/m²</span>
              </div>
              <div className="mt-3 flex items-center justify-center gap-3">
                <span className={`text-sm font-medium ${irradianceColor}`}>
                  {irradianceLabel}
                </span>
                {cloudCover > 0 && (
                  <>
                    <span className="text-gray-600">•</span>
                    <span className="text-sm text-gray-400">
                      {cloudCover}% cloud cover
                    </span>
                  </>
                )}
              </div>

              {/* Progress bar */}
              <div className="mt-6 max-w-xs mx-auto">
                <div className="h-2 bg-gray-700/50 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-yellow-500 to-green-500 rounded-full transition-all duration-500"
                    style={{ width: `${Math.min((currentGhi / 1000) * 100, 100)}%` }}
                  />
                </div>
                <div className="flex justify-between mt-1.5 text-xs text-gray-500">
                  <span>0</span>
                  <span>1000 W/m²</span>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Stats Row */}
        <section className="grid grid-cols-3 gap-3 mb-6">
          {/* Uncaptured Value */}
          <div className="bg-gray-900/60 border border-gray-700/40 rounded-xl p-4">
            <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Uncaptured</div>
            {isLoading || !wastedEnergy ? (
              <div className="h-7 w-16 bg-gray-700/50 rounded animate-pulse" />
            ) : (
              <div className="text-xl font-semibold text-green-400">
                $<CountUp end={wastedEnergy.currentValue} decimals={2} duration={1} preserveValue />
                <span className="text-sm font-normal text-gray-500">/hr</span>
              </div>
            )}
          </div>

          {/* Today's Potential */}
          <div className="bg-gray-900/60 border border-gray-700/40 rounded-xl p-4">
            <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Today</div>
            {isLoading || !wastedEnergy ? (
              <div className="h-7 w-16 bg-gray-700/50 rounded animate-pulse" />
            ) : (
              <div className="text-xl font-semibold text-white">
                $<CountUp end={wastedEnergy.todayValue} decimals={0} duration={1} preserveValue />
              </div>
            )}
          </div>

          {/* Peak Today */}
          <div className="bg-gray-900/60 border border-gray-700/40 rounded-xl p-4">
            <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Peak</div>
            {isLoading ? (
              <div className="h-7 w-16 bg-gray-700/50 rounded animate-pulse" />
            ) : (
              <div className="text-xl font-semibold text-yellow-400">
                {Math.round(peakGhi).toLocaleString()}
                <span className="text-sm font-normal text-gray-500"> W</span>
              </div>
            )}
          </div>
        </section>

        {/* Monthly Estimate Banner */}
        {wastedEnergy && !isLoading && (
          <section className="bg-gradient-to-r from-green-900/20 to-emerald-900/20 border border-green-700/30 rounded-xl p-4 mb-6 flex items-center justify-between">
            <div>
              <div className="text-sm text-gray-400">Monthly potential</div>
              <div className="text-2xl font-bold text-white">
                $<CountUp end={wastedEnergy.monthlyEstimate} separator="," duration={1.5} preserveValue />
              </div>
            </div>
            {!isPremium && (
              <button
                onClick={upgradeToPremium}
                className="px-4 py-2 bg-green-600 hover:bg-green-500 rounded-lg text-sm font-medium text-white transition-all flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Unlock Live Data
              </button>
            )}
          </section>
        )}

        {/* Solar Forecast Curve */}
        {solarData?.hourly && solarData.hourly.length > 0 && (
          <section className="bg-gray-900/60 border border-gray-700/40 rounded-xl p-5 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-medium text-gray-300">Solar Forecast</h2>
              <span className="text-xs text-gray-500">Irradiance curve</span>
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
        )}

        {/* Roof Analysis - Google Solar API */}
        {(isRoofLoading || hasRoofData) && (
          <section className="bg-gray-900/60 border border-gray-700/40 rounded-xl p-5 mb-6">
            {isRoofLoading ? (
              <RoofAnalysisSkeleton />
            ) : roofSummary ? (
              <RoofAnalysis roofSummary={roofSummary} />
            ) : null}
          </section>
        )}

        {/* Info Footer */}
        <p className="mt-6 text-xs text-gray-600 text-center leading-relaxed">
          {hasRoofData && roofSummary
            ? `Based on actual roof analysis: ${Math.round(roofSummary.usableAreaM2)}m² usable area, ${roofSummary.maxPanels} panels.`
            : 'Estimates based on 150m² roof, 20% panel efficiency, and $0.32/kWh rate.'
          }
          {' '}Actual values depend on your specific setup and location.
        </p>
      </div>
    </Layout>
  )
}
