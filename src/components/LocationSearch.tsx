import { useState, useCallback, useRef, useEffect } from 'react'
import { useRouter } from 'next/router'
import { useLocation } from '@/hooks/useLocation'

interface SearchResult {
  lat: number
  lng: number
  displayName: string
  city?: string
}

interface LocationSearchProps {
  navigateToDashboard?: boolean
  onLocationSelect?: () => void
  compact?: boolean
}

export default function LocationSearch({
  navigateToDashboard = false,
  onLocationSelect,
  compact = false,
}: LocationSearchProps = {}) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [showResults, setShowResults] = useState(false)
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const { location, isLoading, error, requestLocation, setManualLocation } = useLocation()

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowResults(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const searchAddress = useCallback(async (searchQuery: string) => {
    if (searchQuery.length < 2) {
      setResults([])
      return
    }

    setIsSearching(true)
    try {
      const response = await fetch(`/api/geocode/search?q=${encodeURIComponent(searchQuery)}`)
      const data = await response.json()

      if (data.success && Array.isArray(data.data)) {
        setResults(data.data)
        setShowResults(true)
      } else {
        setResults([])
      }
    } catch {
      setResults([])
    } finally {
      setIsSearching(false)
    }
  }, [])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setQuery(value)

    // Debounce search
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }

    searchTimeoutRef.current = setTimeout(() => {
      searchAddress(value)
    }, 300)
  }

  const handleSelectResult = (result: SearchResult) => {
    setManualLocation({
      lat: result.lat,
      lng: result.lng,
      city: result.city,
      address: result.displayName,
    })
    setQuery(result.city || result.displayName.split(',')[0])
    setShowResults(false)
    setResults([])
    onLocationSelect?.()
    if (navigateToDashboard) {
      router.push('/dashboard')
    }
  }

  const handleUseMyLocation = async () => {
    setShowResults(false)
    const loc = await requestLocation()
    if (loc?.city) {
      setQuery(loc.city)
    } else if (loc) {
      setQuery(`${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}`)
    }
    if (loc) {
      onLocationSelect?.()
      if (navigateToDashboard) {
        router.push('/dashboard')
      }
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setShowResults(false)
    }
  }

  return (
    <div ref={containerRef} className="w-full max-w-md mx-auto">
      <div className="relative">
        {/* Search input */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={query}
              onChange={handleInputChange}
              onFocus={() => results.length > 0 && setShowResults(true)}
              onKeyDown={handleKeyDown}
              placeholder="Enter city or address..."
              className="w-full px-4 py-3 bg-[#0a0a0a] border border-gray-700/50 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500 transition-all"
            />
            {isSearching && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <div className="w-5 h-5 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
              </div>
            )}
          </div>

          {/* Use my location button */}
          <button
            onClick={handleUseMyLocation}
            disabled={isLoading}
            className="px-4 py-3 bg-green-600 hover:bg-green-500 disabled:bg-gray-700 text-white rounded-xl transition-all shadow-lg shadow-green-500/20 hover:shadow-green-500/30 flex items-center gap-2"
            title="Use my location"
          >
            {isLoading ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
            )}
          </button>
        </div>

        {/* Search results dropdown */}
        {showResults && results.length > 0 && (
          <div className="absolute z-50 w-full mt-2 bg-[#0a0a0a] border border-gray-700/50 rounded-xl shadow-xl overflow-hidden">
            {results.map((result, index) => (
              <button
                key={`${result.lat}-${result.lng}-${index}`}
                onClick={() => handleSelectResult(result)}
                className="w-full px-4 py-3 text-left text-white hover:bg-[#141414] transition-colors border-b border-gray-700/50 last:border-b-0"
              >
                <div className="font-medium text-green-400">
                  {result.city || result.displayName.split(',')[0]}
                </div>
                <div className="text-sm text-gray-400 truncate">
                  {result.displayName}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Error message */}
      {error && (
        <div className="mt-3 p-3 bg-red-900/50 border border-red-700 rounded-lg text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Current location display */}
      {location && !error && (
        <div className="mt-3 p-3 bg-[#0a0a0a]/80 border border-gray-700/50 rounded-xl text-center">
          <div className="flex items-center justify-center gap-2 text-green-400">
            <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z"
                clipRule="evenodd"
              />
            </svg>
            <span className="font-medium">
              {location.city || location.address || `${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}`}
            </span>
          </div>
          <div className="text-xs text-gray-500 mt-1">
            {location.lat.toFixed(4)}°N, {Math.abs(location.lng).toFixed(4)}°{location.lng >= 0 ? 'E' : 'W'}
          </div>
        </div>
      )}
    </div>
  )
}
