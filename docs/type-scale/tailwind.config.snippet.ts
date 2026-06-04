// tailwind.config.ts — additions for the type scale.
// Merge these keys into your existing config under `theme.extend`.
// Nothing here REPLACES existing tokens — additive only. Tailwind's default
// text-* utilities (text-xs, text-sm, …) continue to work; component code is
// expected to use the named tokens below instead.

import type { Config } from 'tailwindcss';

const config: Partial<Config> = {
  theme: {
    extend: {
      fontSize: {
        // Mono caps labels · SVG axis labels · badge text · weight bars.
        // The accessibility floor of the type system.
        micro: ['11px', { lineHeight: '14px', letterSpacing: '0.5px' }],

        // Secondary text · metadata · sub-labels · eyebrow lines.
        // Use for anything that's "below" the primary read but not data.
        caption: ['12px', { lineHeight: '18px' }],

        // Default body text · table rows · prose · subhead under hero headline.
        // If you're not sure which token to use, it's probably this one.
        body: ['14px', { lineHeight: '21px' }],

        // Card titles (h3) · modal titles · section headers · brand wordmark.
        // The "this is a heading" size; differentiated from body by size,
        // not by font-weight alone.
        subhead: ['18px', { lineHeight: '26px' }],

        // Big numbers · dashboard hero metrics · payment price.
        // For values where the number IS the content. Use font-mono.
        headline: ['32px', { lineHeight: '36px', letterSpacing: '-0.5px' }],

        // Marketing hero ONLY. One use site in the app (HeroSection h1).
        // Responsive via clamp so we don't need sm:/md:/lg: breakpoint salt.
        display: ['clamp(36px, 5.5vw, 60px)', { lineHeight: '1.05', letterSpacing: '-1.5px' }],
      },
    },
  },
};

export default config;

// ─── Cheat sheet ───────────────────────────────────────────────────────────
//
//   Token         | Size            | Use
//   --------------|-----------------|------------------------------------
//   text-micro    | 11/14 +0.5      | Mono caps · SVG axis · badges
//   text-caption  | 12/18           | Metadata · sub-labels · eyebrow
//   text-body     | 14/21           | Default · tables · prose
//   text-subhead  | 18/26           | Card titles · modal titles
//   text-headline | 32/36 −0.5      | Big numbers · hero metrics
//   text-display  | clamp(36-60) -1.5 | Marketing hero only
//
// Notes:
//   - Line-height and letter-spacing ship baked into the tokens. Drop the
//     leading-* and tracking-* utilities when adopting; only re-add them
//     if a specific instance needs to deviate.
//   - The `display` token uses `clamp()` so it scales smoothly from 36px
//     (small mobile) to 60px (≥1091px viewport). No breakpoint utilities
//     needed.
//   - `text-micro` carries +0.5px letter-spacing so mono caps labels feel
//     correct at 11px. Don't add `tracking-wider` on top — it'll stack and
//     look loose. Only add tracking if you specifically need MORE spacing
//     (e.g. footer stamp uses `tracking-[0.2em]`).
