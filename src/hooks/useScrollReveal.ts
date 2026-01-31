// Hook for scroll-triggered section reveal animations

import { useEffect, useRef, useState, useCallback } from 'react'

interface ScrollRevealOptions {
  threshold?: number // 0-1, how much of element must be visible
  rootMargin?: string // margin around viewport
  once?: boolean // only animate once
}

interface ScrollRevealState {
  isVisible: boolean
  hasAnimated: boolean
}

export function useScrollReveal(options: ScrollRevealOptions = {}): {
  ref: React.RefObject<HTMLDivElement>
  isVisible: boolean
  hasAnimated: boolean
} {
  const { threshold = 0.1, rootMargin = '0px', once = true } = options

  const ref = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<ScrollRevealState>({
    isVisible: false,
    hasAnimated: false,
  })

  useEffect(() => {
    const element = ref.current
    if (!element) return

    // Skip if already animated and once is true
    if (once && state.hasAnimated) return

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setState({ isVisible: true, hasAnimated: true })

            // Unobserve if only animating once
            if (once) {
              observer.unobserve(element)
            }
          } else if (!once) {
            setState((prev) => ({ ...prev, isVisible: false }))
          }
        })
      },
      { threshold, rootMargin }
    )

    observer.observe(element)

    return () => observer.disconnect()
  }, [threshold, rootMargin, once, state.hasAnimated])

  return {
    ref,
    isVisible: state.isVisible,
    hasAnimated: state.hasAnimated,
  }
}

// Utility component for easier usage
interface RevealSectionProps {
  children: React.ReactNode
  className?: string
  delay?: number // delay in ms
  direction?: 'up' | 'down' | 'left' | 'right' | 'fade'
}

export function getRevealStyles(
  isVisible: boolean,
  direction: 'up' | 'down' | 'left' | 'right' | 'fade' = 'up',
  delay: number = 0
): React.CSSProperties {
  const transforms = {
    up: 'translateY(30px)',
    down: 'translateY(-30px)',
    left: 'translateX(30px)',
    right: 'translateX(-30px)',
    fade: 'translateY(0)',
  }

  return {
    opacity: isVisible ? 1 : 0,
    transform: isVisible ? 'translate(0)' : transforms[direction],
    transition: `opacity 0.6s ease-out ${delay}ms, transform 0.6s ease-out ${delay}ms`,
  }
}
