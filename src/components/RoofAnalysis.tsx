// Roof analysis display component using Google Solar API data

import type { RoofSummary } from '@/types/googleSolar'
import CountUp from 'react-countup'

interface RoofAnalysisProps {
  roofSummary: RoofSummary
}

export default function RoofAnalysis({ roofSummary }: RoofAnalysisProps) {
  const {
    totalAreaM2,
    usableAreaM2,
    maxPanels,
    panelCount,
    yearlyEnergyKwh,
    yearlySavings,
    carbonOffsetKg,
    coveragePercent,
    maxYearlyEnergyKwh,
    maxYearlySavings,
    electricityRate,
    segments,
    imageryDate,
    quality,
  } = roofSummary

  const showMaxReference = panelCount < maxPanels
  const recommendedMwh = (yearlyEnergyKwh / 1000).toFixed(1)
  const maxMwh = (maxYearlyEnergyKwh / 1000).toFixed(1)
  const showMaxEnergy = showMaxReference && recommendedMwh !== maxMwh

  // Get best segment (most panels)
  const bestSegment = segments.reduce((best, seg) =>
    seg.panelCount > best.panelCount ? seg : best
  , segments[0])

  return (
    <div className="space-y-4">
      {/* Header with data source badge */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-gray-300">Your Roof Analysis</h2>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-500 uppercase tracking-wide">
            Google Solar
          </span>
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide ${
            quality === 'HIGH'
              ? 'bg-amber-600/10 text-amber-500 border border-amber-600/20'
              : quality === 'MEDIUM'
                ? 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20'
                : 'bg-gray-500/10 text-gray-400 border border-gray-500/20'
          }`}>
            {quality}
          </span>
        </div>
      </div>

      {/* Main stats grid */}
      <div className="grid grid-cols-2 gap-3">
        {/* Usable Roof Area */}
        <div className="bg-gray-800/40 rounded-lg p-3">
          <div className="text-xs text-gray-500 mb-1">Usable Roof</div>
          <div className="text-lg font-semibold text-white">
            <CountUp end={Math.round(usableAreaM2)} duration={1} preserveValue />
            <span className="text-sm font-normal text-gray-400"> m²</span>
          </div>
          <div className="text-[11px] text-gray-500">
            of {Math.round(totalAreaM2)} m² total
          </div>
        </div>

        {/* Panels */}
        <div className="bg-gray-800/40 rounded-lg p-3">
          <div className="text-xs text-gray-500 mb-1">Panels</div>
          <div className="text-lg font-semibold text-white">
            <CountUp end={panelCount} duration={1} preserveValue />
          </div>
          <div className="text-[11px] text-gray-500">
            {showMaxReference ? `of ${maxPanels} max` : 'optimal placement'}
          </div>
        </div>

        {/* Yearly Energy */}
        <div className="bg-gray-800/40 rounded-lg p-3">
          <div className="text-xs text-gray-500 mb-1">Yearly Output</div>
          <div className="text-lg font-semibold text-yellow-400">
            <CountUp end={parseFloat(recommendedMwh)} decimals={1} duration={1} preserveValue />
            <span className="text-sm font-normal text-gray-400"> MWh</span>
          </div>
          <div className="text-[11px] text-gray-500">
            {showMaxEnergy ? `up to ${maxMwh} MWh max` : 'potential generation'}
          </div>
        </div>

        {/* Yearly Savings */}
        <div className="bg-gray-800/40 rounded-lg p-3">
          <div className="text-xs text-gray-500 mb-1">Yearly Savings</div>
          <div className="text-lg font-semibold text-amber-500">
            $<CountUp end={Math.round(yearlySavings)} separator="," duration={1} preserveValue />
          </div>
          <div className="text-[11px] text-gray-500">
            at ${electricityRate.toFixed(2)}/kWh
          </div>
        </div>
      </div>

      {/* Recommended sizing note */}
      {showMaxReference && (
        <div className="text-[11px] text-gray-500 bg-gray-800/20 rounded-lg px-3 py-2">
          {coveragePercent >= 90
            ? 'Sized to offset ~100% of avg US household usage (10,500 kWh/yr).'
            : `Covers ~${coveragePercent}% of avg US household usage (10,500 kWh/yr).`}
          {' '}Max capacity with {maxPanels} panels: ${Math.round(maxYearlySavings).toLocaleString()}/yr.
        </div>
      )}

      {/* Best segment highlight */}
      {bestSegment && bestSegment.panelCount > 0 && (
        <div className="bg-gradient-to-r from-amber-900/20 to-amber-900/20 border border-amber-800/30 rounded-lg p-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-amber-500 font-medium">Best Roof Section</div>
              <div className="text-sm text-white mt-0.5">
                {bestSegment.azimuth}-facing • {Math.round(bestSegment.pitch)}° pitch
              </div>
            </div>
            <div className="text-right">
              <div className="text-lg font-semibold text-white">{bestSegment.panelCount}</div>
              <div className="text-[11px] text-gray-400">panels</div>
            </div>
          </div>
        </div>
      )}

      {/* Carbon offset */}
      <div className="flex items-center justify-between py-2 border-t border-gray-800/50">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-amber-600/10 flex items-center justify-center">
            <svg className="w-3.5 h-3.5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <span className="text-sm text-gray-400">Carbon offset</span>
        </div>
        <span className="text-sm font-medium text-white">
          {(carbonOffsetKg / 1000).toFixed(1)} tons CO₂/year
        </span>
      </div>

      {/* Footer */}
      <div className="text-[10px] text-gray-600 text-center">
        Imagery from {imageryDate} • Data powered by Google Solar API
      </div>
    </div>
  )
}

export function RoofAnalysisSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-4 w-32 bg-gray-700/50 rounded" />
        <div className="h-4 w-20 bg-gray-700/50 rounded" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-gray-800/40 rounded-lg p-3">
            <div className="h-3 w-16 bg-gray-700/50 rounded mb-2" />
            <div className="h-6 w-20 bg-gray-700/50 rounded" />
          </div>
        ))}
      </div>
      <div className="h-16 bg-gray-800/40 rounded-lg" />
    </div>
  )
}

// Compact version for inline display
export function RoofAnalysisCompact({ roofSummary }: RoofAnalysisProps) {
  return (
    <div className="flex items-center gap-4 text-sm">
      <div>
        <span className="text-gray-400">Roof: </span>
        <span className="text-white font-medium">{Math.round(roofSummary.usableAreaM2)} m²</span>
      </div>
      <div className="text-gray-600">•</div>
      <div>
        <span className="text-gray-400">Panels: </span>
        <span className="text-white font-medium">{roofSummary.panelCount}</span>
      </div>
      <div className="text-gray-600">•</div>
      <div>
        <span className="text-gray-400">Potential: </span>
        <span className="text-amber-500 font-medium">${Math.round(roofSummary.yearlySavings).toLocaleString()}/yr</span>
      </div>
    </div>
  )
}
