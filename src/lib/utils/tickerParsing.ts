// Shared ticker parsing utilities for Kalshi weather markets
// Extracts city codes from market/event tickers like "KXHIGHTATL-26MAR04-B77.5"

import { CITY_COORDS } from './cityCoordinates'

// Pre-sorted by descending length to prevent substring collisions
// e.g. "DAL" (3) checked before "LA" (2), "NYC" before "NY"
const SORTED_CITY_CODES = Object.keys(CITY_COORDS).sort((a, b) => b.length - a.length)

/**
 * Extract the city code from a Kalshi ticker string.
 * Sorts city codes by descending length to avoid substring collisions.
 */
export function extractCityCode(ticker: string): string | null {
  const upper = ticker.toUpperCase()
  for (const code of SORTED_CITY_CODES) {
    if (upper.includes(code)) return code
  }
  return null
}

/**
 * Extract the market type (high/low) from a Kalshi ticker string.
 * Uses prefix match to avoid false positives on hypothetical tickers.
 * Works on event tickers (KXLOWNY-26MAR07) and market tickers (KXLOWNY-26MAR07-B60).
 */
export function extractMarketType(ticker: string): 'high' | 'low' {
  return /^KXLOW/i.test(ticker) ? 'low' : 'high'
}
