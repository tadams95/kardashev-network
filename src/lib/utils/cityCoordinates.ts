// Major US cities with coordinates (covers Kalshi weather markets)
// Used by backtesting to map city codes (NY, CHI, etc.) to lat/lng

export interface CityCoordinates {
  code: string
  name: string
  lat: number
  lng: number
}

export const CITY_COORDS: Record<string, CityCoordinates> = {
  // Kalshi markets (priority - these appear in kalshi_real_2024.csv)
  'NY': { code: 'NY', name: 'New York', lat: 40.7128, lng: -74.0060 },
  'NYC': { code: 'NYC', name: 'New York', lat: 40.7128, lng: -74.0060 },
  'CHI': { code: 'CHI', name: 'Chicago', lat: 41.8781, lng: -87.6298 },
  'AUS': { code: 'AUS', name: 'Austin', lat: 30.2672, lng: -97.7431 },
  'MIA': { code: 'MIA', name: 'Miami', lat: 25.7617, lng: -80.1918 },

  // Additional major cities (for future Kalshi market expansion)
  'LA': { code: 'LA', name: 'Los Angeles', lat: 34.0522, lng: -118.2437 },
  'SF': { code: 'SF', name: 'San Francisco', lat: 37.7749, lng: -122.4194 },
  'DAL': { code: 'DAL', name: 'Dallas', lat: 32.7767, lng: -96.7970 },
  'HOU': { code: 'HOU', name: 'Houston', lat: 29.7604, lng: -95.3698 },
  'PHX': { code: 'PHX', name: 'Phoenix', lat: 33.4484, lng: -112.0740 },
  'SEA': { code: 'SEA', name: 'Seattle', lat: 47.6062, lng: -122.3321 },
  'BOS': { code: 'BOS', name: 'Boston', lat: 42.3601, lng: -71.0589 },
  'DEN': { code: 'DEN', name: 'Denver', lat: 39.7392, lng: -104.9903 },
  'ATL': { code: 'ATL', name: 'Atlanta', lat: 33.7490, lng: -84.3880 },
  'PHI': { code: 'PHI', name: 'Philadelphia', lat: 39.9526, lng: -75.1652 },
  'DC': { code: 'DC', name: 'Washington DC', lat: 38.9072, lng: -77.0369 },
  'LV': { code: 'LV', name: 'Las Vegas', lat: 36.1699, lng: -115.1398 },
}

/**
 * Get city coordinates from city code
 * @param cityCode - City code (e.g., 'NY', 'CHI', 'AUS')
 * @returns City coordinates or null if not found
 */
export function getCityCoordinates(cityCode: string): CityCoordinates | null {
  const coords = CITY_COORDS[cityCode.toUpperCase()]
  if (!coords) {
    console.warn(`⚠️  Unknown city code: ${cityCode}. Available: ${Object.keys(CITY_COORDS).join(', ')}`)
    return null
  }
  return coords
}
