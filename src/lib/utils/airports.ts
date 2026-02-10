// Airport ICAO code mapping for METAR weather observations
// Maps major US cities to their primary airport ICAO codes

/**
 * Map of city names to ICAO airport codes
 * Covers 50 most populous US cities and major Kalshi weather markets
 */
export const CITY_TO_ICAO: Record<string, string> = {
  // Major trading hubs (Priority 1)
  'New York': 'KJFK',          // John F. Kennedy International Airport
  'New York City': 'KJFK',
  'NYC': 'KJFK',
  'NY': 'KJFK',                // City code alias
  'Manhattan': 'KLGA',         // LaGuardia Airport
  'Chicago': 'KORD',           // O'Hare International Airport
  'CHI': 'KORD',               // City code alias
  'Dallas': 'KDFW',            // Dallas/Fort Worth International Airport
  'DAL': 'KDFW',               // City code alias
  'Los Angeles': 'KLAX',       // Los Angeles International Airport
  'LA': 'KLAX',
  'San Francisco': 'KSFO',     // San Francisco International Airport
  'SF': 'KSFO',
  'Miami': 'KMIA',             // Miami International Airport
  'MIA': 'KMIA',               // City code alias
  'Boston': 'KBOS',            // Logan International Airport
  'BOS': 'KBOS',               // City code alias
  'Seattle': 'KSEA',           // Seattle-Tacoma International Airport
  'SEA': 'KSEA',               // City code alias
  'Las Vegas': 'KLAS',         // Harry Reid International Airport
  'LV': 'KLAS',                // City code alias
  'Phoenix': 'KPHX',           // Phoenix Sky Harbor International Airport
  'PHX': 'KPHX',               // City code alias

  // Major cities (Population rank 11-30)
  'Houston': 'KIAH',           // George Bush Intercontinental Airport
  'HOU': 'KIAH',               // City code alias
  'Philadelphia': 'KPHL',      // Philadelphia International Airport
  'PHI': 'KPHL',               // City code alias
  'San Antonio': 'KSAT',       // San Antonio International Airport
  'San Diego': 'KSAN',         // San Diego International Airport
  'Atlanta': 'KATL',           // Hartsfield-Jackson Atlanta International Airport
  'ATL': 'KATL',               // City code alias
  'Denver': 'KDEN',            // Denver International Airport
  'DEN': 'KDEN',               // City code alias
  'Washington': 'KDCA',        // Ronald Reagan Washington National Airport
  'Washington DC': 'KDCA',
  'DC': 'KDCA',
  'Portland': 'KPDX',          // Portland International Airport
  'Austin': 'KAUS',            // Austin-Bergstrom International Airport
  'AUS': 'KAUS',               // City code alias
  'Nashville': 'KBNA',         // Nashville International Airport
  'Detroit': 'KDTW',           // Detroit Metropolitan Wayne County Airport
  'Minneapolis': 'KMSP',       // Minneapolis-St. Paul International Airport
  'St. Louis': 'KSTL',         // St. Louis Lambert International Airport
  'Tampa': 'KTPA',             // Tampa International Airport
  'Baltimore': 'KBWI',         // Baltimore/Washington International Airport
  'Charlotte': 'KCLT',         // Charlotte Douglas International Airport
  'Orlando': 'KMCO',           // Orlando International Airport
  'Columbus': 'KCMH',          // John Glenn Columbus International Airport

  // Additional major cities (31-50)
  'Indianapolis': 'KIND',      // Indianapolis International Airport
  'San Jose': 'KSJC',          // Norman Y. Mineta San Jose International Airport
  'Jacksonville': 'KJAX',      // Jacksonville International Airport
  'Fort Worth': 'KDFW',        // Dallas/Fort Worth International Airport (shared with Dallas)
  'Sacramento': 'KSAC',        // Sacramento International Airport
  'Kansas City': 'KMCI',       // Kansas City International Airport
  'Milwaukee': 'KMKE',         // Milwaukee Mitchell International Airport
  'Oklahoma City': 'KOKC',     // Will Rogers World Airport
  'Raleigh': 'KRDU',           // Raleigh-Durham International Airport
  'Louisville': 'KSDF',        // Louisville Muhammad Ali International Airport
  'Memphis': 'KMEM',           // Memphis International Airport
  'Richmond': 'KRIC',          // Richmond International Airport
  'New Orleans': 'KMSY',       // Louis Armstrong New Orleans International Airport
  'Salt Lake City': 'KSLC',    // Salt Lake City International Airport
  'Cleveland': 'KCLE',         // Cleveland Hopkins International Airport
  'Pittsburgh': 'KPIT',        // Pittsburgh International Airport
  'Cincinnati': 'KCVG',        // Cincinnati/Northern Kentucky International Airport
  'Albuquerque': 'KABQ',       // Albuquerque International Sunport
  'Tucson': 'KTUS',            // Tucson International Airport
  'Fresno': 'KFAT',            // Fresno Yosemite International Airport
  'Mesa': 'KPHX',              // Phoenix Sky Harbor (serves Mesa area)
  'Omaha': 'KOMA',             // Eppley Airfield
  'Tulsa': 'KTUL',             // Tulsa International Airport
  'Honolulu': 'PHNL',          // Daniel K. Inouye International Airport
  'Anchorage': 'PANC',         // Ted Stevens Anchorage International Airport
}

/**
 * Reverse mapping: ICAO code to primary city name
 */
export const ICAO_TO_CITY: Record<string, string> = {
  'KJFK': 'New York',
  'KLGA': 'New York',
  'KORD': 'Chicago',
  'KDFW': 'Dallas',
  'KLAX': 'Los Angeles',
  'KSFO': 'San Francisco',
  'KMIA': 'Miami',
  'KBOS': 'Boston',
  'KSEA': 'Seattle',
  'KLAS': 'Las Vegas',
  'KPHX': 'Phoenix',
  'KIAH': 'Houston',
  'KPHL': 'Philadelphia',
  'KSAT': 'San Antonio',
  'KSAN': 'San Diego',
  'KATL': 'Atlanta',
  'KDEN': 'Denver',
  'KDCA': 'Washington DC',
  'KPDX': 'Portland',
  'KAUS': 'Austin',
  'KBNA': 'Nashville',
  'KDTW': 'Detroit',
  'KMSP': 'Minneapolis',
  'KSTL': 'St. Louis',
  'KTPA': 'Tampa',
  'KBWI': 'Baltimore',
  'KCLT': 'Charlotte',
  'KMCO': 'Orlando',
  'KCMH': 'Columbus',
  'KIND': 'Indianapolis',
  'KSJC': 'San Jose',
  'KJAX': 'Jacksonville',
  'KSAC': 'Sacramento',
  'KMCI': 'Kansas City',
  'KMKE': 'Milwaukee',
  'KOKC': 'Oklahoma City',
  'KRDU': 'Raleigh',
  'KSDF': 'Louisville',
  'KMEM': 'Memphis',
  'KRIC': 'Richmond',
  'KMSY': 'New Orleans',
  'KSLC': 'Salt Lake City',
  'KCLE': 'Cleveland',
  'KPIT': 'Pittsburgh',
  'KCVG': 'Cincinnati',
  'KABQ': 'Albuquerque',
  'KTUS': 'Tucson',
  'KFAT': 'Fresno',
  'KOMA': 'Omaha',
  'KTUL': 'Tulsa',
  'PHNL': 'Honolulu',
  'PANC': 'Anchorage',
}

/**
 * Airport coordinates for distance calculations
 * Format: { lat, lng, elevation_m }
 */
export const ICAO_COORDINATES: Record<string, { lat: number; lng: number; elevation: number }> = {
  'KJFK': { lat: 40.6413, lng: -73.7781, elevation: 4 },
  'KLGA': { lat: 40.7769, lng: -73.8740, elevation: 7 },
  'KORD': { lat: 41.9742, lng: -87.9073, elevation: 205 },
  'KDFW': { lat: 32.8998, lng: -97.0403, elevation: 183 },
  'KLAX': { lat: 33.9416, lng: -118.4085, elevation: 38 },
  'KSFO': { lat: 37.6213, lng: -122.3790, elevation: 4 },
  'KMIA': { lat: 25.7959, lng: -80.2870, elevation: 3 },
  'KBOS': { lat: 42.3656, lng: -71.0096, elevation: 6 },
  'KSEA': { lat: 47.4502, lng: -122.3088, elevation: 132 },
  'KLAS': { lat: 36.0840, lng: -115.1537, elevation: 664 },
  'KPHX': { lat: 33.4352, lng: -112.0101, elevation: 337 },
  'KIAH': { lat: 29.9902, lng: -95.3368, elevation: 29 },
  'KPHL': { lat: 39.8744, lng: -75.2424, elevation: 11 },
  'KSAT': { lat: 29.5337, lng: -98.4698, elevation: 246 },
  'KSAN': { lat: 32.7338, lng: -117.1933, elevation: 5 },
  'KATL': { lat: 33.6407, lng: -84.4277, elevation: 308 },
  'KDEN': { lat: 39.8561, lng: -104.6737, elevation: 1655 },
  'KDCA': { lat: 38.8512, lng: -77.0402, elevation: 5 },
  'KPDX': { lat: 45.5898, lng: -122.5951, elevation: 9 },
  'KAUS': { lat: 30.1945, lng: -97.6699, elevation: 165 },
  'KBNA': { lat: 36.1263, lng: -86.6789, elevation: 183 },
  'KDTW': { lat: 42.2162, lng: -83.3554, elevation: 197 },
  'KMSP': { lat: 44.8848, lng: -93.2223, elevation: 255 },
  'KSTL': { lat: 38.7487, lng: -90.3700, elevation: 190 },
  'KTPA': { lat: 27.9755, lng: -82.5332, elevation: 8 },
  'KBWI': { lat: 39.1774, lng: -76.6684, elevation: 45 },
  'KCLT': { lat: 35.2140, lng: -80.9473, elevation: 228 },
  'KMCO': { lat: 28.4312, lng: -81.3081, elevation: 29 },
  'KCMH': { lat: 39.9980, lng: -82.8919, elevation: 247 },
  'KIND': { lat: 39.7173, lng: -86.2944, elevation: 244 },
  'KSJC': { lat: 37.3639, lng: -121.9289, elevation: 19 },
  'KJAX': { lat: 30.4941, lng: -81.6879, elevation: 9 },
  'KSAC': { lat: 38.6954, lng: -121.5901, elevation: 8 },
  'KMCI': { lat: 39.2976, lng: -94.7139, elevation: 313 },
  'KMKE': { lat: 42.9472, lng: -87.8966, elevation: 218 },
  'KOKC': { lat: 35.3931, lng: -97.6007, elevation: 396 },
  'KRDU': { lat: 35.8801, lng: -78.7880, elevation: 134 },
  'KSDF': { lat: 38.1744, lng: -85.7364, elevation: 149 },
  'KMEM': { lat: 35.0424, lng: -89.9767, elevation: 101 },
  'KRIC': { lat: 37.5052, lng: -77.3197, elevation: 50 },
  'KMSY': { lat: 29.9934, lng: -90.2580, elevation: 1 },
  'KSLC': { lat: 40.7899, lng: -111.9791, elevation: 1288 },
  'KCLE': { lat: 41.4117, lng: -81.8498, elevation: 237 },
  'KPIT': { lat: 40.4915, lng: -80.2329, elevation: 367 },
  'KCVG': { lat: 39.0533, lng: -84.6630, elevation: 271 },
  'KABQ': { lat: 35.0402, lng: -106.6090, elevation: 1631 },
  'KTUS': { lat: 32.1161, lng: -110.9410, elevation: 779 },
  'KFAT': { lat: 36.7762, lng: -119.7181, elevation: 102 },
  'KOMA': { lat: 41.3032, lng: -95.8941, elevation: 299 },
  'KTUL': { lat: 36.1984, lng: -95.8881, elevation: 206 },
  'PHNL': { lat: 21.3187, lng: -157.9225, elevation: 4 },
  'PANC': { lat: 61.1744, lng: -149.9962, elevation: 46 },
}

/**
 * Get ICAO code for a given city name
 * Case-insensitive matching
 *
 * @param city - City name (e.g., "Dallas", "New York", "SF")
 * @returns ICAO code or null if not found
 */
export function getICAOForCity(city: string): string | null {
  const normalized = city.trim()

  // Try exact match first
  if (CITY_TO_ICAO[normalized]) {
    return CITY_TO_ICAO[normalized]
  }

  // Try case-insensitive match
  const lowerCity = normalized.toLowerCase()
  const matchedKey = Object.keys(CITY_TO_ICAO).find(
    key => key.toLowerCase() === lowerCity
  )

  return matchedKey ? CITY_TO_ICAO[matchedKey] : null
}

/**
 * Get city name for a given ICAO code
 *
 * @param icaoCode - ICAO airport code (e.g., "KDFW", "KJFK")
 * @returns City name or null if not found
 */
export function getCityForICAO(icaoCode: string): string | null {
  const normalized = icaoCode.trim().toUpperCase()
  return ICAO_TO_CITY[normalized] || null
}

/**
 * Get coordinates for a given ICAO code
 *
 * @param icaoCode - ICAO airport code
 * @returns Coordinates object or null if not found
 */
export function getCoordinatesForICAO(icaoCode: string): { lat: number; lng: number; elevation: number } | null {
  const normalized = icaoCode.trim().toUpperCase()
  return ICAO_COORDINATES[normalized] || null
}

/**
 * Get all supported cities
 *
 * @returns Array of city names
 */
export function getSupportedCities(): string[] {
  // Return only primary city names (no aliases)
  return Array.from(new Set(Object.values(ICAO_TO_CITY))).sort()
}

/**
 * Get all supported ICAO codes
 *
 * @returns Array of ICAO codes
 */
export function getSupportedICAOs(): string[] {
  return Object.keys(ICAO_TO_CITY).sort()
}

/**
 * Check if a city is supported
 *
 * @param city - City name
 * @returns true if city has ICAO mapping
 */
export function isCitySupported(city: string): boolean {
  return getICAOForCity(city) !== null
}

/**
 * Haversine distance calculation between two coordinates
 *
 * @param lat1 - Latitude of first point
 * @param lng1 - Longitude of first point
 * @param lat2 - Latitude of second point
 * @param lng2 - Longitude of second point
 * @returns Distance in kilometers
 */
function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371 // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

/**
 * Find nearest airport to given coordinates
 * Deferred to Week 2 - placeholder implementation
 *
 * @param lat - Latitude
 * @param lng - Longitude
 * @param maxDistanceKm - Maximum distance to consider (default: 100km)
 * @returns Nearest ICAO code or null if none within range
 */
export function getNearestAirport(lat: number, lng: number, maxDistanceKm = 100): string | null {
  let nearestICAO: string | null = null
  let minDistance = maxDistanceKm

  for (const [icao, coords] of Object.entries(ICAO_COORDINATES)) {
    const distance = haversineDistance(lat, lng, coords.lat, coords.lng)
    if (distance < minDistance) {
      minDistance = distance
      nearestICAO = icao
    }
  }

  return nearestICAO
}

/**
 * Get airport info (ICAO, city, coordinates) for a location
 * Tries exact city match first, falls back to nearest airport
 *
 * @param params - Either { city: string } or { lat: number, lng: number }
 * @returns Airport info or null if not found
 */
export function getAirportInfo(params: { city: string } | { lat: number; lng: number }): {
  icao: string
  city: string
  coordinates: { lat: number; lng: number; elevation: number }
} | null {
  if ('city' in params) {
    const icao = getICAOForCity(params.city)
    if (!icao) return null

    const city = getCityForICAO(icao)
    const coordinates = getCoordinatesForICAO(icao)

    if (!city || !coordinates) return null

    return { icao, city, coordinates }
  } else {
    const icao = getNearestAirport(params.lat, params.lng)
    if (!icao) return null

    const city = getCityForICAO(icao)
    const coordinates = getCoordinatesForICAO(icao)

    if (!city || !coordinates) return null

    return { icao, city, coordinates }
  }
}
