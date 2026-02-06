// Solar data types for Open-Meteo API responses and internal use

export interface DailyForecast {
  date: string
  weatherCode: number
  weatherDescription: string
  radiationSum: number     // MJ/m²
  estimatedKwh: number     // calculated
  sunrise: string
  sunset: string
}

export interface SolarData {
  current: {
    ghi: number        // W/m² Global Horizontal Irradiance
    dni: number        // W/m² Direct Normal Irradiance
    cloudCover: number // 0-100%
    isDay: boolean
    weatherCode?: number
    weatherDescription?: string
    temperature?: number        // °C
    windSpeed?: number          // m/s
    diffuseRadiation?: number   // W/m² (DHI)
    thermalEfficiency?: number  // 0-100% (calculated: -0.4%/°C above 25°C)
  }
  hourly: Array<{
    time: string
    ghi: number
    dni: number
    cloudCover: number
    diffuseRadiation?: number
  }>
  daily: {
    sunrise: string    // ISO timestamp
    sunset: string     // ISO timestamp
  }
  forecast?: DailyForecast[]
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
    weather_code?: string
    temperature_2m?: string
    wind_speed_10m?: string
    diffuse_radiation?: string
  }
  current?: {
    time: string
    interval: number
    shortwave_radiation: number
    direct_normal_irradiance: number
    cloud_cover: number
    is_day: number
    weather_code?: number
    temperature_2m?: number
    wind_speed_10m?: number
    diffuse_radiation?: number
  }
  hourly_units?: {
    time: string
    shortwave_radiation: string
    direct_normal_irradiance: string
    cloud_cover: string
    diffuse_radiation?: string
  }
  hourly?: {
    time: string[]
    shortwave_radiation: number[]
    direct_normal_irradiance: number[]
    cloud_cover: number[]
    diffuse_radiation?: number[]
  }
  daily_units?: {
    time: string
    sunrise: string
    sunset: string
    weather_code?: string
    shortwave_radiation_sum?: string
  }
  daily?: {
    time: string[]
    sunrise: string[]
    sunset: string[]
    weather_code?: number[]
    shortwave_radiation_sum?: number[]
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
