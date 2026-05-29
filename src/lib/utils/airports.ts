// Airport ICAO code mapping for METAR weather observations
// Maps major US cities to their primary airport ICAO codes

/**
 * Map of city names to ICAO airport codes
 * Covers 50 most populous US cities and major Kalshi weather markets
 */
const CITY_TO_ICAO: Record<string, string> = {
  // Major trading hubs (Priority 1)
  // NYC: KNYC (Central Park) is the Kalshi resolution station.
  // KNYC may have limited METAR — fallback to KLGA (LaGuardia, ~6km) rather than KJFK (~22km).
  'New York': 'KLGA',          // LaGuardia (closest METAR to Central Park KNYC)
  'New York City': 'KLGA',
  'NYC': 'KLGA',
  'NY': 'KLGA',                // City code alias
  'Manhattan': 'KLGA',         // LaGuardia Airport
  'Chicago': 'KORD',           // O'Hare International Airport
  'CHI': 'KMDW',               // Midway — Kalshi resolution station
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
  'Houston': 'KHOU',           // Hobby Airport — Kalshi resolution station
  'HOU': 'KHOU',               // City code alias
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
const ICAO_TO_CITY: Record<string, string> = {
  'KNYC': 'New York',          // Central Park — Kalshi resolution station
  'KJFK': 'New York',
  'KLGA': 'New York',
  'KORD': 'Chicago',
  'KMDW': 'Chicago',           // Midway — Kalshi resolution station
  'KDFW': 'Dallas',
  'KDAL': 'Dallas',            // Love Field
  'KLAX': 'Los Angeles',
  'KSFO': 'San Francisco',
  'KMIA': 'Miami',
  'KBOS': 'Boston',
  'KSEA': 'Seattle',
  'KLAS': 'Las Vegas',
  'KPHX': 'Phoenix',
  'KHOU': 'Houston',           // Hobby — Kalshi resolution station
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
