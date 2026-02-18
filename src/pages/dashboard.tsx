// Dashboard page - premium solar data visualization

import { useState } from 'react'
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
import WeekForecast from '@/components/WeekForecast'
import CountUp from 'react-countup'
import { LockClosedIcon, LockOpenIcon } from '@heroicons/react/20/solid'

function formatTime(timeStr?: string): string {
  if (!timeStr) return ''
  return new Date(timeStr).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export default function Dashboard() {
  const { location } = useLocationContext()

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
    getExplorerTxUrl,
    isConnected,
  } = usePremiumSolarData(location?.lat, location?.lng, roofSummary?.usableAreaM2, roofSummary?.electricityRate)

  const [showPremiumTooltip, setShowPremiumTooltip] = useState(false)

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
            <div className="w-16 h-16 bg-amber-600/20 rounded-2xl flex items-center justify-center mx-auto mb-6 border border-amber-600/20">
              <svg className="w-8 h-8 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
            isWrongChain={isWrongChain}
            onSwitchChain={switchToCorrectChain}
            isSwitchingChain={isSwitchingChain}
            requiredChainName={requiredChainName}
            activeChainType={activeChainType}
          />
        </div>
      )}

      <div className="max-w-6xl mx-auto px-4 py-4 sm:py-6">
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

        {/* Transaction hash link */}
        {isPremium && paymentState.txHash && (
          <div className="mb-4 flex items-center justify-center gap-2 text-xs text-gray-500">
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
            {/* Location Card */}
            <section className="bg-black/40 border border-gray-700/50 rounded-xl p-4 sm:p-5">
              <div>
                {/* Header row with location and actions */}
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-amber-900/30 border border-amber-700/30 flex items-center justify-center">
                      <svg className="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h1 className="text-lg font-semibold text-white truncate">
                          {location.address || location.city || 'Current Location'}
                        </h1>
                        <TierBadge isPremium={isPremium} isCached={isCached} />
                      </div>
                      <div className="flex items-center gap-3 text-xs mt-0.5">
                        <span className="text-gray-500 font-mono">
                          {location.lat.toFixed(4)}°N, {Math.abs(location.lng).toFixed(4)}°{location.lng >= 0 ? 'E' : 'W'}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <span className={`w-1.5 h-1.5 rounded-full ${isNighttime ? 'bg-indigo-400' : 'bg-emerald-400'} animate-pulse`} />
                          <span className="text-gray-400">
                            {isNighttime ? `Night · Sunrise ${formatTime(solarData?.daily?.sunrise)}` : 'Day'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Refresh button */}
                  <button
                    onClick={refresh}
                    disabled={isLoading}
                    className="p-2 rounded-lg bg-black/60 hover:bg-white/10 border border-gray-700/50 text-gray-400 hover:text-white transition-all disabled:opacity-50 flex-shrink-0"
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
              </div>
            </section>

            {/* Hero Metric - Uncaptured Value */}
            <section className="bg-black/40 border border-gray-700/50 rounded-xl p-4 sm:p-6">
              {isLoading || !wastedEnergy ? (
                <div className="animate-pulse text-center">
                  <div className="h-20 w-48 bg-gray-700/50 rounded-lg mx-auto mb-3" />
                  <div className="h-5 w-32 bg-gray-700/50 rounded mx-auto" />
                </div>
              ) : (
                <div className="text-center">
                  <div className="text-xs text-gray-500 uppercase tracking-wide mb-2">Uncaptured Value</div>
                  <div className="flex items-baseline justify-center gap-1">
                    <span className="text-xl sm:text-2xl text-gray-400 font-light">$</span>
                    <span className="text-5xl sm:text-6xl lg:text-7xl font-bold text-white tracking-tight">
                      <CountUp end={wastedEnergy.currentValue} decimals={2} duration={1} preserveValue />
                    </span>
                    <span className="text-xl sm:text-2xl text-gray-400 font-light">/hr</span>
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
                        className="h-full bg-amber-500 rounded-full transition-all duration-500"
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

            {/* Weather Context - Premium */}
            {isPremium && solarData?.current.weatherDescription !== undefined && (
              <section className="bg-black/40 border border-amber-800/20 rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <span className="text-sm text-gray-300">{solarData.current.weatherDescription}</span>
                    {solarData.current.temperature !== undefined && (
                      <span className="text-sm text-white font-medium">{solarData.current.temperature.toFixed(1)}°C</span>
                    )}
                    {solarData.current.windSpeed !== undefined && (
                      <span className="text-sm text-gray-400">{solarData.current.windSpeed.toFixed(1)} m/s wind</span>
                    )}
                  </div>
                  {isPremium && solarData.current.thermalEfficiency !== undefined && solarData.current.thermalEfficiency < 100 && (
                    <span className="text-xs text-amber-400 bg-amber-900/30 border border-amber-700/30 rounded-full px-2.5 py-0.5">
                      Panel eff. {Math.round(solarData.current.thermalEfficiency)}%{' '}
                      ({((solarData.current.thermalEfficiency - 100)).toFixed(1)}% heat)
                    </span>
                  )}
                </div>
              </section>
            )}

            {/* Weather Context - Locked placeholder */}
            {!isPremium && solarData && (
              <section className="bg-black/40 border border-gray-700/50 rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">Weather Context</span>
                  <span className="text-[10px] text-amber-500 uppercase tracking-wide font-medium flex items-center gap-1">
                    <LockClosedIcon className="w-3 h-3" />
                    Premium
                  </span>
                </div>
              </section>
            )}

            {/* Stats Row */}
            <section className={`grid gap-2 sm:gap-3 ${solarData ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'}`}>
              {/* Irradiance */}
              <div className="bg-black/40 border border-gray-700/50 rounded-xl p-3 sm:p-4">
                <div className="text-[10px] sm:text-xs text-gray-500 uppercase tracking-wide mb-1">Irradiance</div>
                {isLoading ? (
                  <div className="h-6 sm:h-7 w-14 sm:w-16 bg-gray-700/50 rounded animate-pulse" />
                ) : (
                  <div className="text-base sm:text-xl font-semibold text-amber-500">
                    {Math.round(currentGhi).toLocaleString()}
                    <span className="text-xs sm:text-sm font-normal text-gray-500"> W/m²</span>
                  </div>
                )}
              </div>

              {/* Today's Potential */}
              <div className="bg-black/40 border border-gray-700/50 rounded-xl p-3 sm:p-4">
                <div className="text-[10px] sm:text-xs text-gray-500 uppercase tracking-wide mb-1">Today</div>
                {isLoading || !wastedEnergy ? (
                  <div className="h-6 sm:h-7 w-14 sm:w-16 bg-gray-700/50 rounded animate-pulse" />
                ) : (
                  <div className="text-base sm:text-xl font-semibold text-white">
                    $<CountUp end={wastedEnergy.todayValue} decimals={0} duration={1} preserveValue />
                  </div>
                )}
              </div>

              {/* Peak Today */}
              <div className="bg-black/40 border border-gray-700/50 rounded-xl p-3 sm:p-4">
                <div className="text-[10px] sm:text-xs text-gray-500 uppercase tracking-wide mb-1">Peak</div>
                {isLoading ? (
                  <div className="h-6 sm:h-7 w-14 sm:w-16 bg-gray-700/50 rounded animate-pulse" />
                ) : (
                  <div className="text-base sm:text-xl font-semibold text-yellow-400">
                    {Math.round(peakGhi).toLocaleString()}
                    <span className="text-xs sm:text-sm font-normal text-gray-500"> W/m²</span>
                  </div>
                )}
              </div>

              {/* Direct/Diffuse - Premium */}
              {isPremium && solarData?.current.diffuseRadiation !== undefined && (
                <div className="bg-black/40 border border-amber-800/20 rounded-xl p-3 sm:p-4">
                  <div className="text-[10px] sm:text-xs text-gray-500 uppercase tracking-wide mb-1">Direct/Diffuse</div>
                  {isLoading ? (
                    <div className="h-6 sm:h-7 w-14 sm:w-16 bg-gray-700/50 rounded animate-pulse" />
                  ) : (
                    <div>
                      <div className="text-base sm:text-xl font-semibold text-white">
                        {Math.round(((currentGhi - (solarData.current.diffuseRadiation ?? 0)) / Math.max(currentGhi, 1)) * 100)}%
                        <span className="text-xs sm:text-sm font-normal text-gray-500"> direct</span>
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        {Math.round(solarData.current.diffuseRadiation)} W/m² diffuse
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Direct/Diffuse - Locked placeholder */}
              {!isPremium && solarData && (
                <div className="bg-black/40 border border-gray-700/50 rounded-xl p-3 sm:p-4">
                  <div className="text-[10px] sm:text-xs text-gray-500 uppercase tracking-wide mb-1 flex items-center gap-1">
                    Direct/Diffuse
                    <LockClosedIcon className="w-3 h-3 text-amber-500" />
                  </div>
                  <div className="text-base sm:text-xl font-semibold text-gray-600">--</div>
                </div>
              )}
            </section>

            {/* Solar Curve - mobile only */}
            <div className="lg:hidden">
              {solarData?.hourly && solarData.hourly.length > 0 && (
                <section className="bg-black/40 border border-gray-700/50 rounded-xl p-4">
                  <h2 className="text-sm font-medium text-gray-300 mb-3">Solar Forecast</h2>
                  <SolarCurve
                    hourly={solarData.hourly}
                    sunrise={solarData.daily?.sunrise ?? ''}
                    sunset={solarData.daily?.sunset ?? ''}
                  />
                </section>
              )}
            </div>

            {/* 7-Day Forecast - mobile only */}
            {isPremium && solarData?.forecast && solarData.forecast.length > 0 && (
              <div className="lg:hidden">
                <section className="bg-black/40 border border-amber-800/20 rounded-xl p-4 sm:p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-sm font-medium text-gray-300">7-Day Solar Forecast</h2>
                    <span className="text-[10px] text-amber-500 uppercase tracking-wide font-medium flex items-center gap-1">
                      <LockOpenIcon className="w-3 h-3" />
                      Premium
                    </span>
                  </div>
                  <WeekForecast forecast={solarData.forecast} usableAreaM2={roofSummary?.recommendedAreaM2} />
                </section>
              </div>
            )}

            {/* 7-Day Forecast - mobile locked placeholder */}
            {!isPremium && solarData && (
              <div className="lg:hidden">
                <section className="bg-black/40 border border-gray-700/50 rounded-xl p-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-medium text-gray-500">7-Day Solar Forecast</h2>
                    <span className="text-[10px] text-amber-500 uppercase tracking-wide font-medium flex items-center gap-1">
                      <LockClosedIcon className="w-3 h-3" />
                      Premium
                    </span>
                  </div>
                </section>
              </div>
            )}

            {/* Monthly Estimate Banner */}
            {wastedEnergy && !isLoading && (
              <section className="bg-amber-900/20 border border-amber-800/30 rounded-xl p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <div className="text-xs sm:text-sm text-gray-400">Monthly potential</div>
                  <div className="text-xl sm:text-2xl font-bold text-white">
                    $<CountUp end={wastedEnergy.monthlyEstimate} separator="," duration={1.5} preserveValue />
                  </div>
                </div>
                {!isPremium && (
                  <div className="relative flex items-center gap-2 w-full sm:w-auto">
                    <button
                      onClick={upgradeToPremium}
                      className="px-3 sm:px-4 py-2 bg-amber-600 hover:bg-amber-700 rounded-lg text-xs sm:text-sm font-medium text-white transition-all flex items-center justify-center gap-2 flex-1 sm:flex-initial"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      Unlock Premium · $0.001
                    </button>
                    <button
                      onClick={() => setShowPremiumTooltip(!showPremiumTooltip)}
                      className="w-6 h-6 rounded-full border border-gray-600 text-gray-400 hover:text-white hover:border-gray-400 transition-colors flex items-center justify-center text-xs font-medium flex-shrink-0"
                      aria-label="What is premium?"
                    >
                      ?
                    </button>
                    {showPremiumTooltip && (
                      <div className="absolute bottom-full right-0 mb-2 w-72 p-3 bg-gray-900 border border-gray-700 rounded-xl shadow-xl text-xs text-gray-300 leading-relaxed z-10">
                        Pay a fraction of a cent to unlock live solar data, forecasts, and roof analysis. Powered by x402 micropayments &mdash; no account needed, just a crypto wallet with USDC.
                        <div className="absolute bottom-0 right-4 translate-y-1/2 rotate-45 w-2 h-2 bg-gray-900 border-r border-b border-gray-700" />
                      </div>
                    )}
                  </div>
                )}
              </section>
            )}
          </div>

          {/* Right Column - Charts & Analysis */}
          <div className="space-y-6">
            {/* Solar Forecast Curve - desktop only */}
            {solarData?.hourly && solarData.hourly.length > 0 && (
              <section className="hidden lg:block bg-black/40 border border-gray-700/50 rounded-xl p-4 sm:p-5">
                <div className="mb-3 sm:mb-4">
                  <h2 className="text-sm font-medium text-gray-300">Solar Forecast</h2>
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

            {/* 7-Day Forecast - desktop only */}
            {isPremium && solarData?.forecast && solarData.forecast.length > 0 && (
              <section className="hidden lg:block bg-black/40 border border-amber-800/20 rounded-xl p-4 sm:p-5">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-medium text-gray-300">7-Day Solar Forecast</h2>
                  <span className="text-[10px] text-amber-500 uppercase tracking-wide font-medium flex items-center gap-1">
                    <LockOpenIcon className="w-3 h-3" />
                    Premium
                  </span>
                </div>
                <WeekForecast forecast={solarData.forecast} usableAreaM2={roofSummary?.recommendedAreaM2} />
              </section>
            )}

            {/* 7-Day Forecast - desktop locked placeholder */}
            {!isPremium && solarData && (
              <section className="hidden lg:block bg-black/40 border border-gray-700/50 rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-medium text-gray-500">7-Day Solar Forecast</h2>
                  <span className="text-[10px] text-amber-500 uppercase tracking-wide font-medium flex items-center gap-1">
                    <LockClosedIcon className="w-3 h-3" />
                    Premium
                  </span>
                </div>
              </section>
            )}

            {/* Solar Roof Map */}
            {hasRoofData && location && (
              <section className="bg-black/40 border border-gray-700/50 rounded-xl p-4 sm:p-5">
                <SunroofMap lat={location.lat} lng={location.lng} />
              </section>
            )}

            {/* Roof Analysis - Google Solar API */}
            {(isRoofLoading || hasRoofData) && (
              <section className="bg-black/40 border border-gray-700/50 rounded-xl p-4 sm:p-5">
                {isRoofLoading ? (
                  <RoofAnalysisSkeleton />
                ) : roofSummary ? (
                  <RoofAnalysis roofSummary={roofSummary} />
                ) : null}
              </section>
            )}
          </div>
        </div>

        {/* Info Footer */}
        <p className="mt-6 text-xs text-gray-600 text-center leading-relaxed">
          {hasRoofData && roofSummary
            ? `Based on ${Math.round(roofSummary.usableAreaM2)}m² usable roof area, ${roofSummary.panelCount} panels (of ${roofSummary.maxPanels} max), 20% panel efficiency, 14% system losses, and $${roofSummary.electricityRate.toFixed(2)}/kWh.`
            : 'Estimates based on 150m² roof (65% usable), 20% panel efficiency, 14% system losses, and $0.16/kWh.'
          }
          {' '}Actual values depend on your specific setup and location.
        </p>
      </div>
    </Layout>
  )
}
