// Temperature conversion utilities

/**
 * Convert Celsius to Fahrenheit
 */
export function celsiusToFahrenheit(celsius: number): number {
  return (celsius * 9) / 5 + 32
}

/**
 * Convert Fahrenheit to Celsius
 */
export function fahrenheitToCelsius(fahrenheit: number): number {
  return ((fahrenheit - 32) * 5) / 9
}

/**
 * Format temperature with proper unit
 */
export function formatTemperature(temp: number, unit: 'C' | 'F' = 'F', decimals: number = 1): string {
  return `${temp.toFixed(decimals)}°${unit}`
}
