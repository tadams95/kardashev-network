import { useState, useCallback, useRef, useEffect } from 'react'
import { useRouter } from 'next/router'
import { useLocation } from '@/hooks/useLocation'

interface SearchResult {
  lat: number
  lng: number
  displayName: string
  city?: string
  address?: string
}

interface LocationSearchProps {
  navigateToDashboard?: boolean
  onLocationSelect?: () => void
  compact?: boolean
}

// Constants for search behavior
const DEBOUNCE_MS = 600 // Aligned with API rate limit (1 req/sec)
const MAX_RETRIES = 2
const RETRY_DELAY_MS = 1100 // Just over 1 second to respect rate limit

export default function LocationSearch({
  navigateToDashboard = false,
  onLocationSelect,
  compact = false,
}: LocationSearchProps = {}) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [isRetrying, setIsRetrying] = useState(false)
  const [showResults, setShowResults] = useState(false)
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current)
      if (abortControllerRef.current) abortControllerRef.current.abort()
    }
  }, [])

  const searchAddress = useCallback(async (searchQuery: string, retryCount = 0) => {
    if (searchQuery.length < 2) {
      setResults([])
      setShowResults(false)
      return
    }

    // Cancel any in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    abortControllerRef.current = new AbortController()

    setIsSearching(true)
    if (retryCount > 0) setIsRetrying(true)

    try {
      const response = await fetch(
        `/api/geocode/search?q=${encodeURIComponent(searchQuery)}`,
        { signal: abortControllerRef.current.signal }
      )

      // Handle rate limiting with retry
      if (response.status === 429 && retryCount < MAX_RETRIES) {
        setIsRetrying(true)
        retryTimeoutRef.current = setTimeout(() => {
          searchAddress(searchQuery, retryCount + 1)
        }, RETRY_DELAY_MS)
        return
      }

      const data = await response.json()

      if (data.success && Array.isArray(data.data)) {
        setResults(data.data)
        setShowResults(data.data.length > 0)
      } else {
        setResults([])
        setShowResults(false)
      }
    } catch (err) {
      // Ignore abort errors
      if (err instanceof Error && err.name === 'AbortError') return
      setResults([])
      setShowResults(false)
    } finally {
      setIsSearching(false)
      setIsRetrying(false)
    }
  }, [])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setQuery(value)

    // Clear any pending searches or retries
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current)

    // Don't search if too short
    if (value.length < 2) {
      setResults([])
      setShowResults(false)
      setIsSearching(false)
      setIsRetrying(false)
      return
    }

    // Debounce search - aligned with API rate limit
    searchTimeoutRef.current = setTimeout(() => {
      searchAddress(value)
    }, DEBOUNCE_MS)
  }

  const handleSelectResult = (result: SearchResult) => {
    setManualLocation({
      lat: result.lat,
      lng: result.lng,
      city: result.city,
      address: result.address || result.displayName,
    })
    setQuery(result.city || result.displayName.split(',')[0])
    setShowResults(false)
    setResults([])
    onLocationSelect?.()
    if (navigateToDashboard) {
      router.push({
        pathname: '/dashboard',
        query: { lat: result.lat, lng: result.lng, city: result.city, address: result.address || result.displayName },
      })
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
        router.push({
          pathname: '/dashboard',
          query: { lat: loc.lat, lng: loc.lng, ...(loc.city && { city: loc.city }), ...(loc.address && { address: loc.address }) },
        })
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
      <div className="relative z-50">
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
              className="w-full p-button-lg bg-black border border-gray-700/50 rounded-card text-white placeholder-gray-400 focus:outline-none focus:border-amber-600 focus:ring-1 focus:ring-amber-600 transition-all"
            />
            {(isSearching || isRetrying) && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                <div className="w-5 h-5 border-2 border-amber-600 border-t-transparent rounded-full animate-spin" />
                {isRetrying && (
                  <span className="text-caption text-gray-400">Retrying...</span>
                )}
              </div>
            )}
          </div>

          {/* Use my location button */}
          <button
            onClick={handleUseMyLocation}
            disabled={isLoading}
            className="p-button-lg bg-amber-600 hover:bg-amber-700 disabled:bg-gray-700 text-white rounded-card transition-all shadow-lg shadow-amber-600/20 hover:shadow-amber-600/30 flex items-center gap-2"
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
          <div className="absolute z-50 w-full mt-2 bg-[#0a0a0a] border border-gray-700/50 rounded-card shadow-xl overflow-hidden">
            {results.map((result, index) => (
              <button
                key={`${result.lat}-${result.lng}-${index}`}
                onClick={() => handleSelectResult(result)}
                className="w-full p-button-lg text-left text-white hover:bg-[#141414] transition-colors border-b border-gray-700/50 last:border-b-0"
              >
                <div className="font-medium text-amber-500">
                  {result.city || result.displayName.split(',')[0]}
                </div>
                <div className="text-body text-gray-400 truncate">
                  {result.displayName}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Error message */}
      {error && (
        <div className="mt-3 p-card-sm bg-red-900/50 border border-red-700 rounded-inner text-red-300 text-body">
          {error}
        </div>
      )}

      {/* Current location display */}
      {location && !error && (
        <div className="mt-3 p-card-sm bg-[#0a0a0a]/80 border border-gray-700/50 rounded-card text-center">
          <div className="flex items-center justify-center gap-2 text-amber-500">
            <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z"
                clipRule="evenodd"
              />
            </svg>
            <span className="font-medium">
              {location.address || location.city || `${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}`}
            </span>
          </div>
          <div className="text-caption text-gray-500 mt-1">
            {location.lat.toFixed(4)}°N, {Math.abs(location.lng).toFixed(4)}°{location.lng >= 0 ? 'E' : 'W'}
          </div>
        </div>
      )}
    </div>
  )
}
