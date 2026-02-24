import { describe, it, expect } from 'vitest'
import { getWeatherDateKeyFromResolution, getWeatherNoonFromResolution, localDateKey } from '@/lib/utils/weatherDate'
import { formatWeatherDateLabel } from '@/lib/utils/dailyForecasts'

describe('weatherDate utilities', () => {
  it('maps Kalshi resolution time to prior weather date key', () => {
    const resolutionTime = '2026-02-24T14:00:00Z'
    const timezone = 'America/New_York'

    const weatherKey = getWeatherDateKeyFromResolution(resolutionTime, timezone)
    expect(weatherKey).toBe('02/23/2026')
  })

  it('anchors weather day to noon UTC for stable timezone formatting', () => {
    const resolutionTime = '2026-03-10T14:00:00Z'
    const weatherNoon = getWeatherNoonFromResolution(resolutionTime)

    expect(weatherNoon.toISOString()).toBe('2026-03-09T12:00:00.000Z')
  })

  it('returns local date keys timezone-aware', () => {
    const ts = '2026-02-24T03:00:00Z'

    expect(localDateKey(ts, 'America/Los_Angeles')).toBe('02/23/2026')
    expect(localDateKey(ts, 'America/New_York')).toBe('02/23/2026')
    expect(localDateKey(ts, 'UTC')).toBe('02/24/2026')
  })
})

describe('formatWeatherDateLabel', () => {
  it('formats weather date as weekday label for non-today/tomorrow dates', () => {
    const resolutionTime = '2026-02-24T14:00:00Z'
    const label = formatWeatherDateLabel(resolutionTime, 'America/New_York')

    expect(label).toMatch(/^[A-Z][a-z]{2},\s[A-Z][a-z]{2}\s\d{1,2}$/)
  })

  it('is timezone-stable around DST periods', () => {
    // DST transition month in US; this should still map to the prior weather day
    const resolutionTime = '2026-03-09T14:00:00Z'

    const ny = formatWeatherDateLabel(resolutionTime, 'America/New_York')
    const la = formatWeatherDateLabel(resolutionTime, 'America/Los_Angeles')

    expect(ny.endsWith('Mar 8')).toBe(true)
    expect(la.endsWith('Mar 8')).toBe(true)
  })
})
