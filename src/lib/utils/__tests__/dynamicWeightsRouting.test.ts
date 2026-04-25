import { describe, expect, it } from 'vitest'
import {
  parsePilotCities,
  isDynamicWeightsLiveEnabledForCity,
} from '../dynamicWeightsRouting'

describe('dynamicWeightsRouting', () => {
  it('enables live dynamic weights for all cities when no pilot list is set', () => {
    const env = {
      NEXT_PUBLIC_DYNAMIC_WEIGHTS_ENABLED: 'true',
      NEXT_PUBLIC_DYNAMIC_WEIGHTS_PILOT_CITIES: '',
    } as unknown as NodeJS.ProcessEnv

    expect(isDynamicWeightsLiveEnabledForCity('NYC', env)).toBe(true)
    expect(isDynamicWeightsLiveEnabledForCity('chi', env)).toBe(true)
  })

  it('restricts live dynamic weights to pilot list when configured', () => {
    const env = {
      NEXT_PUBLIC_DYNAMIC_WEIGHTS_ENABLED: 'true',
      NEXT_PUBLIC_DYNAMIC_WEIGHTS_PILOT_CITIES: 'NYC, CHI',
    } as unknown as NodeJS.ProcessEnv

    expect(isDynamicWeightsLiveEnabledForCity('NYC', env)).toBe(true)
    expect(isDynamicWeightsLiveEnabledForCity('CHI', env)).toBe(true)
    expect(isDynamicWeightsLiveEnabledForCity('LA', env)).toBe(false)
  })

  it('supports kill switch for live dynamic weights', () => {
    const env = {
      NEXT_PUBLIC_DYNAMIC_WEIGHTS_ENABLED: 'false',
      NEXT_PUBLIC_DYNAMIC_WEIGHTS_PILOT_CITIES: 'NYC',
    } as unknown as NodeJS.ProcessEnv

    expect(isDynamicWeightsLiveEnabledForCity('NYC', env)).toBe(false)
  })

  it('parses pilot city list into uppercase set', () => {
    const parsed = parsePilotCities(' nyc, chi , ,la ')
    expect(parsed.has('NYC')).toBe(true)
    expect(parsed.has('CHI')).toBe(true)
    expect(parsed.has('LA')).toBe(true)
    expect(parsed.size).toBe(3)
  })
})
