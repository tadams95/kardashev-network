// Paper-trading qualification for inner-bracket Sweet Spot signals.
//
// This file defines the criteria for "would this prediction qualify as a
// Sweet Spot inner-bracket trade if we were running the strategy?" The
// function is observation-only — it doesn't trigger orders, only tags
// predictions for later analysis.
//
// Wiring (tomorrow): import in src/lib/computeOpportunities.ts at the
// per-prediction log site, set isPaperInnerBracket: true on rows where
// qualifies returns true. The flag becomes the slicing key for the
// /check-paper-signals skill and the trading-readiness Sweet Spot section.
//
// Skill cross-reference: .claude/skills/check-paper-signals/SKILL.md
// duplicates these threshold values in its mongosh aggregation. Update
// both places when criteria evolve.

export const PAPER_LEAD_MIN_HOURS = 12
export const PAPER_LEAD_MAX_HOURS = 48      // exclusive
export const PAPER_PRICE_MIN = 0.20
export const PAPER_PRICE_MAX = 0.40         // exclusive — 40-50¢ excluded per Mar 24 audit
export const PAPER_MIN_EDGE = 0.05          // 5pp gap between market and corrected

export type PaperLeadBucket = '12to24h' | '24to36h' | '36to48h'

export type PaperQualification =
  | { qualifies: true; edge: number; leadBucket: PaperLeadBucket }
  | { qualifies: false; reason: PaperRejectionReason }

export type PaperRejectionReason =
  | 'lead_too_short'
  | 'lead_too_long'
  | 'price_below_band'
  | 'price_above_band'
  | 'wrong_direction'      // corrected >= market (would be a YES bet)
  | 'edge_too_small'
  | 'threshold_bracket'    // bracket is in the threshold regime, not inner

export interface PaperQualifyInput {
  correctedProbability: number
  marketPrice: number
  hoursToResolution: number
  marketType: 'high' | 'low'
  bracketRegime: 'inner' | 'threshold'
}

function leadBucket(hours: number): PaperLeadBucket {
  if (hours < 24) return '12to24h'
  if (hours < 36) return '24to36h'
  return '36to48h'
}

export function qualifiesAsPaperInnerBracket(input: PaperQualifyInput): PaperQualification {
  // Order matters: cheaper checks first, but reasons should be reported
  // in priority order so the diagnostic histogram makes sense.
  if (input.bracketRegime !== 'inner') {
    return { qualifies: false, reason: 'threshold_bracket' }
  }
  if (input.hoursToResolution < PAPER_LEAD_MIN_HOURS) {
    return { qualifies: false, reason: 'lead_too_short' }
  }
  if (input.hoursToResolution >= PAPER_LEAD_MAX_HOURS) {
    return { qualifies: false, reason: 'lead_too_long' }
  }
  if (input.marketPrice < PAPER_PRICE_MIN) {
    return { qualifies: false, reason: 'price_below_band' }
  }
  if (input.marketPrice >= PAPER_PRICE_MAX) {
    return { qualifies: false, reason: 'price_above_band' }
  }
  // NO direction: model thinks outcome unlikely → corrected < market
  if (input.correctedProbability >= input.marketPrice) {
    return { qualifies: false, reason: 'wrong_direction' }
  }
  const edge = input.marketPrice - input.correctedProbability
  // Epsilon avoids floating-point drift rejecting valid boundary values
  // (e.g., 0.30 - 0.25 = 0.0499999... in IEEE 754).
  if (edge < PAPER_MIN_EDGE - 1e-9) {
    return { qualifies: false, reason: 'edge_too_small' }
  }
  return {
    qualifies: true,
    edge,
    leadBucket: leadBucket(input.hoursToResolution),
  }
}
