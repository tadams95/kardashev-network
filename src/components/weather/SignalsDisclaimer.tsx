import { useState } from 'react'

const STORAGE_KEY = 'kn_signals_disclaimer_seen'

export function SignalsDisclaimer() {
  const [isExpanded, setIsExpanded] = useState(() => {
    if (typeof window === 'undefined') return true
    return localStorage.getItem(STORAGE_KEY) !== 'true'
  })

  const toggle = () => {
    setIsExpanded(prev => {
      const next = !prev
      if (!next && typeof window !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, 'true')
      }
      return next
    })
  }

  return (
    <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl overflow-hidden">
      <button
        onClick={toggle}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-amber-500/10 transition-colors"
        aria-expanded={isExpanded}
      >
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-amber-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
          <span className="text-sm font-semibold text-amber-400">Signal Disclaimer</span>
        </div>
        <svg
          className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {isExpanded && (
        <div className="px-4 pb-4 border-t border-amber-500/10">
          <ul className="mt-3 space-y-2 text-xs text-gray-400 list-disc list-inside">
            <li>
              <span className="text-gray-300">Signals are dynamic</span> — probabilities update
              every 5–15 minutes as weather sources refresh and market prices move.
            </li>
            <li>
              <span className="text-gray-300">Time decay</span> — confidence decays as resolution
              approaches; all signals become Hold within 12 hours of market close.
            </li>
            <li>
              <span className="text-gray-300">No guarantee of profit</span> — Strong Buy means high
              edge and high confidence at this moment, not a guaranteed outcome.
            </li>
            <li>
              <span className="text-gray-300">Fee drag</span> — a 10% fee rate is assumed; edges
              below ~10% may not be profitable after execution costs.
            </li>
            <li>
              <span className="text-gray-300">Source disagreement</span> — when weather sources
              diverge, probabilities are automatically shrunk toward 50%.
            </li>
            <li>
              <span className="text-gray-300">Dynamic threshold</span> — the minimum edge required
              for a signal adjusts based on recent model accuracy.
            </li>
            <li>
              <span className="text-gray-300">Past signals may not repeat</span> — model calibration,
              bias corrections, and source weights evolve over time.
            </li>
          </ul>
        </div>
      )}
    </div>
  )
}
