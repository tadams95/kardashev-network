// Weather data types for weather trading system
// Supports Open-Meteo, Google Weather API, and METAR data sources

import type { Location } from './solar'

// ============================================================================
// Raw API Response Types
// ============================================================================

// Google Weather API response structure
export interface GoogleWeatherResponse {
  location: {
    latitude: number
    longitude: number
  }
  current?: {
    time: string
    values: {
      temperature: number
      temperatureApparent: number
      precipitationProbability: number
      precipitationIntensity: number
      weatherCode: number
      cloudCover: number
      humidity: number
      windSpeed: number
      windDirection: number
      visibility: number
      uvIndex: number
    }
  }
  hourlyForecasts?: Array<{
    time: string
    values: {
      temperature: number
      temperatureApparent: number
      precipitationProbability: number
      precipitationIntensity: number
      precipitationAmount?: number
      weatherCode: number
      cloudCover: number
      humidity: number
      windSpeed: number
    }
  }>
  dailyForecasts?: Array<{
    date: string
    values: {
      temperatureMin: number
      temperatureMax: number
      temperatureAvg: number
      precipitationProbabilityAvg: number
      precipitationProbabilityMax: number
      precipitationAmountSum: number
      weatherCodeMax: number
      weatherCodeMin: number
    }
  }>
}

// METAR (Aviation Weather) response structure
export interface METARResponse {
  id: string
  icaoId: string
  receiptTime: string
  obsTime: number
  reportTime: string
  temp: number | null
  dewp: number | null
  wdir: number | null
  wspd: number | null
  wgst: number | null
  visib: string | null
  altim: number | null
  slp: number | null
  qcField: number
  wxString: string | null
  presTend: string | null
  maxT: number | null
  minT: number | null
  maxT24: number | null
  minT24: number | null
  precip: number | null
  pcp3hr: number | null
  pcp6hr: number | null
  pcp24hr: number | null
  snow: number | null
  vertVis: number | null
  metarType: string
  rawOb: string
  mostRecent: number
  lat: number
  lon: number
  elev: number
  prior: number
  name: string
  clouds?: Array<{
    cover: string
    base: number
  }>
}

// Open-Meteo weather forecast extensions (beyond existing solar data)
export interface OpenMeteoWeatherResponse {
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
    temperature_2m: string
    precipitation: string
    precipitation_probability?: string
    weather_code: string
  }
  current?: {
    time: string
    interval: number
    temperature_2m: number
    precipitation: number
    precipitation_probability?: number
    weather_code: number
  }
  hourly_units?: {
    time: string
    temperature_2m: string
    precipitation_probability: string
    precipitation: string
    weather_code: string
  }
  hourly?: {
    time: string[]
    temperature_2m: number[]
    precipitation_probability: number[]
    precipitation: number[]
    weather_code: number[]
  }
  daily_units?: {
    time: string
    temperature_2m_max: string
    temperature_2m_min: string
    precipitation_sum: string
    precipitation_probability_max: string
    weather_code: string
  }
  daily?: {
    time: string[]
    temperature_2m_max: number[]
    temperature_2m_min: number[]
    precipitation_sum: number[]
    precipitation_probability_max: number[]
    weather_code: number[]
  }
}

// ============================================================================
// Normalized Forecast Structure
// ============================================================================

export interface WeatherForecast {
  location: {
    lat: number
    lng: number
    city?: string
    timezone?: string
  }
  timestamp: string  // ISO timestamp
  temperature: {
    current: number  // °C or °F
    min: number      // Daily min
    max: number      // Daily max
    apparent?: number // Feels-like temperature
  }
  precipitation: {
    probability: number  // 0-1 (0% to 100%)
    amount: number       // mm or inches
    intensity?: number   // mm/hr
  }
  conditions: string  // Human-readable description
  weatherCode?: number  // WMO or provider-specific code
  cloudCover?: number  // 0-100%
  humidity?: number    // 0-100%
  windSpeed?: number   // mph (normalized from source units)
  windDirection?: number  // degrees
  visibility?: number  // km or miles
  source: 'Open-Meteo' | 'Google-Weather' | 'METAR' | 'NWS'
  dataAge: number      // milliseconds since observation
  confidence: number   // 0-100 (source reliability score)
  raw?: string         // Original raw data for debugging
}

// ============================================================================
// Multi-Source Ensemble
// ============================================================================

export interface WeatherEnsemble {
  location: {
    lat: number
    lng: number
    city?: string
    timezone?: string
  }
  forecasts: WeatherForecast[]  // All source forecasts
  consensus: {
    temperatureRange: [number, number]  // [min, max] from all sources
    temperatureMean: number             // Weighted average
    precipProbability: number           // Weighted 0-1
    modelAgreement: number              // 0-100% (how much sources agree)
    dataQuality: number                 // 0-100% (freshness + confidence)
  }
  sources: string[]  // List of sources used
  timestamp: number  // When ensemble was created
  hoursToResolution?: number  // Hours until market resolves (for trading)
}

// ============================================================================
// Market Probability Calculation
// ============================================================================

export interface WeatherProbability {
  outcome: string      // "temperature > 95°F", "rain > 0.1in"
  probability: number  // 0-1 (model's calculated probability)
  confidence: number   // 0-100 (how confident in this probability)
  edge?: number        // Difference from market price (if available)
  expectedValue?: number  // Expected profit/loss
  sources: WeatherForecast[]  // Underlying forecasts
  calculatedAt: number  // Timestamp
  reasoning?: string    // Human-readable explanation
}

// ============================================================================
// Market Data (for trading integration)
// ============================================================================

export interface WeatherMarket {
  id: string
  platform: 'Kalshi' | 'Polymarket'
  question: string
  outcome: string      // What we're predicting
  threshold: number    // Temperature/precipitation threshold
  capStrike?: number   // Upper bound for 'between' brackets
  direction?: 'above' | 'below' | 'between'  // For temperature thresholds
  temperatureType?: 'high' | 'low'  // HIGH vs LOW temperature markets
  eventTicker?: string // Kalshi event_ticker for grouping
  location: {
    lat: number
    lng: number
    city: string
  }
  resolutionTime: string  // ISO timestamp
  currentPrice?: number   // Market's current probability (0-1)
  volume?: number         // Total trading volume
  liquidity?: number      // Available liquidity
  yesAsk?: number         // Best ask for YES (0-1)
  yesBid?: number         // Best bid for YES (0-1)
  spread?: number         // Ask - Bid (0-1)
  result?: 'yes' | 'no'  // Settlement result from Kalshi (only on resolved markets)
  status: 'active' | 'resolved' | 'canceled'
}

export interface WeatherTrade {
  market: WeatherMarket
  modelProbability: number
  marketPrice: number
  edge: number
  expectedValue: number
  positionSize: number  // Dollar amount
  direction: 'YES' | 'NO'
  ensemble: WeatherEnsemble
  executedAt?: number
  result?: 'win' | 'loss' | 'canceled'
  actualProfit?: number
}

// ============================================================================
// API Request/Response Envelopes
// ============================================================================

export interface WeatherForecastParams {
  lat: number
  lng: number
  hours?: number     // Forecast horizon (default: 168 = 7 days)
  city?: string      // Optional city name for METAR lookup
}

export interface WeatherApiResponse {
  success: boolean
  data?: WeatherEnsemble
  error?: string
  cached?: boolean
  timestamp?: number
}

export interface WeatherProbabilityApiResponse {
  success: boolean
  data?: WeatherProbability
  error?: string
  cached?: boolean
  timestamp?: number
}

// ============================================================================
// Data Quality Metadata
// ============================================================================

export interface DataQualityMetrics {
  source: 'Open-Meteo' | 'Google-Weather' | 'METAR' | 'NWS'
  timestamp: number
  dataAge: number        // milliseconds since observation
  revision?: number      // Track retroactive corrections
  confidence: 'high' | 'medium' | 'low'
  stale: boolean         // true if data is >6 hours old
  reliability: number    // 0-100 based on historical accuracy
}

// ============================================================================
// Utility Types
// ============================================================================

export interface ForecastOptions {
  bypassCache?: boolean
  premium?: boolean  // For future premium data sources
  sources?: Array<'Open-Meteo' | 'Google-Weather' | 'METAR' | 'NWS'>  // Filter sources
}

export interface EnsembleWeights {
  'Open-Meteo': number      // 0.25 default
  'Google-Weather': number  // 0.20 default
  'METAR': number           // 0.20 default
  'NWS'?: number            // 0.35 default (resolution-aligned source)
  [key: string]: number | undefined  // Allow dynamic source names
}

// Trading-specific types
export interface CircuitBreakerStatus {
  paused: boolean
  reason?: string
  pausedAt?: number
  tradesLast5Min: number
  tradesLast1Hour: number
  recentWinRate?: number
}

export interface BacktestResult {
  marketId: string
  date: string
  modelProbability: number
  marketPrice: number
  edge: number
  outcome: boolean  // true if won
  profit: number
  fees: number
  netProfit: number
}
