// Rules-based disagreement detector
// Detects temperature-level disagreement between Tier 1 sources and the market
// Runs as an independent signal source alongside the probability model
//
// Core idea: When NWS + AccuWeather consensus diverges from the market's implied
// temperature by ≥2°F, flag underpriced brackets in the source consensus zone.

// ============================================================================
// Types
// ============================================================================

export interface DisagreementSignal {
  marketId: string
  eventTicker: string
  bracket: { floor: number; cap: number }
  sourceConsensusTemp: number      // T_sources in °F
  marketImpliedTemp: number        // T_market in °F
  temperatureDelta: number         // |T_sources - T_market|
  sourceBracketProb: number        // our P(bracket)
  marketPrice: number              // YES ask
  edge: number                     // sourceBracketProb - marketPrice
  tier2Confirmations: number
  hoursToResolution: number
  sources: Record<string, number>  // source → forecast °F
  isPrimary: boolean               // highest-edge bracket in this event
  signalSource: 'disagreement-detector'
}

export interface EventBracket {
  marketId: string
  eventTicker: string
  floor: number          // threshold °F
  cap: number            // capStrike °F
  marketPrice: number    // currentPrice (mid)
  yesAsk?: number
  volume?: number        // for T_market quality guard
}

// ============================================================================
// Constants
// ============================================================================

const TIER1_SOURCES = ['NWS', 'AccuWeather'] as const
const TIER2_SOURCES = ['Open-Meteo', 'Google-Weather', 'Tomorrow.io'] as const

const FALLBACK_MAES: Record<string, number> = {
  'NWS': 2.25,
  'AccuWeather': 2.30,
  'Open-Meteo': 3.70,
  'Google-Weather': 3.70,
  'Tomorrow.io': 3.70,
}

// Signal thresholds
const MIN_TEMPERATURE_DELTA = 2.0     // °F — minimum T_sources vs T_market divergence
const MAX_TIER1_SPREAD = 3.0          // °F — max disagreement between NWS and AccuWeather
const TIER2_CONFIRMATION_RADIUS = 2.0 // °F — Tier 2 forecast must be within this of T_sources
const MIN_BRACKET_EDGE = 0.06         // 6% minimum edge per bracket
const MAX_BRACKET_PRICE = 0.30        // don't buy brackets priced above 30%
const MIN_BRACKET_PRICE = 0.02        // skip illiquid tail brackets
const MIN_HOURS = 12                  // minimum hours to resolution
const MAX_HOURS = 48                  // maximum hours to resolution

// T_market quality guards
const MIN_BRACKET_VOLUME = 50         // exclude brackets with volume < 50
const MIN_VALID_BRACKETS = 5          // need ≥5 brackets with valid prices
const MIN_PRICE_SUM = 0.70            // remaining bracket prices must sum to ≥0.70

// ============================================================================
// Math helpers (copied from weatherProbability.ts — not exported there)
// ============================================================================

function erf(x: number): number {
  const sign = x >= 0 ? 1 : -1
  x = Math.abs(x)

  const a1 = 0.254829592
  const a2 = -0.284496736
  const a3 = 1.421413741
  const a4 = -1.453152027
  const a5 = 1.061405429
  const p = 0.3275911

  const t = 1.0 / (1.0 + p * x)
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x)

  return sign * y
}

function normalCDF(x: number, mean: number, stdDev: number): number {
  if (stdDev === 0) return x >= mean ? 1 : 0
  const z = (x - mean) / (stdDev * Math.sqrt(2))
  return 0.5 * (1 + erf(z))
}

// ============================================================================
// Lead-time MAE scaling
// ============================================================================

function getLeadTimeScale(hoursToResolution: number): number {
  if (hoursToResolution <= 18) return 0.75
  if (hoursToResolution <= 30) return 1.0
  if (hoursToResolution <= 42) return 1.2
  return 1.4
}

// ============================================================================
// Core detector
// ============================================================================

/**
 * Detect temperature-level disagreements between Tier 1 sources and market pricing.
 *
 * @param perSourceForecasts  source name → forecast temperature in °F
 * @param brackets            all brackets in an event (sorted by threshold)
 * @param hoursToResolution   hours until market resolves
 * @param temperatureType     'high' or 'low' — used for logging only
 * @param sourceMAEs          live MAEs from computeWeights(); falls back to FALLBACK_MAES
 * @returns array of signals for qualifying brackets (may be empty)
 */
export function detectDisagreements(
  perSourceForecasts: Record<string, number>,
  brackets: EventBracket[],
  hoursToResolution: number,
  temperatureType: 'high' | 'low',
  sourceMAEs?: Record<string, number>,
): DisagreementSignal[] {
  // Time window guard
  if (hoursToResolution <= MIN_HOURS || hoursToResolution > MAX_HOURS) return []

  // Step 1: Extract Tier 1 forecasts — require both
  const tier1Temps: { source: string; temp: number; mae: number }[] = []
  for (const src of TIER1_SOURCES) {
    const temp = perSourceForecasts[src]
    if (temp == null || !isFinite(temp)) continue
    const mae = sourceMAEs?.[src] ?? FALLBACK_MAES[src]
    tier1Temps.push({ source: src, temp, mae })
  }
  if (tier1Temps.length < 2) return []

  // Step 2: Tier 1 internal agreement check
  const tier1Spread = Math.abs(tier1Temps[0].temp - tier1Temps[1].temp)
  if (tier1Spread > MAX_TIER1_SPREAD) return []

  // Step 3: Compute T_sources (inverse-MAE weighted mean of Tier 1)
  const tier1WeightedSum = tier1Temps.reduce((s, t) => s + t.temp * (1 / t.mae), 0)
  const tier1WeightSum = tier1Temps.reduce((s, t) => s + (1 / t.mae), 0)
  const tSources = tier1WeightedSum / tier1WeightSum

  // Step 4: Compute T_market from bracket midpoints × prices
  // Apply quality guards: volume filter, min valid brackets, min price sum
  const validBrackets = brackets.filter(b => {
    if (b.volume != null && b.volume < MIN_BRACKET_VOLUME) return false
    return b.marketPrice > 0
  })

  if (validBrackets.length < MIN_VALID_BRACKETS) return []

  const priceSum = validBrackets.reduce((s, b) => s + b.marketPrice, 0)
  if (priceSum < MIN_PRICE_SUM) return []

  const tMarket = validBrackets.reduce((s, b) => {
    const midpoint = (b.floor + b.cap) / 2
    return s + midpoint * b.marketPrice
  }, 0) / priceSum

  // Step 5: Disagreement check
  const delta = Math.abs(tSources - tMarket)
  if (delta < MIN_TEMPERATURE_DELTA) return []

  // Step 6: Tier 2 directional confirmation — ≥1 source within 2°F of T_sources
  // AND on the same side of T_market as T_sources (prevents a Tier 2 source
  // that agrees with the market from counting as "confirmation")
  const sourceSide = Math.sign(tSources - tMarket) // +1 if sources are warmer
  let tier2Confirmations = 0
  for (const src of TIER2_SOURCES) {
    const temp = perSourceForecasts[src]
    if (temp == null || !isFinite(temp)) continue
    const withinRadius = Math.abs(temp - tSources) <= TIER2_CONFIRMATION_RADIUS
    const sameDirection = Math.sign(temp - tMarket) === sourceSide
    if (withinRadius && sameDirection) {
      tier2Confirmations++
    }
  }
  if (tier2Confirmations < 1) return []

  // Step 7: Compute σ_combined (weighted-average MAE × lead-time scale)
  const leadScale = getLeadTimeScale(hoursToResolution)
  const allMAEs = tier1Temps.map(t => ({ mae: t.mae, weight: 1 / t.mae }))
  const weightedMAE = allMAEs.reduce((s, m) => s + m.mae * m.weight, 0) / allMAEs.reduce((s, m) => s + m.weight, 0)
  const sigma = weightedMAE * leadScale

  // Step 8: Per-bracket edge scan
  const signals: DisagreementSignal[] = []
  for (const bracket of brackets) {
    const price = bracket.yesAsk ?? bracket.marketPrice
    if (price > MAX_BRACKET_PRICE) continue
    if (price < MIN_BRACKET_PRICE) continue

    const pSource = normalCDF(bracket.cap, tSources, sigma) - normalCDF(bracket.floor, tSources, sigma)
    const edge = pSource - price
    if (edge < MIN_BRACKET_EDGE) continue

    signals.push({
      marketId: bracket.marketId,
      eventTicker: bracket.eventTicker,
      bracket: { floor: bracket.floor, cap: bracket.cap },
      sourceConsensusTemp: tSources,
      marketImpliedTemp: tMarket,
      temperatureDelta: delta,
      sourceBracketProb: pSource,
      marketPrice: price,
      edge,
      tier2Confirmations,
      hoursToResolution,
      sources: { ...perSourceForecasts },
      isPrimary: false, // set below
      signalSource: 'disagreement-detector',
    })
  }

  // Flag highest-edge bracket as primary
  if (signals.length > 0) {
    signals.sort((a, b) => b.edge - a.edge)
    signals[0].isPrimary = true
  }

  return signals
}
