// Weather Forecast Dashboard
// Real-time weather forecasting with trading opportunities

import { useState } from 'react'
import Layout from '@/components/Layout'
import { CitySelector } from '@/components/weather/CitySelector'
import { WeatherHeroCard } from '@/components/weather/WeatherHeroCard'
import { ForecastCards } from '@/components/weather/ForecastCards'
import { HourlyForecast } from '@/components/weather/HourlyForecast'
import { MarketOpportunitiesTable } from '@/components/weather/MarketOpportunitiesTable'
import { useWeatherForecasts } from '@/hooks/useWeatherForecasts'
import { useWeatherOpportunities } from '@/hooks/useWeatherOpportunities'

// ============================================================================
// Loading Skeleton
// ============================================================================

function LoadingSkeleton() {
  return (
    <div className="animate-pulse">
      {/* 3-Column Hero Grid Skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">
        <div className="bg-gray-700/20 rounded-xl h-56"></div>
        <div className="bg-gray-700/20 rounded-xl h-56"></div>
        <div className="bg-gray-700/20 rounded-xl h-56"></div>
      </div>

      {/* Opportunities Table Skeleton */}
      <div className="bg-gray-700/20 rounded-xl h-96"></div>
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
  const [selectedCity, setSelectedCity] = useState('NY')

  // Fetch data
  const forecasts = useWeatherForecasts(selectedCity)
  const opportunities = useWeatherOpportunities(selectedCity)

  return (
    <Layout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Header + City Selector */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">
          <div>
            <h1 className="text-3xl font-bold mb-2 text-white">
              Weather Forecast Dashboard
            </h1>
            <p className="text-gray-400">
              Live forecasts with 4-source consensus and trading opportunities
            </p>
          </div>
          <CitySelector
            value={selectedCity}
            onChange={setSelectedCity}
          />
        </div>

        {/* Loading State */}
        {opportunities.isLoading && <LoadingSkeleton />}

        {/* Error State */}
        {opportunities.isError && !opportunities.isLoading && (
          <ErrorState error={opportunities.error} />
        )}

        {/* Dashboard Content */}
        {!opportunities.isLoading && !opportunities.isError && (
          <>
            {/* 3-Column Hero Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">
              {/* Column 1: Weather + Status */}
              <WeatherHeroCard
                forecast={forecasts.ensemble?.consensus}
                city={forecasts.city}
                sources={forecasts.sourceStatus}
                freshness={forecasts.freshness}
                onRefresh={opportunities.refresh}
              />

              {/* Column 2: 24-Hour Forecast */}
              <HourlyForecast forecasts={forecasts.ensemble?.forecasts || []} />

              {/* Column 3: 7-Day Forecast */}
              <ForecastCards forecasts={forecasts.ensemble?.forecasts || []} />
            </div>

            {/* Market Opportunities */}
            <div>
              <MarketOpportunitiesTable
                opportunities={opportunities.opportunities}
                eventGroups={opportunities.eventGroups}
              />
            </div>

            {/* Info Footer */}
            <div className="mt-5 px-4 py-2.5 bg-gray-900/30 border border-gray-700/30 rounded-lg text-xs text-gray-400 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-semibold text-white">About</span>
              <span className="text-gray-600">|</span>
              <span>4-source ensemble: Open-Meteo · Google Weather · NWS · METAR — dynamic inverse-Brier weighting</span>
              <span className="text-gray-600">|</span>
              <span>Isotonic calibration · 15m auto-refresh</span>
              <span className="text-gray-600">|</span>
              <span className="text-green-400 font-semibold">86.8% accuracy (976 markets)</span>
            </div>
          </>
        )}
      </div>
    </Layout>
  )
}
