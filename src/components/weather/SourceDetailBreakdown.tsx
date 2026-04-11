// Per-source atmospheric variable breakdown
// Collapsible secondary view showing every Phase 1 / Phase 2a atmospheric
// field per source for the currently-viewed city. Rendered below the main
// hero grid as a power-user detail view — not on the primary display by
// default. Surfaces variables that flow through WeatherForecast but have
// no dedicated slot on the hero card / hourly / 7-day components.

import { useMemo, useState } from 'react'
import type { WeatherForecast } from '@/types/weather'
import { celsiusToFahrenheit } from '@/lib/utils/temperature'

interface SourceDetailBreakdownProps {
  forecasts: WeatherForecast[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Pick one representative forecast per source for a "now" snapshot. Prefers
 * the most recent past/current entry (mirrors the hero card's convention);
 * falls back to the earliest future entry if no past entry exists for a
 * source. METAR collapses to its single observation naturally.
 */
function pickRepresentativePerSource(
  forecasts: WeatherForecast[]
): Map<string, WeatherForecast> {
  const now = Date.now()
  const bySource = new Map<string, WeatherForecast[]>()
  for (const f of forecasts) {
    if (!bySource.has(f.source)) bySource.set(f.source, [])
    bySource.get(f.source)!.push(f)
  }

  const result = new Map<string, WeatherForecast>()
  for (const [source, entries] of bySource) {
    const past = entries
      .filter(f => new Date(f.timestamp).getTime() <= now)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    if (past.length > 0) {
      result.set(source, past[0])
      continue
    }
    const future = [...entries].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    )
    if (future.length > 0) result.set(source, future[0])
  }
  return result
}

function fmtNum(value: number | null | undefined, digits = 0): string {
  if (value == null || typeof value !== 'number' || isNaN(value)) return '—'
  return value.toFixed(digits)
}

function fmtF(celsius: number | null | undefined, digits = 0): string {
  if (celsius == null || typeof celsius !== 'number' || isNaN(celsius)) return '—'
  return `${celsiusToFahrenheit(celsius).toFixed(digits)}°`
}

// Source display order + pretty labels (matches hero card source-weight legend)
const SOURCE_ORDER: WeatherForecast['source'][] = [
  'NWS',
  'Open-Meteo',
  'AccuWeather',
  'Tomorrow.io',
  'Google-Weather',
  'METAR',
]

const SOURCE_LABEL: Record<WeatherForecast['source'], string> = {
  'NWS': 'NWS',
  'Open-Meteo': 'Open-Meteo',
  'AccuWeather': 'AccuWeather',
  'Tomorrow.io': 'Tomorrow.io',
  'Google-Weather': 'Google',
  'METAR': 'METAR',
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SourceDetailBreakdown({ forecasts }: SourceDetailBreakdownProps) {
  const [isOpen, setIsOpen] = useState(false)

  const representative = useMemo(
    () => pickRepresentativePerSource(forecasts ?? []),
    [forecasts]
  )

  // Keep display order stable; filter to sources that actually appear
  const sourcesToShow = SOURCE_ORDER.filter(s => representative.has(s))

  if (!forecasts || forecasts.length === 0 || sourcesToShow.length === 0) {
    return null
  }

  return (
    <div className="bg-black/40 border border-gray-700/50 rounded-xl overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-white/[0.02] transition-colors"
        aria-expanded={isOpen}
      >
        <div>
          <h3 className="text-sm font-semibold text-white">Source Detail Breakdown</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Full atmospheric variables per source · {sourcesToShow.length} source{sourcesToShow.length === 1 ? '' : 's'}
          </p>
        </div>
        <span className="text-xs text-gray-400">{isOpen ? '\u25B2 Hide' : '\u25BC Show'}</span>
      </button>

      {isOpen && (
        <div className="border-t border-gray-700/50 overflow-x-auto">
          <table className="w-full text-xs min-w-[900px]">
            <thead className="bg-black/60 text-gray-400 uppercase tracking-wide text-[10px]">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Source</th>
                <th className="px-2 py-2 text-right font-medium">Temp</th>
                <th className="px-2 py-2 text-right font-medium">Feels</th>
                <th className="px-2 py-2 text-right font-medium">Dew Pt</th>
                <th className="px-2 py-2 text-right font-medium">Humid.</th>
                <th className="px-2 py-2 text-right font-medium">Press.</th>
                <th className="px-2 py-2 text-right font-medium">Cloud</th>
                <th className="px-2 py-2 text-right font-medium" title="Cloud low / mid / high">Lo/Mi/Hi</th>
                <th className="px-2 py-2 text-right font-medium">UV</th>
                <th className="px-2 py-2 text-right font-medium">Wind</th>
                <th className="px-2 py-2 text-right font-medium">Gust</th>
                <th className="px-2 py-2 text-right font-medium">Dir</th>
                <th className="px-2 py-2 text-right font-medium">Visib.</th>
              </tr>
            </thead>
            <tbody className="text-gray-300">
              {sourcesToShow.map(source => {
                const f = representative.get(source)!
                const layers = [f.cloudCoverLow, f.cloudCoverMid, f.cloudCoverHigh]
                const hasLayers = layers.some(v => v != null)
                return (
                  <tr key={source} className="border-t border-gray-800/60 hover:bg-white/[0.02]">
                    <td className="px-3 py-2 text-left font-medium text-gray-200">
                      {SOURCE_LABEL[source]}
                    </td>
                    <td className="px-2 py-2 text-right">{fmtF(f.temperature.current)}</td>
                    <td className="px-2 py-2 text-right">{fmtF(f.temperature.apparent)}</td>
                    <td className="px-2 py-2 text-right">{fmtF(f.dewPoint)}</td>
                    <td className="px-2 py-2 text-right">{fmtNum(f.humidity)}{f.humidity != null ? '%' : ''}</td>
                    <td className="px-2 py-2 text-right">{f.pressure != null ? `${fmtNum(f.pressure, 0)} hPa` : '—'}</td>
                    <td className="px-2 py-2 text-right">{fmtNum(f.cloudCover)}{f.cloudCover != null ? '%' : ''}</td>
                    <td className="px-2 py-2 text-right text-[10px] text-gray-400">
                      {hasLayers
                        ? `${fmtNum(layers[0])}/${fmtNum(layers[1])}/${fmtNum(layers[2])}`
                        : '—'}
                    </td>
                    <td className="px-2 py-2 text-right">{fmtNum(f.uvIndex, 1)}</td>
                    <td className="px-2 py-2 text-right">{f.windSpeed != null ? `${fmtNum(f.windSpeed)} mph` : '—'}</td>
                    <td className="px-2 py-2 text-right">{f.windGust != null ? `${fmtNum(f.windGust)} mph` : '—'}</td>
                    <td className="px-2 py-2 text-right">{f.windDirection != null ? `${fmtNum(f.windDirection)}°` : '—'}</td>
                    <td className="px-2 py-2 text-right">{f.visibility != null ? `${fmtNum(f.visibility, 1)} mi` : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="px-4 py-2 text-[10px] text-gray-500 border-t border-gray-800/60 bg-black/30">
            Representative snapshot per source (most recent past entry). Temperatures in °F · Pressure in hPa · Wind in mph · Visibility in miles · Dew point in °F · Cloud layers: low/mid/high (Open-Meteo only)
          </div>
        </div>
      )}
    </div>
  )
}
