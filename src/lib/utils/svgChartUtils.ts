// Shared SVG chart utilities
// Extracted from ROICurve.tsx and SolarCurve.tsx

/**
 * Create smooth bezier curve path from data points.
 * Uses cardinal spline interpolation with configurable tension.
 */
export function createSmoothPath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return ''

  let path = `M ${points[0].x} ${points[0].y}`

  for (let i = 0; i < points.length - 1; i++) {
    const current = points[i]
    const next = points[i + 1]
    const prev = points[i - 1] || current
    const afterNext = points[i + 2] || next

    const tension = 0.3
    const cp1x = current.x + (next.x - prev.x) * tension
    const cp1y = current.y + (next.y - prev.y) * tension
    const cp2x = next.x - (afterNext.x - current.x) * tension
    const cp2y = next.y - (afterNext.y - current.y) * tension

    path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${next.x} ${next.y}`
  }

  return path
}
