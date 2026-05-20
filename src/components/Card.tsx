// components/Card.tsx
//
// Surface primitive · 3 tiers, one component.
//
//   <Card variant="default">          everyday card (replaces ~15 call sites)
//   <Card variant="hero">             elevated card — live data, big numbers
//   <Card variant="nested">           sub-surface inside another card
//
// Borders are `white/[0.06]` (default) and `white/[0.1]` (nested-strong),
// not gray. Hero variant is borderless — its raised fill carries the chrome.
// Radius is `rounded-xl` (12px) across all variants — matches existing
// `bg-black/40 border border-gray-700/50 rounded-xl` recipe being replaced.
//
// Pass `noPadding` when the card has internal sections that need to
// control their own padding (e.g. WeatherHeroCard with primary + footer).
//
// `as` accepts a tag name for cases where the surface should be a
// <section>, <article>, etc.

import { ElementType, HTMLAttributes, forwardRef } from "react";

export type CardVariant = "default" | "hero" | "nested";

const VARIANT_CHROME: Record<CardVariant, string> = {
  default: "bg-surface-card border border-white/[0.06] rounded-xl",
  hero: "bg-surface-hero rounded-xl",
  nested: "bg-surface-nested border border-white/[0.1] rounded-xl",
};

const VARIANT_PADDING: Record<CardVariant, string> = {
  default: "p-5", // 20px
  hero: "p-6", // 24px
  nested: "p-3.5", // 14px
};

export interface CardProps extends HTMLAttributes<HTMLElement> {
  variant?: CardVariant;
  /** Render as a different tag (default: 'div'). */
  as?: ElementType;
  /** Skip the variant's default padding. Use when children control padding. */
  noPadding?: boolean;
}

const Card = forwardRef<HTMLElement, CardProps>(function Card(
  { variant = "default", as: Tag = "div", noPadding = false, className = "", ...rest },
  ref,
) {
  const classes = [
    VARIANT_CHROME[variant],
    noPadding ? "" : VARIANT_PADDING[variant],
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return <Tag ref={ref as never} className={classes} {...rest} />;
});

export default Card;
