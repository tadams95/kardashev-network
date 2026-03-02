// Major US cities with coordinates (covers Kalshi weather markets)
// Maps city codes (NY, CHI, etc.) to lat/lng coordinates

export interface CityCoordinates {
  code: string
  name: string
  lat: number
  lng: number
  timezone: string              // IANA timezone (e.g., 'America/New_York')
  resolutionStation?: string  // ICAO code of Kalshi resolution station
}

export const CITY_COORDS: Record<string, CityCoordinates> = {
  // Kalshi markets (priority - these appear in kalshi_real_2024.csv)
  // Coordinates aligned to Kalshi resolution stations (NWS CLI reports)
  'NY': { code: 'NY', name: 'New York', lat: 40.7790, lng: -73.9692, timezone: 'America/New_York', resolutionStation: 'KNYC' },
  'NYC': { code: 'NYC', name: 'New York', lat: 40.7790, lng: -73.9692, timezone: 'America/New_York', resolutionStation: 'KNYC' },
  'CHI': { code: 'CHI', name: 'Chicago', lat: 41.7841, lng: -87.7551, timezone: 'America/Chicago', resolutionStation: 'KMDW' },
  'AUS': { code: 'AUS', name: 'Austin', lat: 30.2099, lng: -97.6806, timezone: 'America/Chicago', resolutionStation: 'KAUS' },
  'MIA': { code: 'MIA', name: 'Miami', lat: 25.7881, lng: -80.3169, timezone: 'America/New_York', resolutionStation: 'KMIA' },

  // Additional major cities — coordinates aligned to Kalshi resolution stations
  'LA': { code: 'LA', name: 'Los Angeles', lat: 33.9382, lng: -118.3870, timezone: 'America/Los_Angeles', resolutionStation: 'KLAX' },
  'LAX': { code: 'LAX', name: 'Los Angeles', lat: 33.9382, lng: -118.3870, timezone: 'America/Los_Angeles', resolutionStation: 'KLAX' },
  'SF': { code: 'SF', name: 'San Francisco', lat: 37.6213, lng: -122.3790, timezone: 'America/Los_Angeles', resolutionStation: 'KSFO' },
  'SFO': { code: 'SFO', name: 'San Francisco', lat: 37.6213, lng: -122.3790, timezone: 'America/Los_Angeles', resolutionStation: 'KSFO' },
  'DAL': { code: 'DAL', name: 'Dallas', lat: 32.8998, lng: -97.0403, timezone: 'America/Chicago', resolutionStation: 'KDFW' },
  'HOU': { code: 'HOU', name: 'Houston', lat: 29.6454, lng: -95.2789, timezone: 'America/Chicago', resolutionStation: 'KHOU' },
  'PHX': { code: 'PHX', name: 'Phoenix', lat: 33.4373, lng: -112.0078, timezone: 'America/Phoenix', resolutionStation: 'KPHX' },
  'SEA': { code: 'SEA', name: 'Seattle', lat: 47.4502, lng: -122.3088, timezone: 'America/Los_Angeles', resolutionStation: 'KSEA' },
  'BOS': { code: 'BOS', name: 'Boston', lat: 42.3656, lng: -71.0096, timezone: 'America/New_York', resolutionStation: 'KBOS' },
  'DEN': { code: 'DEN', name: 'Denver', lat: 39.8466, lng: -104.6560, timezone: 'America/Denver', resolutionStation: 'KDEN' },
  'ATL': { code: 'ATL', name: 'Atlanta', lat: 33.6304, lng: -84.4221, timezone: 'America/New_York', resolutionStation: 'KATL' },
  'PHI': { code: 'PHI', name: 'Philadelphia', lat: 39.8721, lng: -75.2407, timezone: 'America/New_York', resolutionStation: 'KPHL' },
  'PHIL': { code: 'PHIL', name: 'Philadelphia', lat: 39.8721, lng: -75.2407, timezone: 'America/New_York', resolutionStation: 'KPHL' },
  'DC': { code: 'DC', name: 'Washington DC', lat: 38.8512, lng: -77.0402, timezone: 'America/New_York', resolutionStation: 'KDCA' },
  'LV': { code: 'LV', name: 'Las Vegas', lat: 36.0840, lng: -115.1537, timezone: 'America/Los_Angeles', resolutionStation: 'KLAS' },
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
