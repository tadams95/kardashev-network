import type { LeadBucket, MarketTypeKey } from './sourceAccuracy'
import { recomputeAndPublishWeightRollups } from './sourceAccuracy'

export async function runWeightRollupJob(args?: {
  cityCodes?: string[]
  marketTypes?: MarketTypeKey[]
  leadBuckets?: LeadBucket[]
}) {
  return recomputeAndPublishWeightRollups(args)
}
