// Google Solar API types

export interface LatLng {
  latitude: number
  longitude: number
}

export interface Date {
  year: number
  month: number
  day: number
}

export interface Money {
  currencyCode: string
  units: string
  nanos?: number
}

export interface SizeAndSunshineStats {
  areaMeters2: number
  sunshineQuantiles: number[] // kWh/m²/year at different percentiles
  groundAreaMeters2?: number
}

export interface RoofSegmentSizeAndSunshineStats {
  pitchDegrees: number
  azimuthDegrees: number
  stats: SizeAndSunshineStats
  center: LatLng
  boundingBox: {
    sw: LatLng
    ne: LatLng
  }
  planeHeightAtCenterMeters: number
}

export interface SolarPanelConfig {
  panelsCount: number
  yearlyEnergyDcKwh: number
  roofSegmentSummaries: Array<{
    pitchDegrees: number
    azimuthDegrees: number
    panelsCount: number
    yearlyEnergyDcKwh: number
    segmentIndex: number
  }>
}

export interface FinancialAnalysis {
  monthlyBill: Money
  defaultBill?: boolean
  averageKwhPerMonth: number
  financialDetails?: {
    initialAcKwhPerYear: number
    remainingLifetimeUtilityBill: Money
    federalIncentive: Money
    stateIncentive: Money
    utilityIncentive: Money
    lifetimeSrecTotal: Money
    costOfElectricityWithoutSolar: Money
    netMeteringAllowed: boolean
    solarPercentage: number
    percentageExportedToGrid: number
  }
  leasingSavings?: {
    leasesAllowed: boolean
    leasesSupported: boolean
    annualLeasingCost: Money
    savings: {
      savingsYear1: Money
      savingsYear20: Money
      presentValueOfSavingsYear20: Money
      savingsLifetime: Money
      presentValueOfSavingsLifetime: Money
      financiallyViable: boolean
    }
  }
  cashPurchaseSavings?: {
    outOfPocketCost: Money
    upfrontCost: Money
    rebateValue: Money
    paybackYears: number
    savings: {
      savingsYear1: Money
      savingsYear20: Money
      presentValueOfSavingsYear20: Money
      savingsLifetime: Money
      presentValueOfSavingsLifetime: Money
      financiallyViable: boolean
    }
  }
  financedPurchaseSavings?: {
    annualLoanPayment: Money
    rebateValue: Money
    loanInterestRate: number
    savings: {
      savingsYear1: Money
      savingsYear20: Money
      presentValueOfSavingsYear20: Money
      savingsLifetime: Money
      presentValueOfSavingsLifetime: Money
      financiallyViable: boolean
    }
  }
  panelConfigIndex?: number
  panelLifetimeYears?: number
}

export interface SolarPotential {
  maxArrayPanelsCount: number
  maxArrayAreaMeters2: number
  maxSunshineHoursPerYear: number
  carbonOffsetFactorKgPerMwh: number
  wholeRoofStats: SizeAndSunshineStats
  roofSegmentStats: RoofSegmentSizeAndSunshineStats[]
  solarPanels: Array<{
    center: LatLng
    orientation: 'LANDSCAPE' | 'PORTRAIT'
    yearlyEnergyDcKwh: number
    segmentIndex: number
  }>
  solarPanelConfigs: SolarPanelConfig[]
  financialAnalyses?: FinancialAnalysis[]
  panelCapacityWatts?: number
  panelHeightMeters?: number
  panelWidthMeters?: number
  panelLifetimeYears?: number
  buildingStats?: SizeAndSunshineStats
}

export interface BuildingInsights {
  name: string
  center: LatLng
  boundingBox: {
    sw: LatLng
    ne: LatLng
  }
  imageryDate: Date
  imageryProcessedDate: Date
  postalCode: string
  administrativeArea: string
  statisticalArea: string
  regionCode: string
  solarPotential: SolarPotential
  imageryQuality: 'HIGH' | 'MEDIUM' | 'LOW'
}

export interface BuildingInsightsResponse {
  success: boolean
  data?: BuildingInsights
  error?: string
  cached?: boolean
}

// Simplified roof data for UI display
export interface RoofSummary {
  totalAreaM2: number
  usableAreaM2: number
  maxPanels: number
  yearlyEnergyKwh: number
  yearlySavings: number
  carbonOffsetKg: number
  segments: Array<{
    areaM2: number
    pitch: number
    azimuth: string // 'North', 'South', 'East', 'West', etc.
    panelCount: number
  }>
  imageryDate: string
  quality: 'HIGH' | 'MEDIUM' | 'LOW'
}

// ─── Data Layers API Types ─────────────────────────────────────────

export interface DataLayersResponse {
  imageryDate: Date
  imageryProcessedDate: Date
  dsmUrl: string
  rgbUrl: string
  maskUrl: string
  annualFluxUrl: string
  monthlyFluxUrl: string
  hourlyShadeUrls: string[]
  imageryQuality: 'HIGH' | 'MEDIUM' | 'LOW'
}

export interface GeoBounds {
  north: number
  south: number
  east: number
  west: number
}

export interface RenderedLayer {
  imageDataUrl: string   // data:image/png;base64,...
  bounds: GeoBounds
  width: number
  height: number
}

export interface DataLayersApiResponse {
  success: boolean
  data?: {
    annualFlux: RenderedLayer
    center: LatLng
    imageryDate: Date
    quality: 'HIGH' | 'MEDIUM' | 'LOW'
  }
  error?: string
  cached?: boolean
}
