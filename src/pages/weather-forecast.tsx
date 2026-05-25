// Weather Forecast Dashboard
// Real-time 5-source ensemble forecast with adaptive inverse-MAE weighting.
// Trading recommendations were removed 2026-05-02 — the probability-model
// pipeline that produced them was unprofitable. The forecast itself is fine;
// only the bet-recommendation overlay was retired.

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/router'
import { preload } from 'swr'
import Layout from '@/components/Layout'
import { CITY_COORDS } from '@/lib/utils/cityCoordinates'
import { InlineCitySelector } from '@/components/weather/CitySelector'
import { WeatherHeroCard } from '@/components/weather/WeatherHeroCard'
import { ForecastCards } from '@/components/weather/ForecastCards'
import { HourlyForecast } from '@/components/weather/HourlyForecast'
import { SourceDetailBreakdown } from '@/components/weather/SourceDetailBreakdown'
import TemperatureGraph, { TemperatureGraphSkeleton } from '@/components/weather/TemperatureGraph'
import { useWeatherForecasts, getForecastsKey, forecastsFetcher } from '@/hooks/useWeatherForecasts'
import { useSourceWeights, getWeightsKey, weightsFetcher } from '@/hooks/useSourceWeights'
import { getMarketsKey, marketsFetcher } from '@/hooks/useKalshiMarkets'

// ============================================================================
// Loading Skeleton
// ============================================================================

function LoadingSkeleton() {
  // Local skeleton helper preserves the page-specific `animate-shimmer`
  // sliding gradient (vs SkelBar's `animate-pulse` opacity fade). Fill
  // swapped to `bg-white/[0.06]` 2026-05-25 to scale with the surface
  // system — matches SkelBar's color over the new `surface-card`.
  const b = (cls: string) => (
    <div className={`bg-white/[0.06] rounded ${cls} animate-shimmer`} />
  )

  return (
    <div>
      {/* 3-Column Hero Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 mb-5">
        {/* Col 1: WeatherHeroCard skeleton */}
        <div className="md:col-span-2 lg:col-span-1 bg-surface-card border border-white/[0.06] rounded-xl p-5 space-y-3">
          {b("h-3 w-24")}
          {b("h-10 w-32")}
          {b("h-3 w-20")}
          {b("h-3 w-28")}
          <div className="border-t border-white/[0.06] my-2" />
          <div className="flex gap-1.5">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="w-2 h-2 rounded-full bg-white/[0.06] animate-shimmer" />
            ))}
            {b("h-3 w-24 ml-1")}
          </div>
          {b("h-3 w-20")}
          {b("h-3 w-16")}
          {b("h-3 w-28")}
        </div>

        {/* Col 2: HourlyForecast skeleton */}
        <div className="bg-surface-card border border-white/[0.06] rounded-xl p-4 space-y-3">
          {b("h-4 w-32")}
          <div className="flex gap-2.5 overflow-hidden">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="min-w-[80px] space-y-2 flex-shrink-0">
                {b("h-3 w-10 mx-auto")}
                {b("h-8 w-8 mx-auto rounded-lg")}
                {b("h-3 w-10 mx-auto")}
                {b("h-2 w-8 mx-auto")}
              </div>
            ))}
          </div>
        </div>

        {/* Col 3: ForecastCards skeleton */}
        <div className="bg-surface-card border border-white/[0.06] rounded-xl p-4 space-y-3">
          {b("h-4 w-28")}
          <div className="flex gap-2.5 overflow-hidden">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="min-w-[80px] space-y-2 flex-shrink-0">
                {b("h-3 w-12 mx-auto")}
                {b("h-8 w-8 mx-auto rounded-lg")}
                {b("h-3 w-14 mx-auto")}
                {b("h-2 w-8 mx-auto")}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Source detail breakdown placeholder */}
      <div className="mb-5">
        <div className="bg-surface-card border border-white/[0.06] rounded-xl p-4">
          {b("h-4 w-44")}
        </div>
      </div>

      {/* Temperature Graph skeleton */}
      <div className="mb-5">
        <TemperatureGraphSkeleton />
      </div>
    </div>
  )
}

// ============================================================================
// Error State
// ============================================================================

function ErrorState({ error }: { error?: Error }) {
  return (
    <div className="bg-red-900/20 border border-red-500/50 rounded-xl p-8 text-center">
      <div className="text-subhead text-red-400 font-semibold mb-2">
        Failed to Load Dashboard
      </div>
      <p className="text-body text-gray-300 mb-4">
        {error?.message || 'An error occurred while loading the weather forecast dashboard.'}
      </p>
      <button
        onClick={() => window.location.reload()}
        className="px-4 py-2 bg-red-500/20 border border-red-500/50 rounded-lg text-body text-red-400 hover:bg-red-500/30 transition-colors"
      >
        Reload Page
      </button>
    </div>
  )
}

// ============================================================================
// Main Component
// ============================================================================

export default function WeatherForecastDashboard() {
  const router = useRouter()
  const [selectedCity, setSelectedCity] = useState('NY')

  // Hydrate from URL query param on mount
  useEffect(() => {
    if (router.isReady && router.query.city) {
      const city = (router.query.city as string).toUpperCase()
      if (CITY_COORDS[city]) {
        setSelectedCity(city)
      }
    }
  }, [router.isReady, router.query.city])

  // Sync selected city back to URL
  useEffect(() => {
    if (router.isReady) {
      router.replace({ pathname: '/weather-forecast', query: { city: selectedCity } }, undefined, { shallow: true })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCity])

  // Fetch data
  const forecasts = useWeatherForecasts(selectedCity)
  const { data: sourceWeightsData } = useSourceWeights(selectedCity)

  // City timezone — required by display components (always present when city data loads)
  const cityTimezone = forecasts.city?.timezone ?? 'America/New_York'

  // Derived transition state — drive entirely off forecasts now that the
  // opportunities consumer is gone.
  const hasForecastData = !!forecasts.ensemble
  const isCrossCityData = hasForecastData && forecasts.city?.code !== selectedCity
  const isForecastTransitioning =
    forecasts.isValidating && !forecasts.isLoading && forecasts.city?.code !== selectedCity
  const showTransitionSkeleton =
    (forecasts.isLoading && !hasForecastData) ||  // first load
    (isForecastTransitioning && isCrossCityData)  // city switch with stale data

  // Prefetch city data into SWR cache on hover for instant transitions
  const handlePrefetch = useCallback((cityCode: string) => {
    if (cityCode !== selectedCity) {
      preload(getForecastsKey(cityCode), forecastsFetcher)
      preload(getMarketsKey(cityCode), marketsFetcher)
      preload(getWeightsKey(cityCode), weightsFetcher)
    }
  }, [selectedCity])

  return (
    <Layout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Header + Inline City Selector */}
        <div className="mb-4">
          <h1 className="text-headline font-semibold mb-2 text-white">
            Weather Forecast for{' '}
            <InlineCitySelector
              value={selectedCity}
              onChange={setSelectedCity}
              onPrefetch={handlePrefetch}
            />
          </h1>
          <p className="text-body text-gray-400">
            5-source ensemble forecast with adaptive weighting
          </p>
        </div>

        {/* Loading / Transition Skeleton */}
        {showTransitionSkeleton && <LoadingSkeleton />}

        {/* Error State */}
        {forecasts.isError && !forecasts.isLoading && (
          <ErrorState error={forecasts.error} />
        )}

        {/* Dashboard Content — render when data exists and belongs to current city */}
        {hasForecastData && !forecasts.isError && !showTransitionSkeleton && (
          <div>
            {/* 3-Column Hero Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 mb-5">
              {/* Column 1: Weather + Status */}
              <div className="md:col-span-2 lg:col-span-1">
                <WeatherHeroCard
                  forecast={forecasts.ensemble?.consensus}
                  forecasts={forecasts.ensemble?.forecasts}
                  timezone={forecasts.city?.timezone}
                  city={forecasts.city}
                  sources={forecasts.sourceStatus}
                  freshness={forecasts.freshness}
                  sourceWeights={sourceWeightsData ?? null}
                  activeWeights={forecasts.ensemble?.activeWeights}
                  onRefresh={forecasts.refresh}
                />
              </div>

              {/* Column 2: 24-Hour Forecast */}
              <HourlyForecast forecasts={forecasts.ensemble?.forecasts || []} timezone={cityTimezone} activeWeights={forecasts.ensemble?.activeWeights} />

              {/* Column 3: 7-Day Forecast */}
              <ForecastCards forecasts={forecasts.ensemble?.forecasts || []} timezone={cityTimezone} activeWeights={forecasts.ensemble?.activeWeights} />
            </div>

            {/* Per-source atmospheric variable detail (collapsed by default) */}
            <div className="mb-5">
              <SourceDetailBreakdown forecasts={forecasts.ensemble?.forecasts || []} />
            </div>

            {/* Temperature Graph — forecast viz */}
            <div className="mb-5">
              <TemperatureGraph
                forecasts={forecasts.ensemble?.forecasts || []}
                timezone={cityTimezone}
                activeWeights={forecasts.ensemble?.activeWeights}
              />
            </div>

            {/* Info Footer — mobile stacked. Migrated to surface-nested +
                white border + text-caption 2026-05-25; was `bg-gray-900/30
                border-gray-700/30 rounded-lg text-xs`. */}
            <div className="mt-5 px-4 py-2.5 bg-surface-nested border border-white/[0.06] rounded-xl text-caption text-gray-400 sm:hidden space-y-1">
              <span className="font-semibold text-white block">About</span>
              <span className="block">5-source ensemble: Open-Meteo · Google Weather · NWS · AccuWeather · Tomorrow.io — {sourceWeightsData?.isDynamic ? 'adaptive inverse-MAE weighting' : 'static weighting (collecting data)'}</span>
              <span className="block">15m auto-refresh</span>
            </div>
            {/* Info Footer — desktop horizontal */}
            <div className="mt-5 px-4 py-2.5 bg-surface-nested border border-white/[0.06] rounded-xl text-caption text-gray-400 hidden sm:flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-semibold text-white">About</span>
              <span className="text-gray-600">|</span>
              <span>5-source ensemble: Open-Meteo · Google Weather · NWS · AccuWeather · Tomorrow.io — {sourceWeightsData?.isDynamic ? 'adaptive inverse-MAE weighting' : 'static weighting (collecting data)'}</span>
              <span className="text-gray-600">|</span>
              <span>15m auto-refresh</span>
            </div>
          </div>
        )}
      </div>
    </Layout>
  )
}
