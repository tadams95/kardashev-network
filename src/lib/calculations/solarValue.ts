// Solar value calculations
// Converts irradiance data to dollar values of "wasted" energy

import type { WastedEnergy, SolarData } from '@/types/solar'

// California average electricity price ($/kWh)
const ELECTRICITY_PRICE = 0.32

// Typical residential solar panel efficiency
const PANEL_EFFICIENCY = 0.20

// System losses (inverter, wiring, etc.)
const SYSTEM_LOSSES = 0.14

// Default roof area estimate if no building data (m²)
const DEFAULT_ROOF_M2 = 150

// Average usable roof percentage for solar
const USABLE_ROOF_PERCENTAGE = 0.65

/**
 * Calculate the dollar value of uncaptured solar energy
 * @param isUsableArea - true when areaM2 is already the usable panel area (e.g. from Google Solar)
 */
export function calculateWastedValue(
  ghiWm2: number,
  areaM2: number = DEFAULT_ROOF_M2,
  isUsableArea: boolean = false
): WastedEnergy {
  // If the area is already usable (e.g. Google Solar's maxArrayAreaMeters2), use it directly
  const usableArea = isUsableArea ? areaM2 : areaM2 * USABLE_ROOF_PERCENTAGE

  // Power that could be captured right now (kW)
  const capturedKw = (ghiWm2 * usableArea * PANEL_EFFICIENCY * (1 - SYSTEM_LOSSES)) / 1000

  // Current value per hour
  const currentValue = capturedKw * ELECTRICITY_PRICE

  // Current watts
  const currentWatts = capturedKw * 1000

  // Rough estimates for today and monthly
  // Assuming average of 6 peak sun hours remaining, with declining intensity
  const avgMultiplier = 0.6 // Average irradiance is ~60% of current peak
  const hoursRemaining = 6

  const todayValue = currentValue * hoursRemaining * avgMultiplier
  const monthlyEstimate = todayValue * 30

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
  isUsableArea: boolean = false
): WastedEnergy {
  const { current, hourly } = solarData

  // Current value
  const currentCalc = calculateWastedValue(current.ghi, areaM2, isUsableArea)

  // Calculate today's total from ALL daylight hours (not just remaining)
  let todayTotal = 0
  for (const hour of hourly) {
    if (hour.ghi > 0) {
      const hourValue = calculateWastedValue(hour.ghi, areaM2, isUsableArea)
      todayTotal += hourValue.currentValue
    }
  }

  // Monthly estimate based on full-day projection
  const monthlyEstimate = todayTotal * 30

  return {
    currentWatts: currentCalc.currentWatts,
    currentValue: currentCalc.currentValue,
    todayValue: Math.round(todayTotal * 100) / 100,
    monthlyEstimate: Math.round(monthlyEstimate),
  }
}

/**
 * Format watts for display
 */
export function formatWatts(watts: number): string {
  if (watts >= 1000) {
    return `${(watts / 1000).toFixed(1)} kW`
  }
  return `${Math.round(watts)} W`
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
