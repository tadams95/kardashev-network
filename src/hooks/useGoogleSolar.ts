// Hook for fetching Google Solar API building insights

import useSWR from 'swr'
import type { BuildingInsightsResponse, BuildingInsights, RoofSummary, FinancialAnalysis } from '@/types/googleSolar'

const DEFAULT_ELECTRICITY_RATE = 0.16 // $/kWh (US national average fallback)
const SYSTEM_LOSSES = 0.14 // Inverter, wiring losses (DC → AC)
const TYPICAL_ANNUAL_USAGE_KWH = 10500 // Average US household annual electricity consumption

// Extract effective $/kWh from Google Solar financialAnalyses
function extractElectricityRate(analyses?: FinancialAnalysis[]): number | undefined {
  if (!analyses || analyses.length === 0) return undefined
  const entry = analyses.find(a => a.defaultBill) ?? analyses[0]
  const { monthlyBill, averageKwhPerMonth } = entry
  if (!monthlyBill || !averageKwhPerMonth || averageKwhPerMonth <= 0) return undefined
  const dollars = parseFloat(monthlyBill.units || '0') + (monthlyBill.nanos ?? 0) / 1e9
  if (!isFinite(dollars) || dollars <= 0) return undefined
  const rate = dollars / averageKwhPerMonth
  return isFinite(rate) && rate > 0 ? rate : undefined
}

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
  const configs = solarPotential.solarPanelConfigs

  const electricityRate = extractElectricityRate(solarPotential.financialAnalyses) ?? DEFAULT_ELECTRICITY_RATE

  // Defensive guard: if no configs, return zeroed-out summary
  if (configs.length === 0) {
    const { year, month, day } = data.imageryDate
    const imageryDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    return {
      totalAreaM2: solarPotential.wholeRoofStats.areaMeters2,
      usableAreaM2: solarPotential.maxArrayAreaMeters2,
      maxPanels: 0,
      panelCount: 0,
      yearlyEnergyKwh: 0,
      yearlySavings: 0,
      carbonOffsetKg: 0,
      coveragePercent: 0,
      recommendedAreaM2: 0,
      maxYearlyEnergyKwh: 0,
      maxYearlySavings: 0,
      electricityRate,
      segments: [],
      imageryDate,
      quality: data.imageryQuality,
    }
  }

  // Find the max panel configuration
  const maxConfig = configs.reduce((best, config) =>
    config.yearlyEnergyDcKwh > best.yearlyEnergyDcKwh ? config : best
  , configs[0])

  // Find recommended config: closest to offsetting ~100% of avg US household usage
  const recommendedConfig = configs.reduce((closest, config) => {
    const closestAcKwh = closest.yearlyEnergyDcKwh * (1 - SYSTEM_LOSSES)
    const configAcKwh = config.yearlyEnergyDcKwh * (1 - SYSTEM_LOSSES)
    return Math.abs(configAcKwh - TYPICAL_ANNUAL_USAGE_KWH) < Math.abs(closestAcKwh - TYPICAL_ANNUAL_USAGE_KWH)
      ? config : closest
  }, configs[0])

  // Calculate recommended config values (DC → AC)
  const yearlyEnergyKwh = recommendedConfig.yearlyEnergyDcKwh * (1 - SYSTEM_LOSSES)
  const yearlySavings = yearlyEnergyKwh * electricityRate
  const carbonOffsetKg = (yearlyEnergyKwh / 1000) * solarPotential.carbonOffsetFactorKgPerMwh

  // Calculate max config values for reference
  const maxYearlyEnergyKwh = maxConfig.yearlyEnergyDcKwh * (1 - SYSTEM_LOSSES)
  const maxYearlySavings = maxYearlyEnergyKwh * electricityRate

  // Process roof segments (from recommended config)
  const segments = solarPotential.roofSegmentStats.map((segment, idx) => {
    const configSegment = recommendedConfig.roofSegmentSummaries.find(s => s.segmentIndex === idx)
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

  const coveragePercent = Math.round((yearlyEnergyKwh / TYPICAL_ANNUAL_USAGE_KWH) * 100)
  const recommendedAreaM2 = solarPotential.maxArrayPanelsCount > 0
    ? (recommendedConfig.panelsCount / solarPotential.maxArrayPanelsCount) * solarPotential.maxArrayAreaMeters2
    : 0

  return {
    totalAreaM2: solarPotential.wholeRoofStats.areaMeters2,
    usableAreaM2: solarPotential.maxArrayAreaMeters2,
    maxPanels: solarPotential.maxArrayPanelsCount,
    panelCount: recommendedConfig.panelsCount,
    yearlyEnergyKwh,
    yearlySavings,
    carbonOffsetKg,
    coveragePercent,
    recommendedAreaM2,
    maxYearlyEnergyKwh,
    maxYearlySavings,
    electricityRate,
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
