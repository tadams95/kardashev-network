// Data freshness indicator card
// Shows last updated times and refresh button

import { useState, useEffect } from 'react'
import { ArrowPathIcon } from '@heroicons/react/24/outline'
import Card from '@/components/Card'

// ============================================================================
// Types
// ============================================================================

interface DataFreshnessIndicatorProps {
  freshness?: Record<string, number> // ms since last fetch
  onRefresh: () => void
}

// ============================================================================
// Helper Functions
// ============================================================================

function formatTimeAgo(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 5) return 'Just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m ago`
}

// ============================================================================
// Component
// ============================================================================

export function DataFreshnessIndicator({ freshness, onRefresh }: DataFreshnessIndicatorProps) {
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [nextRefresh, setNextRefresh] = useState(15 * 60 * 1000) // 15 minutes

  useEffect(() => {
    // Update countdown every second
    const interval = setInterval(() => {
      setNextRefresh(prev => Math.max(0, prev - 1000))
    }, 1000)

    return () => clearInterval(interval)
  }, [])

  const handleRefresh = async () => {
    setIsRefreshing(true)
    onRefresh()
    // Reset refresh animation after 1 second
    setTimeout(() => {
      setIsRefreshing(false)
      setNextRefresh(15 * 60 * 1000) // Reset countdown
    }, 1000)
  }

  if (!freshness) {
    return (
      <Card noPadding className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Data Freshness</h3>
          <button
            className="p-2 rounded-lg hover:bg-gray-700/50 transition-colors"
            aria-label="Refresh data"
          >
            <ArrowPathIcon className="w-5 h-5 text-amber-400" />
          </button>
        </div>
        <div className="animate-pulse">
          <div className="h-4 bg-gray-700/30 rounded mb-2"></div>
          <div className="h-4 bg-gray-700/30 rounded mb-2"></div>
          <div className="h-4 bg-gray-700/30 rounded"></div>
        </div>
      </Card>
    )
  }

  return (
    <Card noPadding className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white">Data Freshness</h3>
        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="p-2 rounded-lg hover:bg-gray-700/50 transition-colors disabled:opacity-50"
          aria-label="Refresh data"
        >
          <ArrowPathIcon
            className={`w-5 h-5 text-amber-400 ${isRefreshing ? 'animate-spin' : ''}`}
          />
        </button>
      </div>

      <div className="space-y-2">
        {Object.entries(freshness).map(([source, ms]) => (
          <div key={source} className="flex items-center justify-between text-sm">
            <span className="text-gray-400">{source}</span>
            <span className={`text-gray-300 ${
              ms > 6 * 3600000 ? 'text-yellow-400' : ''
            }`}>
              {ms === 0 ? 'N/A' : formatTimeAgo(ms)}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-4 pt-4 border-t border-gray-700/30 text-xs text-gray-400">
        Auto-refresh in {Math.floor(nextRefresh / 60000)}:{((nextRefresh % 60000) / 1000).toFixed(0).padStart(2, '0')}
      </div>
    </Card>
  )
}
