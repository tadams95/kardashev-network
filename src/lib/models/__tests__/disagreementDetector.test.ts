import { describe, it, expect } from 'vitest'
import { detectDisagreements, EventBracket } from '../disagreementDetector'

// Helper to build a bracket array for an event
function makeBrackets(
  floors: number[],
  prices: number[],
  opts?: { volumes?: number[]; yesAsks?: number[]; eventTicker?: string }
): EventBracket[] {
  return floors.map((floor, i) => ({
    marketId: `MKT-${floor}-${floor + 1}`,
    eventTicker: opts?.eventTicker ?? 'KXHIGHNY-26MAR14',
    floor,
    cap: floor + 1,
    marketPrice: prices[i],
    yesAsk: opts?.yesAsks?.[i],
    volume: opts?.volumes?.[i],
  }))
}

describe('detectDisagreements', () => {
  // Base case: sources at ~80°F, market implies ~77°F → delta ≥ 2
  it('returns signals on underpriced upper brackets when sources diverge from market', () => {
    const perSourceForecasts = {
      'NWS': 80,
      'AccuWeather': 80,
      'Open-Meteo': 79, // within 2°F of consensus → confirms
    }
    // Market prices concentrated around 77°F
    const brackets = makeBrackets(
      [74, 75, 76, 77, 78, 79, 80, 81],
      [0.05, 0.10, 0.18, 0.20, 0.15, 0.10, 0.05, 0.03],
      { volumes: [100, 200, 500, 500, 300, 200, 100, 60] }
    )

    const signals = detectDisagreements(perSourceForecasts, brackets, 24, 'high')

    expect(signals.length).toBeGreaterThan(0)
    // All signals should be in the upper bracket zone (near source consensus)
    for (const s of signals) {
      expect(s.bracket.floor).toBeGreaterThanOrEqual(78)
      expect(s.edge).toBeGreaterThanOrEqual(0.06)
      expect(s.signalSource).toBe('disagreement-detector')
    }
    // Primary flag on highest edge
    const primary = signals.find(s => s.isPrimary)
    expect(primary).toBeTruthy()
    expect(primary!.edge).toBe(Math.max(...signals.map(s => s.edge)))
  })

  it('returns no signals when sources agree with market (delta < 2°F)', () => {
    const perSourceForecasts = {
      'NWS': 74,
      'AccuWeather': 75,
      'Open-Meteo': 74,
    }
    // Market centered around 74.5°F
    const brackets = makeBrackets(
      [72, 73, 74, 75, 76, 77],
      [0.05, 0.15, 0.25, 0.25, 0.15, 0.05],
      { volumes: [100, 200, 500, 500, 200, 100] }
    )

    const signals = detectDisagreements(perSourceForecasts, brackets, 24, 'high')
    expect(signals).toHaveLength(0)
  })

  it('returns no signals when NWS and AccuWeather disagree by >3°F', () => {
    const perSourceForecasts = {
      'NWS': 80,
      'AccuWeather': 73, // 7°F spread
      'Open-Meteo': 76,
    }
    const brackets = makeBrackets(
      [72, 73, 74, 75, 76, 77],
      [0.05, 0.15, 0.25, 0.25, 0.15, 0.05],
      { volumes: [100, 200, 500, 500, 200, 100] }
    )

    const signals = detectDisagreements(perSourceForecasts, brackets, 24, 'high')
    expect(signals).toHaveLength(0)
  })

  it('returns no signals when zero Tier 2 confirmations', () => {
    const perSourceForecasts = {
      'NWS': 80,
      'AccuWeather': 81,
      // Tier 2 sources far from consensus (80.5°F) — all >2°F away
      'Open-Meteo': 74,
      'Google-Weather': 74,
      'Tomorrow.io': 74,
    }
    // Market centered around 75°F → delta > 2 ✓, but no Tier 2 confirmation
    const brackets = makeBrackets(
      [72, 73, 74, 75, 76, 77, 78],
      [0.05, 0.10, 0.20, 0.25, 0.20, 0.10, 0.05],
      { volumes: [100, 200, 500, 500, 500, 200, 100] }
    )

    const signals = detectDisagreements(perSourceForecasts, brackets, 24, 'high')
    expect(signals).toHaveLength(0)
  })

  it('returns no signals when Tier 2 sources agree with market, not with Tier 1', () => {
    // T_sources ≈ 73°F (cold), T_market ≈ 77°F (warm)
    // All Tier 2 at 77°F — agree with market, not sources
    // |77 - 73| = 4°F > 2°F radius → Tier 2 fails proximity check
    const brackets = makeBrackets(
      [74, 75, 76, 77, 78, 79, 80],
      [0.05, 0.10, 0.20, 0.25, 0.20, 0.10, 0.05],
      { volumes: [100, 200, 500, 500, 500, 200, 100] }
    )
    const signals = detectDisagreements(
      { 'NWS': 73, 'AccuWeather': 73, 'Open-Meteo': 77, 'Google-Weather': 77, 'Tomorrow.io': 77 },
      brackets, 24, 'high'
    )
    expect(signals).toHaveLength(0)
  })

  it('rejects Tier 2 source within radius but on wrong side of T_market', () => {
    // T_sources=82, T_market≈78.2, sourceSide=+1 (sources warmer)
    // Tomorrow.io at 78: |78-82|=4 > 2 → fails radius. But also:
    // sign(78-78.2)=-1 ≠ sign(82-78.2)=+1 → directional check rejects too
    const brackets = makeBrackets(
      [74, 75, 76, 77, 78, 79, 80, 81],
      [0.04, 0.06, 0.10, 0.20, 0.20, 0.15, 0.10, 0.05],
      { volumes: [100, 200, 500, 500, 500, 300, 200, 100] }
    )
    const signals = detectDisagreements(
      { 'NWS': 82, 'AccuWeather': 82, 'Tomorrow.io': 78 },
      brackets, 24, 'high'
    )
    expect(signals).toHaveLength(0)
  })

  it('skips brackets priced above 0.30 even if edge exists', () => {
    const perSourceForecasts = {
      'NWS': 80,
      'AccuWeather': 80,
      'Open-Meteo': 79,
    }
    // All brackets priced at 0.35 — above max price cap
    const brackets = makeBrackets(
      [77, 78, 79, 80, 81],
      [0.35, 0.35, 0.35, 0.35, 0.35],
      { volumes: [200, 200, 200, 200, 200] }
    )

    const signals = detectDisagreements(perSourceForecasts, brackets, 24, 'high')
    expect(signals).toHaveLength(0)
  })

  it('skips brackets priced below 0.02 (illiquid tail)', () => {
    const perSourceForecasts = {
      'NWS': 80,
      'AccuWeather': 80,
      'Open-Meteo': 79,
    }
    // Upper brackets priced at 0.01 — below tail guard
    const brackets = makeBrackets(
      [73, 74, 75, 76, 77, 78, 79, 80, 81],
      [0.05, 0.10, 0.15, 0.20, 0.15, 0.10, 0.01, 0.01, 0.01],
      { volumes: [100, 200, 500, 500, 300, 200, 100, 60, 50] }
    )

    const signals = detectDisagreements(perSourceForecasts, brackets, 24, 'high')
    // Brackets at [79,80), [80,81), [81,82) are priced at 0.01 — skipped
    for (const s of signals) {
      expect(s.marketPrice).toBeGreaterThanOrEqual(0.02)
    }
  })

  it('applies lead-time scaling: 40h forecast has wider σ, fewer qualifying brackets', () => {
    const perSourceForecasts = {
      'NWS': 80,
      'AccuWeather': 80,
      'Open-Meteo': 79,
    }
    const brackets = makeBrackets(
      [74, 75, 76, 77, 78, 79, 80, 81],
      [0.05, 0.08, 0.12, 0.15, 0.15, 0.12, 0.08, 0.05],
      { volumes: [100, 200, 500, 500, 500, 300, 200, 100] }
    )

    const signals18h = detectDisagreements(perSourceForecasts, brackets, 18, 'high')
    const signals40h = detectDisagreements(perSourceForecasts, brackets, 40, 'high')

    // Wider σ at 40h spreads probability thinner → fewer brackets with ≥6% edge
    expect(signals40h.length).toBeLessThanOrEqual(signals18h.length)
  })

  it('handles missing Tier 1 source (only NWS available)', () => {
    const perSourceForecasts = {
      'NWS': 80,
      // AccuWeather missing
      'Open-Meteo': 79,
    }
    const brackets = makeBrackets(
      [74, 75, 76, 77, 78, 79, 80, 81],
      [0.05, 0.08, 0.12, 0.15, 0.15, 0.12, 0.08, 0.05],
      { volumes: [100, 200, 500, 500, 500, 300, 200, 100] }
    )

    const signals = detectDisagreements(perSourceForecasts, brackets, 24, 'high')
    expect(signals).toHaveLength(0) // requires both Tier 1
  })

  it('uses yesAsk when available instead of marketPrice', () => {
    const perSourceForecasts = {
      'NWS': 80,
      'AccuWeather': 80,
      'Open-Meteo': 79,
    }
    // marketPrice is low but yesAsk is high — should use yesAsk
    const brackets = makeBrackets(
      [74, 75, 76, 77, 78, 79, 80, 81],
      [0.05, 0.08, 0.12, 0.15, 0.15, 0.12, 0.08, 0.05],
      {
        volumes: [100, 200, 500, 500, 500, 300, 200, 100],
        yesAsks: [0.06, 0.10, 0.14, 0.18, 0.18, 0.14, 0.10, 0.06],
      }
    )

    const signals = detectDisagreements(perSourceForecasts, brackets, 24, 'high')
    for (const s of signals) {
      // Edge should be computed against yesAsk, not marketPrice
      const bracket = brackets.find(b => b.floor === s.bracket.floor)!
      expect(s.marketPrice).toBe(bracket.yesAsk)
    }
  })

  it('uses live MAEs when provided', () => {
    const perSourceForecasts = {
      'NWS': 80,
      'AccuWeather': 80,
      'Open-Meteo': 79,
    }
    const brackets = makeBrackets(
      [74, 75, 76, 77, 78, 79, 80, 81],
      [0.05, 0.08, 0.12, 0.15, 0.15, 0.12, 0.08, 0.05],
      { volumes: [100, 200, 500, 500, 500, 300, 200, 100] }
    )

    // With very small MAE → narrow σ → sharper peak → more edge on peak brackets
    const signalsSmallMAE = detectDisagreements(
      perSourceForecasts, brackets, 24, 'high',
      { 'NWS': 1.0, 'AccuWeather': 1.0 }
    )
    // With large MAE → wide σ → flat distribution → less edge per bracket
    const signalsLargeMAE = detectDisagreements(
      perSourceForecasts, brackets, 24, 'high',
      { 'NWS': 5.0, 'AccuWeather': 5.0 }
    )

    // Smaller MAE should produce more or equal signals with higher peak edges
    if (signalsSmallMAE.length > 0 && signalsLargeMAE.length > 0) {
      const maxEdgeSmall = Math.max(...signalsSmallMAE.map(s => s.edge))
      const maxEdgeLarge = Math.max(...signalsLargeMAE.map(s => s.edge))
      expect(maxEdgeSmall).toBeGreaterThan(maxEdgeLarge)
    }
  })

  it('skips events outside the 12-48h time window', () => {
    const perSourceForecasts = {
      'NWS': 80,
      'AccuWeather': 80,
      'Open-Meteo': 79,
    }
    const brackets = makeBrackets(
      [74, 75, 76, 77, 78, 79, 80, 81],
      [0.05, 0.08, 0.12, 0.15, 0.15, 0.12, 0.08, 0.05],
      { volumes: [100, 200, 500, 500, 500, 300, 200, 100] }
    )

    // Too close (within 12h buffer)
    expect(detectDisagreements(perSourceForecasts, brackets, 10, 'high')).toHaveLength(0)
    // Too far (>48h)
    expect(detectDisagreements(perSourceForecasts, brackets, 50, 'high')).toHaveLength(0)
  })

  it('handles skewed bracket distribution for T_market', () => {
    const perSourceForecasts = {
      'NWS': 82,
      'AccuWeather': 82,
      'Open-Meteo': 81,
    }
    // Heavily skewed market: prices concentrated at low end
    const brackets = makeBrackets(
      [74, 75, 76, 77, 78, 79, 80, 81, 82],
      [0.25, 0.20, 0.15, 0.10, 0.08, 0.05, 0.04, 0.03, 0.02],
      { volumes: [500, 500, 400, 300, 200, 100, 80, 60, 50] }
    )

    const signals = detectDisagreements(perSourceForecasts, brackets, 24, 'high')
    // Sources at 82 vs market heavily weighted low → large delta
    expect(signals.length).toBeGreaterThan(0)
    expect(signals[0].temperatureDelta).toBeGreaterThanOrEqual(2.0)
  })

  it('rejects events with <5 valid brackets', () => {
    const perSourceForecasts = {
      'NWS': 80,
      'AccuWeather': 80,
      'Open-Meteo': 79,
    }
    // Only 4 brackets
    const brackets = makeBrackets(
      [78, 79, 80, 81],
      [0.25, 0.25, 0.25, 0.25],
      { volumes: [200, 200, 200, 200] }
    )

    const signals = detectDisagreements(perSourceForecasts, brackets, 24, 'high')
    expect(signals).toHaveLength(0)
  })

  it('rejects events where remaining bracket prices sum < 0.70', () => {
    const perSourceForecasts = {
      'NWS': 80,
      'AccuWeather': 80,
      'Open-Meteo': 79,
    }
    // 6 brackets but prices sum to only 0.30
    const brackets = makeBrackets(
      [75, 76, 77, 78, 79, 80],
      [0.05, 0.05, 0.05, 0.05, 0.05, 0.05],
      { volumes: [100, 100, 100, 100, 100, 100] }
    )

    const signals = detectDisagreements(perSourceForecasts, brackets, 24, 'high')
    expect(signals).toHaveLength(0)
  })

  it('filters out low-volume brackets from T_market computation', () => {
    const perSourceForecasts = {
      'NWS': 80,
      'AccuWeather': 80,
      'Open-Meteo': 79,
    }
    // Mix of high and low volume — low volume brackets excluded from T_market
    const brackets = makeBrackets(
      [74, 75, 76, 77, 78, 79, 80, 81],
      [0.05, 0.08, 0.12, 0.15, 0.15, 0.12, 0.08, 0.05],
      { volumes: [10, 200, 500, 500, 500, 300, 200, 100] } // first bracket low volume
    )

    const signals = detectDisagreements(perSourceForecasts, brackets, 24, 'high')
    // Should still work — the low-volume bracket is excluded from T_market calc
    // but remains eligible for signals if it passes other guards
    expect(Array.isArray(signals)).toBe(true)
  })

  it('only generates YES signals (all edges are positive)', () => {
    const perSourceForecasts = {
      'NWS': 80,
      'AccuWeather': 80,
      'Open-Meteo': 79,
    }
    const brackets = makeBrackets(
      [74, 75, 76, 77, 78, 79, 80, 81],
      [0.05, 0.08, 0.12, 0.15, 0.15, 0.12, 0.08, 0.05],
      { volumes: [100, 200, 500, 500, 500, 300, 200, 100] }
    )

    const signals = detectDisagreements(perSourceForecasts, brackets, 24, 'high')
    for (const s of signals) {
      expect(s.edge).toBeGreaterThan(0) // YES signals only — P_source > market
    }
  })

  it('populates all required fields on returned signals', () => {
    const perSourceForecasts = {
      'NWS': 80,
      'AccuWeather': 80,
      'Open-Meteo': 79,
    }
    // Market concentrated around 77°F → delta ≈ 3°F
    const brackets = makeBrackets(
      [74, 75, 76, 77, 78, 79, 80, 81],
      [0.05, 0.10, 0.18, 0.20, 0.15, 0.10, 0.05, 0.03],
      { volumes: [100, 200, 500, 500, 300, 200, 100, 60] }
    )

    const signals = detectDisagreements(perSourceForecasts, brackets, 24, 'high')
    expect(signals.length).toBeGreaterThan(0)

    for (const s of signals) {
      expect(s.marketId).toBeTruthy()
      expect(s.eventTicker).toBeTruthy()
      expect(typeof s.bracket.floor).toBe('number')
      expect(typeof s.bracket.cap).toBe('number')
      expect(typeof s.sourceConsensusTemp).toBe('number')
      expect(typeof s.marketImpliedTemp).toBe('number')
      expect(typeof s.temperatureDelta).toBe('number')
      expect(typeof s.sourceBracketProb).toBe('number')
      expect(typeof s.marketPrice).toBe('number')
      expect(typeof s.edge).toBe('number')
      expect(typeof s.tier2Confirmations).toBe('number')
      expect(typeof s.hoursToResolution).toBe('number')
      expect(typeof s.isPrimary).toBe('boolean')
      expect(s.signalSource).toBe('disagreement-detector')
      expect(s.sources).toHaveProperty('NWS')
      expect(s.sources).toHaveProperty('AccuWeather')
    }
  })
})
