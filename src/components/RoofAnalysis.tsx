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
      {/* Header with data source badge. Imagery date inlined per plan §3.7
          to free the footer row (was a full-line attribution that never
          changes user behavior). */}
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-body font-medium text-gray-300">Your Roof Analysis</h2>
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-micro text-gray-500 uppercase tracking-wide truncate">
            Google Solar · {imageryDate}
          </span>
          <span className={`p-chip rounded-chip text-micro font-medium uppercase tracking-wide flex-shrink-0 ${
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

      {/* Best segment highlight — promoted to the top per plan §3.7. This
          is the single most actionable insight in the component ("put
          panels here"); it deserves to land before the wall of numbers. */}
      {bestSegment && bestSegment.panelCount > 0 && (
        <div className="bg-gradient-to-r from-amber-900/20 to-amber-900/20 border border-amber-800/30 rounded-inner p-card-sm">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-caption text-amber-500 font-medium">Best Roof Section</div>
              <div className="text-body text-white mt-0.5">
                {bestSegment.azimuth}-facing • {Math.round(bestSegment.pitch)}° pitch
              </div>
            </div>
            <div className="text-right">
              <div className="text-title font-semibold text-white">{bestSegment.panelCount}</div>
              <div className="text-caption text-gray-400">panels</div>
            </div>
          </div>
        </div>
      )}

      {/* Main stats grid */}
      <div className="grid grid-cols-2 gap-3">
        {/* Usable Roof Area */}
        <div className="bg-gray-800/40 rounded-inner p-card-sm">
          <div className="text-caption text-gray-500 mb-1">Usable Roof</div>
          <div className="text-title font-semibold text-white">
            <CountUp end={Math.round(usableAreaM2)} duration={1} preserveValue />
            <span className="text-body font-normal text-gray-400"> m²</span>
          </div>
          <div className="text-caption text-gray-500">
            of {Math.round(totalAreaM2)} m² total
          </div>
        </div>

        {/* Panels */}
        <div className="bg-gray-800/40 rounded-inner p-card-sm">
          <div className="text-caption text-gray-500 mb-1">Panels</div>
          <div className="text-title font-semibold text-white">
            <CountUp end={panelCount} duration={1} preserveValue />
          </div>
          <div className="text-caption text-gray-500">
            {showMaxReference ? `of ${maxPanels} max` : 'optimal placement'}
          </div>
        </div>

        {/* Yearly Energy */}
        <div className="bg-gray-800/40 rounded-inner p-card-sm">
          <div className="text-caption text-gray-500 mb-1">Yearly Output</div>
          <div className="text-title font-semibold text-yellow-400">
            <CountUp end={parseFloat(recommendedMwh)} decimals={1} duration={1} preserveValue />
            <span className="text-body font-normal text-gray-400"> MWh</span>
          </div>
          <div className="text-caption text-gray-500">
            {showMaxEnergy ? `up to ${maxMwh} MWh max` : 'potential generation'}
          </div>
        </div>

        {/* Yearly Savings */}
        <div className="bg-gray-800/40 rounded-inner p-card-sm">
          <div className="text-caption text-gray-500 mb-1">Yearly Savings</div>
          <div className="text-title font-semibold text-amber-500">
            $<CountUp end={Math.round(yearlySavings)} separator="," duration={1} preserveValue />
          </div>
          <div className="text-caption text-gray-500">
            at ${electricityRate.toFixed(2)}/kWh
          </div>
        </div>
      </div>

      {/* Recommended sizing note */}
      {showMaxReference && (
        <div className="text-caption text-gray-500 bg-gray-800/20 rounded-inner p-button-sm">
          {coveragePercent >= 90
            ? 'Sized to offset ~100% of avg US household usage (10,500 kWh/yr).'
            : `Covers ~${coveragePercent}% of avg US household usage (10,500 kWh/yr).`}
          {' '}Max capacity with {maxPanels} panels: ${Math.round(maxYearlySavings).toLocaleString()}/yr.
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
          <span className="text-body text-gray-400">Carbon offset</span>
        </div>
        <span className="text-body font-medium text-white">
          {(carbonOffsetKg / 1000).toFixed(1)} tons CO₂/year
        </span>
      </div>

      {/* Footer attribution removed per plan §3.7 — date is now inlined
          in the header above. "Google Solar" badge serves as attribution. */}
    </div>
  )
}

export function RoofAnalysisSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-4 w-32 bg-gray-700/50 rounded-chip" />
        <div className="h-4 w-20 bg-gray-700/50 rounded-chip" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-gray-800/40 rounded-inner p-card-sm">
            <div className="h-3 w-16 bg-gray-700/50 rounded-chip mb-2" />
            <div className="h-6 w-20 bg-gray-700/50 rounded-chip" />
          </div>
        ))}
      </div>
      <div className="h-16 bg-gray-800/40 rounded-inner" />
    </div>
  )
}

// Compact version for inline display
export function RoofAnalysisCompact({ roofSummary }: RoofAnalysisProps) {
  return (
    <div className="flex items-center gap-4 text-body">
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
