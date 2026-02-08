// Hook for fetching Google Solar data layers (annual flux heatmap)

import useSWR from 'swr'
import type { DataLayersApiResponse, RenderedLayer, LatLng } from '@/types/googleSolar'

const fetcher = async (url: string): Promise<DataLayersApiResponse> => {
  const res = await fetch(url)
  return res.json()
}

interface UseSunroofMapReturn {
  annualFlux: RenderedLayer | undefined
  center: LatLng | undefined
  isLoading: boolean
  isError: boolean
  error: string | undefined
  isAvailable: boolean
}

export function useSunroofMap(
  lat: number | null | undefined,
  lng: number | null | undefined
): UseSunroofMapReturn {
  const shouldFetch = lat != null && lng != null && !isNaN(lat) && !isNaN(lng)
  const url = shouldFetch ? `/api/solar/data-layers?lat=${lat}&lng=${lng}` : null

  const { data, error, isLoading } = useSWR<DataLayersApiResponse>(
    url,
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      shouldRetryOnError: false,
    }
  )

  return {
    annualFlux: data?.data?.annualFlux,
    center: data?.data?.center,
    isLoading,
    isError: !!error || data?.success === false,
    error: data?.error,
    isAvailable: data?.success === true,
  }
}
