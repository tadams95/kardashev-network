import { createContext, useContext, useState, useCallback, ReactNode } from 'react'
import type { Location } from '@/types/solar'

interface LocationContextType {
  location: Location | null
  setLocation: (location: Location | null) => void
  isLoading: boolean
  setIsLoading: (loading: boolean) => void
  error: string | null
  setError: (error: string | null) => void
  clearLocation: () => void
}

const LocationContext = createContext<LocationContextType | undefined>(undefined)

interface LocationProviderProps {
  children: ReactNode
}

export function LocationProvider({ children }: LocationProviderProps) {
  const [location, setLocationState] = useState<Location | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const setLocation = useCallback((loc: Location | null) => {
    setLocationState(loc)
    setError(null)
  }, [])

  const clearLocation = useCallback(() => {
    setLocationState(null)
    setError(null)
  }, [])

  return (
    <LocationContext.Provider
      value={{
        location,
        setLocation,
        isLoading,
        setIsLoading,
        error,
        setError,
        clearLocation,
      }}
    >
      {children}
    </LocationContext.Provider>
  )
}

export function useLocationContext() {
  const context = useContext(LocationContext)
  if (context === undefined) {
    throw new Error('useLocationContext must be used within a LocationProvider')
  }
  return context
}
