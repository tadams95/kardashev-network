// Solar data types for Open-Meteo API responses and internal use

export interface SolarData {
  current: {
    ghi: number        // W/m² Global Horizontal Irradiance
    dni: number        // W/m² Direct Normal Irradiance
    cloudCover: number // 0-100%
    isDay: boolean
  }
  hourly: Array<{
    time: string
    ghi: number
    dni: number
    cloudCover: number
  }>
  location: {
    latitude: number
    longitude: number
    timezone: string
    elevation: number
  }
}

export interface WastedEnergy {
  currentWatts: number
  currentValue: number    // $/hour
  todayValue: number      // $
  monthlyEstimate: number // $
}

export interface Location {
  lat: number
  lng: number
  address?: string
  city?: string
  timezone?: string
}

// Open-Meteo API response types
export interface OpenMeteoResponse {
  latitude: number
  longitude: number
  generationtime_ms: number
  utc_offset_seconds: number
  timezone: string
  timezone_abbreviation: string
  elevation: number
  current_units?: {
    time: string
    interval: string
    shortwave_radiation: string
    direct_normal_irradiance: string
    cloud_cover: string
    is_day: string
  }
  current?: {
    time: string
    interval: number
    shortwave_radiation: number
    direct_normal_irradiance: number
    cloud_cover: number
    is_day: number
  }
  hourly_units?: {
    time: string
    shortwave_radiation: string
    direct_normal_irradiance: string
    cloud_cover: string
  }
  hourly?: {
    time: string[]
    shortwave_radiation: number[]
    direct_normal_irradiance: number[]
    cloud_cover: number[]
  }
}

// API request params
export interface SolarRequestParams {
  lat: number
  lng: number
  hours?: number // Number of forecast hours (default: 24)
}

// API response envelope
export interface SolarApiResponse {
  success: boolean
  data?: SolarData
  error?: string
  cached?: boolean
  timestamp?: number
}
