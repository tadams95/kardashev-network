export function localDateKey(timestamp: string | number, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(timestamp))
}

/**
 * Markets resolve the morning AFTER the weather day in UTC.
 * Subtract one UTC day and anchor to noon UTC so US timezone formatting is stable.
 */
export function getWeatherNoonFromResolution(resolutionTime: string): Date {
  const resolution = new Date(resolutionTime)
  resolution.setUTCDate(resolution.getUTCDate() - 1)
  const weatherDateStr = resolution.toISOString().slice(0, 10)
  return new Date(`${weatherDateStr}T12:00:00Z`)
}

export function getWeatherDateKeyFromResolution(resolutionTime: string, timezone: string): string {
  return localDateKey(getWeatherNoonFromResolution(resolutionTime).getTime(), timezone)
}
