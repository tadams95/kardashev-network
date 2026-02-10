// Weather Forecast Dashboard
// Real-time weather forecasting with trading opportunities

import { useState } from 'react'
import Layout from '@/components/Layout'
import { CitySelector } from '@/components/weather/CitySelector'
import { WeatherHeroCard } from '@/components/weather/WeatherHeroCard'
import { ConsensusMetrics } from '@/components/weather/ConsensusMetrics'
import { DataFreshnessIndicator } from '@/components/weather/DataFreshnessIndicator'
import { ForecastCards } from '@/components/weather/ForecastCards'
import { MarketOpportunitiesTable } from '@/components/weather/MarketOpportunitiesTable'
import { useWeatherForecasts } from '@/hooks/useWeatherForecasts'
import { useWeatherOpportunities } from '@/hooks/useWeatherOpportunities'

// ============================================================================
// Loading Skeleton
// ============================================================================

function LoadingSkeleton() {
  return (
    <div className="animate-pulse">
      {/* Hero Cards Skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <div className="bg-gray-700/20 rounded-xl h-48"></div>
        <div className="bg-gray-700/20 rounded-xl h-48"></div>
        <div className="bg-gray-700/20 rounded-xl h-48"></div>
      </div>

      {/* Forecast Cards Skeleton */}
      <div className="bg-gray-700/20 rounded-xl h-64 mb-6"></div>

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
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header + City Selector */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold mb-2 text-white">
              Weather Forecast Dashboard
            </h1>
            <p className="text-gray-400">
              Live forecasts with 3-source consensus and trading opportunities
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
            {/* Row 1: Hero Cards */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
              <WeatherHeroCard
                forecast={forecasts.ensemble?.consensus}
                city={forecasts.city}
              />
              <ConsensusMetrics
                consensus={forecasts.ensemble?.consensus}
                sources={forecasts.sourceStatus}
              />
              <DataFreshnessIndicator
                freshness={forecasts.freshness}
                onRefresh={opportunities.refresh}
              />
            </div>

            {/* Row 2: 7-Day Forecast */}
            <div className="mb-6">
              <ForecastCards
                forecasts={forecasts.ensemble?.forecasts || []}
              />
            </div>

            {/* Row 3: Market Opportunities */}
            <div>
              <MarketOpportunitiesTable
                opportunities={opportunities.opportunities}
                eventGroups={opportunities.eventGroups}
              />
            </div>

            {/* Info Footer */}
            <div className="mt-8 p-4 bg-gray-900/30 border border-gray-700/30 rounded-lg text-sm text-gray-400">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                  <div className="font-semibold text-white mb-1">About This Dashboard</div>
                  <div className="text-xs">
                    Forecasts aggregate 3 sources: Open-Meteo (40%), Google Weather (40%), METAR (20%).
                    Auto-refreshes every 15 minutes for forecasts, 5 minutes for markets.
                  </div>
                </div>
                <div className="text-xs text-right">
                  <div className="font-semibold text-white mb-1">Historical Performance</div>
                  <div className="text-green-400">85.9% accuracy (976 markets)</div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </Layout>
  )
}
