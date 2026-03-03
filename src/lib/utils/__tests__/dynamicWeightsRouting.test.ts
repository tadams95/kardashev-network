import { describe, expect, it } from 'vitest'
import {
  parsePilotCities,
  isDynamicWeightsLiveEnabledForCity,
  isDynamicWeightsShadowModeEnabled,
  shouldFetchDynamicWeightContexts,
} from '../dynamicWeightsRouting'

describe('dynamicWeightsRouting', () => {
  it('enables live dynamic weights for all cities when no pilot list is set', () => {
    const env = {
      NEXT_PUBLIC_DYNAMIC_WEIGHTS_ENABLED: 'true',
      NEXT_PUBLIC_DYNAMIC_WEIGHTS_PILOT_CITIES: '',
    } as NodeJS.ProcessEnv

    expect(isDynamicWeightsLiveEnabledForCity('NYC', env)).toBe(true)
    expect(isDynamicWeightsLiveEnabledForCity('chi', env)).toBe(true)
  })

  it('restricts live dynamic weights to pilot list when configured', () => {
    const env = {
      NEXT_PUBLIC_DYNAMIC_WEIGHTS_ENABLED: 'true',
      NEXT_PUBLIC_DYNAMIC_WEIGHTS_PILOT_CITIES: 'NYC, CHI',
    } as NodeJS.ProcessEnv

    expect(isDynamicWeightsLiveEnabledForCity('NYC', env)).toBe(true)
    expect(isDynamicWeightsLiveEnabledForCity('CHI', env)).toBe(true)
    expect(isDynamicWeightsLiveEnabledForCity('LA', env)).toBe(false)
  })

  it('supports kill switch for live dynamic weights', () => {
    const env = {
      NEXT_PUBLIC_DYNAMIC_WEIGHTS_ENABLED: 'false',
      NEXT_PUBLIC_DYNAMIC_WEIGHTS_PILOT_CITIES: 'NYC',
    } as NodeJS.ProcessEnv

    expect(isDynamicWeightsLiveEnabledForCity('NYC', env)).toBe(false)
  })

  it('keeps shadow mode on by default and allows explicit disable', () => {
    expect(isDynamicWeightsShadowModeEnabled({} as NodeJS.ProcessEnv)).toBe(true)
    expect(isDynamicWeightsShadowModeEnabled({ NEXT_PUBLIC_DYNAMIC_WEIGHTS_SHADOW_MODE: 'false' } as NodeJS.ProcessEnv)).toBe(false)
  })

  it('fetches contexts when either live or shadow mode is enabled', () => {
    const liveEnv = {
      NEXT_PUBLIC_DYNAMIC_WEIGHTS_ENABLED: 'true',
      NEXT_PUBLIC_DYNAMIC_WEIGHTS_SHADOW_MODE: 'false',
    } as NodeJS.ProcessEnv
    expect(shouldFetchDynamicWeightContexts('NYC', liveEnv)).toBe(true)

    const shadowEnv = {
      NEXT_PUBLIC_DYNAMIC_WEIGHTS_ENABLED: 'false',
      NEXT_PUBLIC_DYNAMIC_WEIGHTS_SHADOW_MODE: 'true',
    } as NodeJS.ProcessEnv
    expect(shouldFetchDynamicWeightContexts('NYC', shadowEnv)).toBe(true)

    const neitherEnv = {
      NEXT_PUBLIC_DYNAMIC_WEIGHTS_ENABLED: 'false',
      NEXT_PUBLIC_DYNAMIC_WEIGHTS_SHADOW_MODE: 'false',
    } as NodeJS.ProcessEnv
    expect(shouldFetchDynamicWeightContexts('NYC', neitherEnv)).toBe(false)
  })

  it('parses pilot city list into uppercase set', () => {
    const parsed = parsePilotCities(' nyc, chi , ,la ')
    expect(parsed.has('NYC')).toBe(true)
    expect(parsed.has('CHI')).toBe(true)
    expect(parsed.has('LA')).toBe(true)
    expect(parsed.size).toBe(3)
  })
})
