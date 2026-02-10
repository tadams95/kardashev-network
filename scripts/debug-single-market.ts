// Debug a single market to verify data quality
import { loadHistoricalMarkets, fetchHistoricalWeather } from '../src/lib/backtesting/dataLoader'

async function debugMarket() {
  const markets = await loadHistoricalMarkets('./data/weather/kalshi_real_2024.csv')
  const sample = markets[0]  // NY on 2024-09-29, above 72

  console.log('Sample Market:')
  console.log('  Ticker:', sample.kalshiId)
  console.log('  Date:', sample.date)
  console.log('  City:', sample.location.city, '(' + sample.location.lat + ',' + sample.location.lng + ')')
  console.log('  Market:', sample.marketType, sample.direction, sample.threshold + '°F')
  console.log('  Actual outcome:', sample.outcome ? 'YES' : 'NO')
  console.log('  Market price:', (sample.marketPrice * 100).toFixed(0) + '%')

  console.log('\nFetching actual weather...')
  const weather = await fetchHistoricalWeather(sample.location.lat, sample.location.lng, sample.date)
  console.log('  Actual tempMax:', weather.tempMax + '°F')
  console.log('  Actual tempMin:', weather.tempMin + '°F')

  const actuallyAbove = weather.tempMax > sample.threshold
  console.log('\nDid temp exceed ' + sample.threshold + '°F? ', actuallyAbove ? 'YES' : 'NO')
  console.log('CSV says outcome:', sample.outcome ? 'YES' : 'NO')
  console.log('Match?', actuallyAbove === sample.outcome ? '✅ YES' : '❌ NO')
}

debugMarket().catch(console.error)
