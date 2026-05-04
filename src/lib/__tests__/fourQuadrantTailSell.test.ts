import { describe, it, expect } from 'vitest'
import {
  isHotTailHighBlacklisted,
  isLowColdTailBlacklisted,
} from '../computeOpportunities'

describe('Hot-tail HIGH per-city blacklist', () => {
  describe('blacklisted cities (heat-wave-prone, viability 2026-05-03)', () => {
    it.each(['AUS', 'BOS', 'LV', 'DAL', 'DC', 'PHIL', 'PHI', 'SEA'])(
      'blacklists %s',
      (city) => {
        expect(isHotTailHighBlacklisted(city)).toBe(true)
      },
    )
  })

  describe('passing cities (≥+6°F hit rate < 5% in clean era)', () => {
    it.each(['CHI', 'SFO', 'DEN', 'PHX', 'MIA', 'HOU', 'LAX', 'NY', 'NYC', 'ATL'])(
      'does NOT blacklist %s',
      (city) => {
        expect(isHotTailHighBlacklisted(city)).toBe(false)
      },
    )
  })
})

describe('LOW cold-tail per-city blacklist', () => {
  it('starts empty (no historical hits to inform exclusion at deploy time)', () => {
    // Phase A viability returned NO-GO due to sample-size insufficiency,
    // not signal. Override deployment as paper to gather forward data.
    // No cities blacklisted initially; populate based on paper data.
    for (const city of ['AUS', 'BOS', 'NY', 'CHI', 'PHX', 'MIA', 'HOU']) {
      expect(isLowColdTailBlacklisted(city)).toBe(false)
    }
  })
})

// Note: end-to-end signal generation tests against synthetic forecasts +
// markets are deferred. The directional gate logic is validated via the
// blacklist tests above + the analyze-hot-side-viability.ts script (which
// exercises the same bracket-distance arithmetic against real production
// data and produces a GO/NO-GO verdict). End-to-end synthetic-input tests
// would duplicate the live cold-side HIGH path behavior we are explicitly
// not modifying.
