// Scrollable card row with arrow navigation
// Shared container for hourly and 7-day forecast sections

import { useState, useEffect, useCallback, useRef, type RefObject, type ReactNode } from 'react'
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/solid'
import Card from '@/components/Card'

interface ScrollableCardRowProps {
  title: string
  scrollRef?: RefObject<HTMLDivElement>
  children: ReactNode
}

export function ScrollableCardRow({ title, scrollRef: externalRef, children }: ScrollableCardRowProps) {
  const internalRef = useRef<HTMLDivElement>(null)
  const scrollContainer = (externalRef as React.MutableRefObject<HTMLDivElement | null>) ?? internalRef
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  const updateScrollState = useCallback(() => {
    const el = scrollContainer.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 0)
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
  }, [scrollContainer])

  useEffect(() => {
    const el = scrollContainer.current
    if (!el) return
    updateScrollState()
    el.addEventListener('scroll', updateScrollState, { passive: true })
    const observer = new ResizeObserver(updateScrollState)
    observer.observe(el)
    return () => {
      el.removeEventListener('scroll', updateScrollState)
      observer.disconnect()
    }
  }, [children, scrollContainer, updateScrollState])

  const scroll = (direction: 'left' | 'right') => {
    const el = scrollContainer.current
    if (!el) return
    const offset = direction === 'left' ? -320 : 320
    el.scrollBy({ left: offset, behavior: 'smooth' })
  }

  return (
    <Card noPadding className="p-4 h-full flex flex-col">
      <h3 className="text-subhead font-semibold mb-3 text-white">{title}</h3>
      <div className="relative group flex-1 flex flex-col">
        {/* Left gradient fade */}
        {canScrollLeft && (
          <div className="absolute left-0 top-0 bottom-2 w-6 bg-gradient-to-r from-black/40 to-transparent pointer-events-none z-[5]" />
        )}

        {/* Left arrow */}
        {canScrollLeft && (
          <button
            onClick={() => scroll('left')}
            className="hidden md:flex absolute left-0 top-1/2 -translate-y-1/2 z-10 w-10 h-10 items-center justify-center rounded-full bg-black/70 border border-gray-600/50 text-white opacity-40 group-hover:opacity-100 transition-opacity"
            aria-label="Scroll left"
          >
            <ChevronLeftIcon className="w-4 h-4" />
          </button>
        )}

        {/* Scroll container */}
        <div
          ref={scrollContainer}
          className="flex gap-2.5 overflow-x-auto pb-2 flex-1 items-stretch scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-gray-900/50"
        >
          {children}
        </div>

        {/* Right arrow */}
        {canScrollRight && (
          <button
            onClick={() => scroll('right')}
            className="hidden md:flex absolute right-0 top-1/2 -translate-y-1/2 z-10 w-10 h-10 items-center justify-center rounded-full bg-black/70 border border-gray-600/50 text-white opacity-40 group-hover:opacity-100 transition-opacity"
            aria-label="Scroll right"
          >
            <ChevronRightIcon className="w-4 h-4" />
          </button>
        )}

        {/* Right gradient fade */}
        {canScrollRight && (
          <div className="absolute right-0 top-0 bottom-2 w-6 bg-gradient-to-l from-black/40 to-transparent pointer-events-none z-[5]" />
        )}
      </div>
    </Card>
  )
}
