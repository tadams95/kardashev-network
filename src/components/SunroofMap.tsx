// Solar Roof Map — Google Maps satellite view with annual flux heatmap overlay

import { useMemo, useEffect, useState, useCallback } from 'react'
import { GoogleMap, useLoadScript } from '@react-google-maps/api'
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
        <div className="h-4 w-28 bg-gray-700/50 rounded-chip animate-pulse" />
        <div className="h-3 w-20 bg-gray-700/50 rounded-chip animate-pulse" />
      </div>
      <div className="h-[300px] bg-gray-700/30 rounded-card animate-pulse" />
      <div className="mt-2 h-3 w-full bg-gray-700/30 rounded-chip animate-pulse" />
    </div>
  )
}

export default function SunroofMap({ lat, lng }: SunroofMapProps) {
  const { annualFlux, isLoading, isError, isAvailable } = useSunroofMap(lat, lng)

  const { isLoaded, loadError } = useLoadScript({
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '',
  })

  const center = useMemo(() => ({ lat, lng }), [lat, lng])
  const [map, setMap] = useState<google.maps.Map | null>(null)

  const onMapLoad = useCallback((map: google.maps.Map) => {
    setMap(map)
  }, [])

  // Attach GroundOverlay via native API (bypasses @react-google-maps wrapper bugs).
  // After the overlay is attached, fitBounds() the map to the heatmap so the
  // user sees the full roof plus a small surrounding margin — replaces the
  // static zoom={20} which framed only the rooftop. Per plan §3.8.
  useEffect(() => {
    if (!map || !annualFlux?.bounds || !annualFlux?.imageDataUrl) return

    const { south, west, north, east } = annualFlux.bounds
    const bounds = new google.maps.LatLngBounds(
      new google.maps.LatLng(south, west),
      new google.maps.LatLng(north, east),
    )

    const overlay = new google.maps.GroundOverlay(
      annualFlux.imageDataUrl,
      bounds,
      { opacity: 0.85 },
    )
    overlay.setMap(map)
    map.fitBounds(bounds, { top: 24, right: 24, bottom: 24, left: 24 })

    return () => {
      overlay.setMap(null)
    }
  }, [map, annualFlux])

  // Loading state
  if (isLoading || !isLoaded) {
    return <SunroofMapSkeleton />
  }

  // Maps JS API failed to load
  if (loadError) {
    return (
      <div>
        <h3 className="text-body font-medium text-gray-300 mb-3">Solar Roof Map</h3>
        <div className="h-[300px] bg-gray-800/50 rounded-card flex items-center justify-center">
          <p className="text-body text-gray-500">Failed to load Google Maps</p>
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
        <h3 className="text-body font-medium text-gray-300">Solar Roof Map</h3>
        <span className="text-micro text-amber-500 uppercase tracking-wide font-medium">Google Solar</span>
      </div>

      {/* Map. Initial zoom={19} is the load-state frame; fitBounds() in the
          effect above re-frames once the heatmap arrives so the full roof
          + a touch of context is visible. */}
      <GoogleMap
        mapContainerStyle={mapContainerStyle}
        center={center}
        zoom={19}
        options={mapOptions}
        onLoad={onMapLoad}
      />

      {/* Color Legend */}
      <div className="mt-2.5">
        <div
          className="h-2 rounded-full"
          style={{
            background: 'linear-gradient(to right, #500080, #0000DC, #00B4C8, #00C800, #FFE600, #FFA000, #FF3C00, #FFC864, #FFFFDC)',
          }}
        />
        <div className="flex justify-between mt-1">
          <span className="text-micro text-gray-500">Low</span>
          <span className="text-micro text-gray-500">Solar radiation (kWh/m²/year)</span>
          <span className="text-micro text-gray-500">High</span>
        </div>
      </div>
    </div>
  )
}
