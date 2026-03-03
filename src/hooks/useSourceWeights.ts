// SWR hook for fetching dynamic source weights per city

import useSWR from 'swr'
import type { EnsembleWeights } from '@/types/weather'
import type { SourceWeightDetail } from '@/lib/models/sourceAccuracy'

interface SourceWeightsResponse {
  cityCode: string | null
  weights: EnsembleWeights
  isDynamic: boolean
  perSource: Record<string, SourceWeightDetail>
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
