// Section-level React error boundary used to wrap risky dashboard
// surfaces (per premium UX plan §3.8). One bad data shape inside, e.g.,
// RoofAnalysis or SunroofMap, downgrades just that section instead of
// crashing the whole route.
//
// Error boundaries are still class components in React 18 — there's no
// hook equivalent.

import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** Human-readable section name shown in the fallback copy. */
  sectionName?: string
  /** Optional override for the fallback UI. */
  fallback?: ReactNode
}

interface State {
  hasError: boolean
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface in console — telemetry hook can be added later.
    console.error(
      `[ErrorBoundary] ${this.props.sectionName ?? 'unknown section'}`,
      error,
      info.componentStack,
    )
  }

  reset = (): void => {
    this.setState({ hasError: false })
  }

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children
    }

    if (this.props.fallback !== undefined) {
      return this.props.fallback
    }

    const name = this.props.sectionName ?? 'this section'
    return (
      <div className="bg-red-900/15 border border-red-800/40 rounded-card p-card-banner flex items-start gap-3">
        <div className="flex-shrink-0 w-9 h-9 rounded-card bg-red-500/10 border border-red-700/30 flex items-center justify-center">
          <svg className="w-4 h-4 text-red-400" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-body font-medium text-red-300">
            Couldn&apos;t load {name}
          </h3>
          <p className="text-caption text-red-400/80 mt-0.5">
            The rest of the dashboard is unaffected.{' '}
            <button
              onClick={this.reset}
              className="text-red-300 hover:text-red-200 underline underline-offset-2"
            >
              Try again
            </button>
          </p>
        </div>
      </div>
    )
  }
}
