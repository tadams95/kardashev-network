import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        solar: {
          void: '#050505',
          core: '#f0f8ff',      // Blue-white sun core (~5778K)
          orange: '#FF4D00',
          gold: '#FFD700',
          crimson: '#8B0000',
          mid: '#FF8C00',
          white: '#FFF8E7',     // Solar-white corona
        },
      },
      fontFamily: {
        display: ['Inter', 'SF Pro Display', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        // Visual-system tokens — dashboard surface (Phase 1, item 3.13).
        // Map: display=hero, headline=secondary marquee, title=card values,
        // body=section heading + default body, caption=sub-labels/units,
        // micro=eyebrows (always paired with `eyebrow` recipe in globals.css).
        display:  ['clamp(3rem, 1rem + 5vw, 4.5rem)', { lineHeight: '1', letterSpacing: '-0.02em' }],
        headline: ['1.5rem',  { lineHeight: '1.15' }],   // 24px
        title:    ['1.125rem', { lineHeight: '1.3' }],   // 18px
        body:     ['0.875rem', { lineHeight: '1.4' }],   // 14px
        caption:  ['0.75rem',  { lineHeight: '1.35' }],  // 12px
        micro:    ['0.625rem', { lineHeight: '1.2' }],   // 10px
      },
      spacing: {
        // Card padding tokens (composite paddings live in `globals.css`
        // as `@layer components` recipes — see `p-card`, `p-card-hero` etc.)
      },
      borderRadius: {
        chip:  '0.25rem', // 4px — chips, badges, skeleton placeholders
        inner: '0.5rem',  // 8px — buttons, inputs, inner cells
        card:  '0.75rem', // 12px — section cards
      },
      animation: {
        'spin-slow': 'spin 12s linear infinite',
        'spin-reverse': 'spin-reverse 8s linear infinite',
        'shimmer': 'shimmer 2s ease-in-out infinite',
        'pulse-solar': 'pulse-solar 4s ease-in-out infinite',
        'glow-pulse-solar': 'glow-pulse-solar 3s ease-in-out infinite',
        'corona-flicker': 'corona-flicker 2s ease-in-out infinite',
        'live-pulse': 'live-pulse 2s ease-in-out infinite',
      },
      keyframes: {
        'spin-reverse': {
          from: { transform: 'rotate(360deg)' },
          to: { transform: 'rotate(0deg)' },
        },
        'shimmer': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
        'pulse-solar': {
          '0%, 100%': {
            opacity: '1',
            boxShadow: '0 0 20px rgba(255, 77, 0, 0.4)',
          },
          '50%': {
            opacity: '0.85',
            boxShadow: '0 0 40px rgba(255, 77, 0, 0.6)',
          },
        },
        'glow-pulse-solar': {
          '0%, 100%': {
            boxShadow: '0 0 20px rgba(255, 77, 0, 0.3), 0 0 40px rgba(255, 77, 0, 0.1)',
          },
          '50%': {
            boxShadow: '0 0 30px rgba(255, 77, 0, 0.5), 0 0 60px rgba(255, 77, 0, 0.2)',
          },
        },
        'corona-flicker': {
          '0%, 100%': { opacity: '0.8' },
          '25%': { opacity: '0.9' },
          '50%': { opacity: '0.75' },
          '75%': { opacity: '0.85' },
        },
        'live-pulse': {
          '0%, 100%': {
            transform: 'scale(1)',
            opacity: '1',
          },
          '50%': {
            transform: 'scale(1.2)',
            opacity: '0.7',
          },
        },
      },
      backgroundImage: {
        'solar-gradient': 'linear-gradient(135deg, #FF4D00 0%, #FFD700 50%, #FF8C00 100%)',
        'solar-radial': 'radial-gradient(circle, #FFD700 0%, #FF4D00 50%, #8B0000 100%)',
      },
    },
  },
  plugins: [],
};

export default config;
