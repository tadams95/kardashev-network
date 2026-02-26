// Shared timezone-aware day label formatting
// Used by ForecastCards and TemperatureGraph for consistent "Today"/"Tomorrow"/weekday labels

import { localDateKey } from '@/lib/utils/weatherDate'

/**
 * Format a timestamp as a day label ("Today", "Tomorrow", "Mon", "Tue", etc.)
 * in the given IANA timezone. Uses localDateKey for date comparison — same
 * function used by ensembleDateFilter and formatWeatherDateLabel.
 */
export function formatDayLabel(timestamp: string | number, timezone: string): string {
  const date = new Date(timestamp)
  const dateKey = localDateKey(timestamp, timezone)
  const todayKey = localDateKey(Date.now(), timezone)

  if (dateKey === todayKey) return 'Today'

  const tomorrowKey = localDateKey(Date.now() + 24 * 60 * 60 * 1000, timezone)
  if (dateKey === tomorrowKey) return 'Tomorrow'

  return new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(date)
}
