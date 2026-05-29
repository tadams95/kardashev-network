// Solar value calculations
// Converts irradiance data to dollar values of "wasted" energy

import type { WastedEnergy, SolarData } from '@/types/solar'

// US national average electricity price ($/kWh) — used when no location-specific rate is available
const DEFAULT_ELECTRICITY_PRICE = 0.16

// Typical residential solar panel efficiency
const PANEL_EFFICIENCY = 0.20

// System losses (inverter, wiring, etc.)
const SYSTEM_LOSSES = 0.14

// Default roof area estimate if no building data (m²)
const DEFAULT_ROOF_M2 = 150

// Average usable roof percentage for solar
const USABLE_ROOF_PERCENTAGE = 0.65

// Thermal derating coefficient: %/°C above 25°C
const THERMAL_COEFFICIENT = 0.4

/** Compute thermal efficiency (0-100%) from ambient temperature */
function computeThermalEfficiency(temperatureC: number): number {
  return Math.min(100, Math.max(0, 100 - (temperatureC - 25) * THERMAL_COEFFICIENT))
}

/** Estimate daily kWh from daily radiation sum (MJ/m²) */
export function estimateKwhFromRadiation(
  radiationSumMJ: number,
  areaM2: number = DEFAULT_ROOF_M2,
  isUsableArea: boolean = false
): number {
  const usableArea = isUsableArea ? areaM2 : areaM2 * USABLE_ROOF_PERCENTAGE
  return radiationSumMJ * usableArea * PANEL_EFFICIENCY * (1 - SYSTEM_LOSSES) / 3.6
}

/**
 * Calculate the dollar value of uncaptured solar energy
 * @param isUsableArea - true when areaM2 is already the usable panel area (e.g. from Google Solar)
 * @param thermalEfficiency - 0-100% temperature-derated panel efficiency (optional; from Open-Meteo)
 */
function calculateWastedValue(
  ghiWm2: number,
  areaM2: number = DEFAULT_ROOF_M2,
  isUsableArea: boolean = false,
  thermalEfficiency?: number,
  electricityRate: number = DEFAULT_ELECTRICITY_PRICE
): WastedEnergy {
  // If the area is already usable (e.g. Google Solar's maxArrayAreaMeters2), use it directly
  const usableArea = isUsableArea ? areaM2 : areaM2 * USABLE_ROOF_PERCENTAGE

  // Apply thermal derating when available (thermalEfficiency is 0-100%)
  const effectivePanelEfficiency = thermalEfficiency !== undefined
    ? PANEL_EFFICIENCY * (thermalEfficiency / 100)
    : PANEL_EFFICIENCY

  // Power that could be captured right now (kW)
  const capturedKw = (ghiWm2 * usableArea * effectivePanelEfficiency * (1 - SYSTEM_LOSSES)) / 1000

  // Current value per hour
  const currentValue = capturedKw * electricityRate

  // Current watts
  const currentWatts = capturedKw * 1000

  // Rough estimates for today and monthly
  // Assuming average of 6 peak sun hours remaining, with declining intensity
  const avgMultiplier = 0.6 // Average irradiance is ~60% of current peak
  const hoursRemaining = 6

  const todayValue = currentValue * hoursRemaining * avgMultiplier
  // Dampen by 0.75 to account for weather variability, cloudy days, and seasonal differences
  const monthlyEstimate = todayValue * 30 * 0.75

  return {
    currentWatts: Math.round(currentWatts),
    currentValue: Math.round(currentValue * 100) / 100,
    todayValue: Math.round(todayValue * 100) / 100,
    monthlyEstimate: Math.round(monthlyEstimate),
  }
}

/**
 * Calculate wasted value from full solar data with hourly projections
 * @param isUsableArea - true when areaM2 is already the usable panel area (e.g. from Google Solar)
 */
export function calculateWastedValueFromData(
  solarData: SolarData,
  areaM2: number = DEFAULT_ROOF_M2,
  isUsableArea: boolean = false,
  electricityRate: number = DEFAULT_ELECTRICITY_PRICE
): WastedEnergy {
  const { current, hourly } = solarData

  // Use thermal efficiency from current conditions when available (premium data)
  const thermalEff = current.thermalEfficiency

  // Current value
  const currentCalc = calculateWastedValue(current.ghi, areaM2, isUsableArea, thermalEff, electricityRate)

  // Calculate today's total from current calendar day's daylight hours only
  let todayTotal = 0
  for (const hour of hourly) {
    // Only sum hours from the current calendar day
    if (hour.ghi > 0 && (!solarData.currentDate || hour.time.startsWith(solarData.currentDate))) {
      // Use per-hour temperature when available, fall back to current snapshot
      const hourThermalEff = hour.temperature !== undefined
        ? computeThermalEfficiency(hour.temperature)
        : thermalEff
      const hourValue = calculateWastedValue(hour.ghi, areaM2, isUsableArea, hourThermalEff, electricityRate)
      todayTotal += hourValue.currentValue
    }
  }

  // Monthly estimate based on full-day projection
  // Dampen by 0.75 to account for weather variability, cloudy days, and seasonal differences
  const monthlyEstimate = todayTotal * 30 * 0.75

  return {
    currentWatts: currentCalc.currentWatts,
    currentValue: currentCalc.currentValue,
    todayValue: Math.round(todayTotal * 100) / 100,
    monthlyEstimate: Math.round(monthlyEstimate),
  }
}

/**
 * Get irradiance level description
 */
export function getIrradianceLevel(ghi: number): {
  level: 'none' | 'low' | 'moderate' | 'high' | 'peak'
  label: string
  color: string
} {
  if (ghi === 0) {
    return { level: 'none', label: 'No sunlight', color: 'text-gray-400' }
  }
  if (ghi < 200) {
    return { level: 'low', label: 'Low', color: 'text-yellow-500' }
  }
  if (ghi < 500) {
    return { level: 'moderate', label: 'Moderate', color: 'text-yellow-400' }
  }
  if (ghi < 800) {
    return { level: 'high', label: 'High', color: 'text-orange-400' }
  }
  return { level: 'peak', label: 'Peak', color: 'text-amber-500' }
}
