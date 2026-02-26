/**
 * Generates a direct link to a Kalshi market.
 * @param ticker The market ticker (e.g., KXHIGHMIA-24DEC15-T85)
 * @param eventTicker Optional event ticker. If not provided, it will be extracted from the ticker.
 */
export function getKalshiMarketUrl(ticker: string, eventTicker?: string): string {
  if (!eventTicker) {
    const parts = ticker.split('-')
    eventTicker = parts.length >= 2 ? `${parts[0]}-${parts[1]}` : ticker
  }
  return `https://kalshi.com/markets/${eventTicker}/${ticker}`
}
