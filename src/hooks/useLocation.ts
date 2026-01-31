import { useCallback } from 'react'
import { useLocationContext } from '@/context/LocationContext'
import type { Location } from '@/types/solar'

interface UseLocationReturn {
  location: Location | null
  isLoading: boolean
  error: string | null
  requestLocation: () => Promise<Location | null>
  setManualLocation: (location: Location) => void
  clearLocation: () => void
}

export function useLocation(): UseLocationReturn {
  const {
    location,
    setLocation,
    isLoading,
    setIsLoading,
    error,
    setError,
    clearLocation,
  } = useLocationContext()

  const requestLocation = useCallback(async (): Promise<Location | null> => {
    if (!navigator.geolocation) {
      setError('Geolocation is not supported by your browser')
      return null
    }

    setIsLoading(true)
    setError(null)

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const loc: Location = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          }

          // Try to get city name via reverse geocoding
          try {
            const response = await fetch(
              `/api/geocode/search?lat=${loc.lat}&lng=${loc.lng}&reverse=true`
            )
            if (response.ok) {
              const data = await response.json()
              if (data.success && data.data) {
                loc.city = data.data.city
                loc.address = data.data.address
              }
            }
          } catch {
            // Reverse geocoding failed, continue without city name
          }

          setLocation(loc)
          setIsLoading(false)
          resolve(loc)
        },
        (err) => {
          let errorMessage = 'Failed to get your location'

          switch (err.code) {
            case err.PERMISSION_DENIED:
              errorMessage = 'Location access denied. Please enable location permissions or search for an address.'
              break
            case err.POSITION_UNAVAILABLE:
              errorMessage = 'Location information unavailable. Please try searching for an address.'
              break
            case err.TIMEOUT:
              errorMessage = 'Location request timed out. Please try again or search for an address.'
              break
          }

          setError(errorMessage)
          setIsLoading(false)
          resolve(null)
        },
        {
          enableHighAccuracy: false,
          timeout: 10000,
          maximumAge: 300000, // Cache for 5 minutes
        }
      )
    })
  }, [setLocation, setIsLoading, setError])

  const setManualLocation = useCallback(
    (loc: Location) => {
      setLocation(loc)
    },
    [setLocation]
  )

  return {
    location,
    isLoading,
    error,
    requestLocation,
    setManualLocation,
    clearLocation,
  }
}
