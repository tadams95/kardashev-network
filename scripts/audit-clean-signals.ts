import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config()

import { getDb, closeClient } from '../src/lib/db/mongodb'

type SignalDoc = {
  marketId: string
  modelProbability: number
  marketPrice: number
  outcome?: boolean
  forecastTemp?: number
  actualTemp?: number
  timestamp: number
}

const LOOKBACK_DAYS = 180
const MAX_FORECAST_ERROR_F = 15

function pct(value: number): number {
  return Number((value * 100).toFixed(1))
}

async function main(): Promise<void> {
  const db = getDb()
  const cutoff = Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000

  const docs = await db.collection<SignalDoc>('signals')
    .find({
      outcome: { $exists: true },
      forecastTemp: { $type: 'double' },
      actualTemp: { $type: 'double' },
      timestamp: { $gte: cutoff },
    })
    .project({ marketId: 1, modelProbability: 1, marketPrice: 1, outcome: 1, forecastTemp: 1, actualTemp: 1, timestamp: 1 })
    .toArray()

  const clean = docs.filter((doc) =>
    typeof doc.forecastTemp === 'number' &&
    typeof doc.actualTemp === 'number' &&
    Math.abs(doc.forecastTemp - doc.actualTemp) < MAX_FORECAST_ERROR_F
  )

  const bins: Array<[number, number]> = [
    [0, 0.2],
    [0.2, 0.4],
    [0.4, 0.6],
    [0.6, 0.8],
    [0.8, 1.0000001],
  ]

  const rows = bins.map(([min, max]) => {
    const bucket = clean.filter((doc) => doc.modelProbability >= min && doc.modelProbability < max)
    const marketYesRate = bucket.length > 0
      ? bucket.filter((doc) => doc.outcome === true).length / bucket.length
      : 0
    const tradeWinRate = bucket.length > 0
      ? bucket.filter((doc) => {
          const bettingYes = doc.modelProbability > doc.marketPrice
          return bettingYes ? doc.outcome === true : doc.outcome === false
        }).length / bucket.length
      : 0

    return {
      bin: `${Math.round(min * 100)}-${Math.round(Math.min(max, 1) * 100)}%`,
      count: bucket.length,
      marketYesRate: pct(marketYesRate),
      tradeWinRate: pct(tradeWinRate),
    }
  })

  const yesBets = clean.filter((doc) => doc.modelProbability > doc.marketPrice)
  const noBets = clean.filter((doc) => doc.modelProbability <= doc.marketPrice)
  const yesBetWinRate = yesBets.length > 0 ? yesBets.filter((doc) => doc.outcome === true).length / yesBets.length : 0
  const noBetWinRate = noBets.length > 0 ? noBets.filter((doc) => doc.outcome === false).length / noBets.length : 0

  console.log(JSON.stringify({
    lookbackDays: LOOKBACK_DAYS,
    maxForecastErrorF: MAX_FORECAST_ERROR_F,
    totalSignals: docs.length,
    cleanSignals: clean.length,
    yesBets: yesBets.length,
    noBets: noBets.length,
    yesBetWinRate: pct(yesBetWinRate),
    noBetWinRate: pct(noBetWinRate),
    baseYesRate: pct(clean.filter((doc) => doc.outcome === true).length / Math.max(clean.length, 1)),
    rows,
  }, null, 2))
}

main()
  .then(() => closeClient())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[audit-clean-signals] Fatal:', err)
    closeClient().finally(() => process.exit(1))
  })