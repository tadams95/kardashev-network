// Hook for fetching Google Solar API building insights

import useSWR from 'swr'
import type { BuildingInsightsResponse, BuildingInsights, RoofSummary } from '@/types/googleSolar'

const ELECTRICITY_RATE = 0.32 // $/kWh (California average)
const SYSTEM_LOSSES = 0.14 // Inverter, wiring losses (DC → AC)

const fetcher = async (url: string): Promise<BuildingInsightsResponse> => {
  const res = await fetch(url)
  return res.json()
}

// Convert azimuth degrees to compass direction
function azimuthToDirection(azimuth: number): string {
  const directions = ['North', 'NE', 'East', 'SE', 'South', 'SW', 'West', 'NW']
  const index = Math.round(azimuth / 45) % 8
  return directions[index]
}

// Process raw building insights into a simplified summary
function processRoofData(data: BuildingInsights): RoofSummary {
  const { solarPotential } = data

  // Find the best panel configuration (max energy)
  const bestConfig = solarPotential.solarPanelConfigs.reduce((best, config) =>
    config.yearlyEnergyDcKwh > best.yearlyEnergyDcKwh ? config : best
  , solarPotential.solarPanelConfigs[0])

  // Calculate yearly savings (convert DC → AC)
  const yearlyEnergyDcKwh = bestConfig?.yearlyEnergyDcKwh ?? 0
  const yearlyEnergyKwh = yearlyEnergyDcKwh * (1 - SYSTEM_LOSSES)
  const yearlySavings = yearlyEnergyKwh * ELECTRICITY_RATE

  // Calculate carbon offset (based on AC output)
  const carbonOffsetKg = (yearlyEnergyKwh / 1000) * solarPotential.carbonOffsetFactorKgPerMwh

  // Process roof segments
  const segments = solarPotential.roofSegmentStats.map((segment, idx) => {
    const configSegment = bestConfig?.roofSegmentSummaries.find(s => s.segmentIndex === idx)
    return {
      areaM2: segment.stats.areaMeters2,
      pitch: segment.pitchDegrees,
      azimuth: azimuthToDirection(segment.azimuthDegrees),
      panelCount: configSegment?.panelsCount ?? 0,
    }
  })

  // Format imagery date
  const { year, month, day } = data.imageryDate
  const imageryDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`

  return {
    totalAreaM2: solarPotential.wholeRoofStats.areaMeters2,
    usableAreaM2: solarPotential.maxArrayAreaMeters2,
    maxPanels: solarPotential.maxArrayPanelsCount,
    yearlyEnergyKwh,
    yearlySavings,
    carbonOffsetKg,
    segments,
    imageryDate,
    quality: data.imageryQuality,
  }
}

interface UseGoogleSolarReturn {
  buildingInsights: BuildingInsights | undefined
  roofSummary: RoofSummary | undefined
  isLoading: boolean
  isError: boolean
  error: string | undefined
  isAvailable: boolean // Whether Google Solar has data for this location
}

export function useGoogleSolar(
  lat: number | null | undefined,
  lng: number | null | undefined
): UseGoogleSolarReturn {
  const shouldFetch = lat != null && lng != null && !isNaN(lat) && !isNaN(lng)
  const url = shouldFetch ? `/api/solar/building-insights?lat=${lat}&lng=${lng}` : null

  const { data, error, isLoading } = useSWR<BuildingInsightsResponse>(
    url,
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      // Don't retry on 404 (no data available)
      shouldRetryOnError: false,
    }
  )

  const buildingInsights = data?.success ? data.data : undefined
  const roofSummary = buildingInsights ? processRoofData(buildingInsights) : undefined

  return {
    buildingInsights,
    roofSummary,
    isLoading,
    isError: !!error || (data?.success === false && !data?.error?.includes('No building data')),
    error: data?.error,
    isAvailable: data?.success === true,
  }
}
