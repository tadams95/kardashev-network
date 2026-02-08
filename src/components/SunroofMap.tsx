// Solar Roof Map — Google Maps satellite view with annual flux heatmap overlay

import { useMemo } from 'react'
import { GoogleMap, GroundOverlay, useLoadScript } from '@react-google-maps/api'
import { useSunroofMap } from '@/hooks/useSunroofMap'

interface SunroofMapProps {
  lat: number
  lng: number
}

const mapContainerStyle = {
  width: '100%',
  height: '300px',
  borderRadius: '0.75rem',
}

const mapOptions: google.maps.MapOptions = {
  mapTypeId: 'satellite',
  tilt: 0,
  disableDefaultUI: true,
  zoomControl: true,
  gestureHandling: 'cooperative',
}

export function SunroofMapSkeleton() {
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="h-4 w-28 bg-gray-700/50 rounded animate-pulse" />
        <div className="h-3 w-20 bg-gray-700/50 rounded animate-pulse" />
      </div>
      <div className="h-[300px] bg-gray-700/30 rounded-xl animate-pulse" />
      <div className="mt-2 h-3 w-full bg-gray-700/30 rounded animate-pulse" />
    </div>
  )
}

export default function SunroofMap({ lat, lng }: SunroofMapProps) {
  const { annualFlux, isLoading, isError, isAvailable } = useSunroofMap(lat, lng)

  const { isLoaded, loadError } = useLoadScript({
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '',
  })

  const center = useMemo(() => ({ lat, lng }), [lat, lng])

  const overlayBounds = useMemo(() => {
    if (!annualFlux?.bounds) return null
    return {
      north: annualFlux.bounds.north,
      south: annualFlux.bounds.south,
      east: annualFlux.bounds.east,
      west: annualFlux.bounds.west,
    }
  }, [annualFlux?.bounds])

  // Loading state
  if (isLoading || !isLoaded) {
    return <SunroofMapSkeleton />
  }

  // Maps JS API failed to load
  if (loadError) {
    return (
      <div>
        <h3 className="text-sm font-medium text-gray-300 mb-3">Solar Roof Map</h3>
        <div className="h-[300px] bg-gray-800/50 rounded-xl flex items-center justify-center">
          <p className="text-sm text-gray-500">Failed to load Google Maps</p>
        </div>
      </div>
    )
  }

  // No data for this location or error
  if (isError || !isAvailable) {
    return null
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-gray-300">Solar Roof Map</h3>
        <span className="text-[10px] text-amber-500 uppercase tracking-wide font-medium">Google Solar</span>
      </div>

      {/* Map */}
      <GoogleMap
        mapContainerStyle={mapContainerStyle}
        center={center}
        zoom={20}
        options={mapOptions}
      >
        {annualFlux && overlayBounds && (
          <GroundOverlay
            url={annualFlux.imageDataUrl}
            bounds={overlayBounds}
            options={{ opacity: 0.75 }}
          />
        )}
      </GoogleMap>

      {/* Color Legend */}
      <div className="mt-2.5">
        <div
          className="h-2 rounded-full"
          style={{
            background: 'linear-gradient(to right, #660099, #0000FF, #00CCCC, #00CC00, #FFFF00, #FF9900, #FF0000)',
          }}
        />
        <div className="flex justify-between mt-1">
          <span className="text-[10px] text-gray-500">Low</span>
          <span className="text-[10px] text-gray-500">Solar radiation (kWh/m²/year)</span>
          <span className="text-[10px] text-gray-500">High</span>
        </div>
      </div>
    </div>
  )
}
