// SWR hook for fetching dynamic source weights per city

import useSWR from 'swr'
import type { EnsembleWeights } from '@/types/weather'

export interface SourceWeightsResponse {
  cityCode: string | null
  weights: EnsembleWeights
  isDynamic: boolean
  defaultWeights: EnsembleWeights
}

const fetcher = async (url: string) => {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`Weights API: ${r.status}`)
  return r.json() as Promise<SourceWeightsResponse>
}

export function useSourceWeights(cityCode: string) {
  return useSWR<SourceWeightsResponse>(
    cityCode ? `/api/weather/weights?cityCode=${encodeURIComponent(cityCode)}` : null,
    fetcher,
    {
      refreshInterval: 60_000,
      revalidateOnFocus: false,
    }
  )
}
