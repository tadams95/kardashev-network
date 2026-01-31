// Hook for mouse/touch parallax and interaction tracking

import { useState, useEffect, useCallback, useRef } from 'react'

interface MouseState {
  x: number // -1 to 1 (normalized)
  y: number // -1 to 1 (normalized)
  isActive: boolean // mouse/touch is within bounds
}

interface UseMouseParallaxOptions {
  smoothing?: number // 0-1, higher = smoother/slower response
  enabled?: boolean
}

export function useMouseParallax(
  containerRef: React.RefObject<HTMLElement>,
  options: UseMouseParallaxOptions = {}
) {
  const { smoothing = 0.1, enabled = true } = options

  const [mouse, setMouse] = useState<MouseState>({
    x: 0,
    y: 0,
    isActive: false,
  })

  const targetRef = useRef({ x: 0, y: 0 })
  const currentRef = useRef({ x: 0, y: 0 })
  const rafRef = useRef<number | null>(null)

  // Smooth animation loop
  useEffect(() => {
    if (!enabled) return

    const animate = () => {
      // Lerp toward target
      currentRef.current.x += (targetRef.current.x - currentRef.current.x) * smoothing
      currentRef.current.y += (targetRef.current.y - currentRef.current.y) * smoothing

      setMouse((prev) => ({
        ...prev,
        x: currentRef.current.x,
        y: currentRef.current.y,
      }))

      rafRef.current = requestAnimationFrame(animate)
    }

    rafRef.current = requestAnimationFrame(animate)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [smoothing, enabled])

  // Mouse event handlers
  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!containerRef.current || !enabled) return

      const rect = containerRef.current.getBoundingClientRect()
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      const y = -((e.clientY - rect.top) / rect.height) * 2 + 1

      targetRef.current = { x, y }
    },
    [containerRef, enabled]
  )

  const handleMouseEnter = useCallback(() => {
    setMouse((prev) => ({ ...prev, isActive: true }))
  }, [])

  const handleMouseLeave = useCallback(() => {
    setMouse((prev) => ({ ...prev, isActive: false }))
    // Slowly return to center
    targetRef.current = { x: 0, y: 0 }
  }, [])

  // Touch event handlers (mobile support)
  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (!containerRef.current || !enabled || e.touches.length === 0) return

      const touch = e.touches[0]
      const rect = containerRef.current.getBoundingClientRect()
      const x = ((touch.clientX - rect.left) / rect.width) * 2 - 1
      const y = -((touch.clientY - rect.top) / rect.height) * 2 + 1

      targetRef.current = { x, y }
      setMouse((prev) => ({ ...prev, isActive: true }))
    },
    [containerRef, enabled]
  )

  const handleTouchEnd = useCallback(() => {
    setMouse((prev) => ({ ...prev, isActive: false }))
    targetRef.current = { x: 0, y: 0 }
  }, [])

  // Attach event listeners
  useEffect(() => {
    const container = containerRef.current
    if (!container || !enabled) return

    container.addEventListener('mousemove', handleMouseMove)
    container.addEventListener('mouseenter', handleMouseEnter)
    container.addEventListener('mouseleave', handleMouseLeave)
    container.addEventListener('touchmove', handleTouchMove, { passive: true })
    container.addEventListener('touchend', handleTouchEnd)

    return () => {
      container.removeEventListener('mousemove', handleMouseMove)
      container.removeEventListener('mouseenter', handleMouseEnter)
      container.removeEventListener('mouseleave', handleMouseLeave)
      container.removeEventListener('touchmove', handleTouchMove)
      container.removeEventListener('touchend', handleTouchEnd)
    }
  }, [
    containerRef,
    enabled,
    handleMouseMove,
    handleMouseEnter,
    handleMouseLeave,
    handleTouchMove,
    handleTouchEnd,
  ])

  return mouse
}
