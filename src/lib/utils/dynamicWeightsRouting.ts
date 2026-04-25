const TRUE_LIKE = new Set(['1', 'true', 'yes', 'on'])
const FALSE_LIKE = new Set(['0', 'false', 'no', 'off'])

function normalizeFlag(value: string | undefined): boolean | undefined {
  if (value == null) return undefined
  const norm = value.trim().toLowerCase()
  if (!norm) return undefined
  if (TRUE_LIKE.has(norm)) return true
  if (FALSE_LIKE.has(norm)) return false
  return undefined
}

export function parsePilotCities(value: string | undefined): Set<string> {
  if (!value || !value.trim()) return new Set()
  const cities = value
    .split(',')
    .map(city => city.trim().toUpperCase())
    .filter(Boolean)
  return new Set(cities)
}

export function isDynamicWeightsLiveEnabledForCity(
  cityCode: string,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const globalFlag = normalizeFlag(env.NEXT_PUBLIC_DYNAMIC_WEIGHTS_ENABLED)
  if (globalFlag === false) return false

  const pilotCities = parsePilotCities(env.NEXT_PUBLIC_DYNAMIC_WEIGHTS_PILOT_CITIES)
  if (pilotCities.size === 0) return true

  return pilotCities.has(cityCode.toUpperCase())
}
