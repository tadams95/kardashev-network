// Weather Forecast Dashboard
// Real-time weather forecasting with trading opportunities

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
import { MarketOpportunitiesTable } from '@/components/weather/MarketOpportunitiesTable'
import { TradingStrategiesTable } from '@/components/weather/TradingStrategiesTable'
import { SignalsDisclaimer } from '@/components/weather/SignalsDisclaimer'
import { SectionDivider } from '@/components/weather/SectionDivider'
import TemperatureGraph, { TemperatureGraphSkeleton } from '@/components/weather/TemperatureGraph'
import { useWeatherForecasts, getForecastsKey, forecastsFetcher } from '@/hooks/useWeatherForecasts'
import { useWeatherOpportunities, getOpportunitiesKey, opportunitiesFetcher } from '@/hooks/useWeatherOpportunities'
import { useSourceWeights, getWeightsKey, weightsFetcher } from '@/hooks/useSourceWeights'
import { getMarketsKey, marketsFetcher } from '@/hooks/useKalshiMarkets'

// ============================================================================
// Loading Skeleton
// ============================================================================

function LoadingSkeleton() {
  const b = (cls: string) => (
    <div className={`bg-gray-700/20 rounded ${cls} animate-shimmer`} />
  )

  return (
    <div>
      {/* 3-Column Hero Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 mb-5">
        {/* Col 1: WeatherHeroCard skeleton */}
        <div className="md:col-span-2 lg:col-span-1 bg-black/40 border border-gray-700/50 rounded-xl p-5 space-y-3">
          {b("h-3 w-24")}
          {b("h-10 w-32")}
          {b("h-3 w-20")}
          {b("h-3 w-28")}
          <div className="border-t border-gray-700/50 my-2" />
          <div className="flex gap-1.5">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="w-2 h-2 rounded-full bg-gray-700/30 animate-shimmer" />
            ))}
            {b("h-3 w-24 ml-1")}
          </div>
          {b("h-3 w-20")}
          {b("h-3 w-16")}
          {b("h-3 w-28")}
        </div>

        {/* Col 2: HourlyForecast skeleton */}
        <div className="bg-black/40 border border-gray-700/50 rounded-xl p-4 space-y-3">
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
        <div className="bg-black/40 border border-gray-700/50 rounded-xl p-4 space-y-3">
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

      {/* Temperature Graph skeleton */}
      <div className="mb-5">
        <TemperatureGraphSkeleton />
      </div>

      {/* Market Opportunities skeleton */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          {b("h-5 w-52")}
          <div className="flex gap-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-6 w-20 rounded-full bg-gray-700/20 animate-shimmer" />
            ))}
          </div>
        </div>
        {[...Array(2)].map((_, i) => (
          <div key={i} className="bg-black/40 border border-gray-700/50 rounded-xl overflow-hidden">
            <div className="p-3 border-b border-gray-700/30 flex justify-between">
              <div className="space-y-1.5">
                {b("h-4 w-40")}
                {b("h-3 w-48")}
              </div>
              {b("h-8 w-14")}
            </div>
            <div className="p-1">
              {[...Array(4)].map((_, j) => (
                <div key={j} className="flex items-center gap-4 px-3 py-2">
                  {b("h-3 w-24")}
                  {b("h-3 w-10 ml-auto")}
                  {b("h-3 w-12")}
                  {b("h-3 w-14")}
                  {b("h-5 w-20 rounded-md")}
                </div>
              ))}
            </div>
          </div>
        ))}
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
      <div className="text-red-400 text-xl font-semibold mb-2">
        Failed to Load Dashboard
      </div>
      <p className="text-gray-300 mb-4">
        {error?.message || 'An error occurred while loading the weather forecast dashboard.'}
      </p>
      <button
        onClick={() => window.location.reload()}
        className="px-4 py-2 bg-red-500/20 border border-red-500/50 rounded-lg text-red-400 hover:bg-red-500/30 transition-colors"
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
  const opportunities = useWeatherOpportunities(selectedCity)
  const { data: sourceWeightsData } = useSourceWeights(selectedCity)

  // City timezone — required by display components (always present when city data loads)
  const cityTimezone = forecasts.city?.timezone ?? 'America/New_York'

  // Derived transition state
  const hasForecastData = !!forecasts.ensemble
  const isCrossCityData = hasForecastData && forecasts.city?.code !== selectedCity
  const showTransitionSkeleton =
    (opportunities.isLoading && !hasForecastData) ||  // first load
    (opportunities.isTransitioning && isCrossCityData)  // city switch with stale data

  // Prefetch city data into SWR cache on hover for instant transitions
  const handlePrefetch = useCallback((cityCode: string) => {
    if (cityCode !== selectedCity) {
      preload(getForecastsKey(cityCode), forecastsFetcher)
      preload(getMarketsKey(cityCode), marketsFetcher)
      preload(getWeightsKey(cityCode), weightsFetcher)
      preload(getOpportunitiesKey(cityCode), opportunitiesFetcher)
    }
  }, [selectedCity])

  return (
    <Layout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Header + Inline City Selector */}
        <div className="mb-4">
          <h1 className="text-3xl font-bold mb-2 text-white">
            Weather Forecast for{' '}
            <InlineCitySelector
              value={selectedCity}
              onChange={setSelectedCity}
              onPrefetch={handlePrefetch}
            />
          </h1>
          <p className="text-gray-400">
            Live forecasts with 6-source consensus and trading opportunities
          </p>
        </div>

        {/* Loading / Transition Skeleton */}
        {showTransitionSkeleton && <LoadingSkeleton />}

        {/* Error State */}
        {opportunities.isError && !opportunities.isLoading && (
          <ErrorState error={opportunities.error} />
        )}

        {/* Dashboard Content — render when data exists and belongs to current city */}
        {hasForecastData && !opportunities.isError && !showTransitionSkeleton && (
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
                  biasInfo={opportunities.biasInfo}
                  sourceWeights={sourceWeightsData ?? null}
                  activeWeights={forecasts.ensemble?.activeWeights}
                  onRefresh={opportunities.refresh}
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

            <SectionDivider title="Trading Opportunities" />

            {/* Signal Disclaimer */}
            <div className="mb-5">
              <SignalsDisclaimer />
            </div>

            {/* Trading Strategies */}
            <div className="mb-5">
              <TradingStrategiesTable eventGroups={opportunities.eventGroups} />
            </div>

            {/* Temperature Graph */}
            <div className="mb-5">
              <TemperatureGraph
                forecasts={forecasts.ensemble?.forecasts || []}
                timezone={cityTimezone}
                activeWeights={forecasts.ensemble?.activeWeights}
                biasCorrection={opportunities.biasInfo?.isActive ? opportunities.biasInfo.correction : undefined}
              />
            </div>

            {/* Market Opportunities */}
            <div>
              <MarketOpportunitiesTable
                opportunities={opportunities.opportunities}
                eventGroups={opportunities.eventGroups}
                totalMarketsCount={opportunities.totalMarketsCount}
                allWithinBuffer={opportunities.allWithinBuffer}
                cityCode={selectedCity}
              />
            </div>

            {/* Info Footer — mobile stacked */}
            <div className="mt-5 px-4 py-2.5 bg-gray-900/30 border border-gray-700/30 rounded-lg text-xs text-gray-400 sm:hidden space-y-1">
              <span className="font-semibold text-white block">About</span>
              <span className="block">5-source ensemble: Open-Meteo · Google Weather · NWS · AccuWeather · Tomorrow.io — {sourceWeightsData?.isDynamic ? 'adaptive inverse-MAE weighting' : 'static weighting (collecting data)'}</span>
              <span className="block">BMA probability model · Isotonic calibration · 5m auto-refresh</span>
            </div>
            {/* Info Footer — desktop horizontal */}
            <div className="mt-5 px-4 py-2.5 bg-gray-900/30 border border-gray-700/30 rounded-lg text-xs text-gray-400 hidden sm:flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-semibold text-white">About</span>
              <span className="text-gray-600">|</span>
              <span>5-source ensemble: Open-Meteo · Google Weather · NWS · AccuWeather · Tomorrow.io — {sourceWeightsData?.isDynamic ? 'adaptive inverse-MAE weighting' : 'static weighting (collecting data)'}</span>
              <span className="text-gray-600">|</span>
              <span>BMA probability model · Isotonic calibration · 5m auto-refresh</span>
              <span className="text-gray-600">|</span>
            </div>
          </div>
        )}
      </div>
    </Layout>
  )
}
