// components/SkelBar.tsx
//
// Skeleton primitive — replaces the repeated
//   <div className="h-4 bg-gray-700/30 rounded animate-pulse" />
// recipe (22+ sites across the weather components + SunroofMap).
//
// The fill is `bg-white/[0.06]` so it scales with the surface system —
// the pulse is visible on `surface.card` and `surface.hero` alike,
// where `bg-gray-700/30` over `bg-black/40` only barely showed up.

import { HTMLAttributes } from "react";

export interface SkelBarProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * Tailwind sizing utilities for this bar, e.g. "h-4 w-1/2".
   * Default: a full-width 16px-tall bar.
   */
  size?: string;
}

export function SkelBar({ size = "h-4 w-full", className = "", ...rest }: SkelBarProps) {
  return (
    <div
      className={`${size} bg-white/[0.06] rounded animate-pulse ${className}`}
      {...rest}
    />
  );
}

export default SkelBar;
