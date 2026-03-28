import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config()

import { getDb, closeClient } from '../src/lib/db/mongodb'

// ============================================================================
// Constants
// ============================================================================

const CLEAN_ERA_EPOCH = 1774051200000
const KALSHI_API_BASE = 'https://api.elections.kalshi.com/trade-api/v2'
const FEE_PER_CONTRACT = 0.018
const CITIES_TO_CHECK = ['NY', 'CHI', 'BOS', 'DAL']

// City code mapping: our codes → Kalshi ticker codes
const KALSHI_CITY_MAP: Record<string, string> = {
  NY: 'NY', CHI: 'CHI', BOS: 'BOS', DAL: 'DAL',
  ATL: 'ATL', AUS: 'AUS', DC: 'DC', DEN: 'DEN',
  HOU: 'HOU', LAX: 'LAX', LV: 'LV', MIA: 'MIA',
  PHIL: 'PHI', PHX: 'PHX', SEA: 'SEA', SFO: 'SF',
}

// ============================================================================
// Helpers
// ============================================================================

function pad(s: string, w: number): string { return s.padEnd(w) }
function padL(s: string, w: number): string { return s.padStart(w) }

function printHeader(title: string): void {
  const line = '═'.repeat(75)
  console.log()
  console.log(line)
  console.log(`  ${title}`)
  console.log(line)
}

function printTable(headers: string[], rows: string[][], colWidths: number[]): void {
  console.log(headers.map((h, i) => i === 0 ? pad(h, colWidths[i]) : padL(h, colWidths[i])).join('  '))
  console.log(colWidths.map(w => '─'.repeat(w)).join('  '))
  for (const row of rows) {
    console.log(row.map((cell, i) => i === 0 ? pad(cell, colWidths[i]) : padL(cell, colWidths[i])).join('  '))
  }
}

function bracketOf(temp: number): number {
  return Math.floor(temp / 2) * 2
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

interface KalshiMarket {
  ticker: string
  event_ticker: string
  yes_bid: number | null
  yes_ask: number | null
  no_bid: number | null
  no_ask: number | null
  volume: number | null
  open_interest: number | null
  floor_strike: number | null
  cap_strike: number | null
  result: string
  status: string
  subtitle?: string
}

// ============================================================================
// Kalshi API
// ============================================================================

async function fetchKalshiMarkets(seriesTicker: string): Promise<KalshiMarket[]> {
  const url = `${KALSHI_API_BASE}/markets?series_ticker=${seriesTicker}&status=active&limit=200`
  const resp = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!resp.ok) {
    console.error(`Kalshi API error: ${resp.status} for ${seriesTicker}`)
    return []
  }
  const data = await resp.json() as { markets: KalshiMarket[] }
  return data.markets || []
}

async function fetchOrderbook(ticker: string): Promise<{ yes: Array<[number, number]>; no: Array<[number, number]> } | null> {
  const url = `${KALSHI_API_BASE}/markets/${ticker}/orderbook`
  try {
    const resp = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!resp.ok) return null
    const data = await resp.json() as { orderbook: { yes: Array<[number, number]>; no: Array<[number, number]> } }
    return data.orderbook || null
  } catch {
    return null
  }
}

// ============================================================================
// Analysis 1: Live Tail Bracket Liquidity
// ============================================================================

async function runAnalysis1(): Promise<void> {
  printHeader('Analysis 1: Live Tail Bracket Liquidity Check')

  const allRows: string[][] = []
  let totalTailBrackets = 0

  for (const cityCode of CITIES_TO_CHECK) {
    const kalshiCode = KALSHI_CITY_MAP[cityCode] || cityCode

    // Fetch active markets for this city (try both KXHIGH and KXHIGHT prefixes)
    let markets: KalshiMarket[] = []
    for (const prefix of ['KXHIGH', 'KXHIGHT']) {
      const m = await fetchKalshiMarkets(`${prefix}${kalshiCode}`)
      markets.push(...m)
      await sleep(300)
    }

    if (markets.length === 0) {
      console.log(`${cityCode}: No active markets found`)
      continue
    }

    // Group by event (day)
    const byEvent = new Map<string, KalshiMarket[]>()
    for (const m of markets) {
      const arr = byEvent.get(m.event_ticker) || []
      arr.push(m)
      byEvent.set(m.event_ticker, arr)
    }

    // For each event day, find the "peak" bracket (highest YES price = most likely)
    // and identify tail brackets (3+ brackets away)
    for (const [eventTicker, eventMarkets] of byEvent) {
      // Parse brackets and find the peak
      const withBrackets = eventMarkets.filter(m => m.floor_strike != null && m.cap_strike != null)
        .map(m => ({
          ...m,
          midpoint: ((m.floor_strike || 0) + (m.cap_strike || 0)) / 2,
          bracketWidth: (m.cap_strike || 0) - (m.floor_strike || 0),
          yesPrice: m.yes_bid != null && m.yes_ask != null ? (m.yes_bid + m.yes_ask) / 200 : null,
        }))
        .sort((a, b) => a.midpoint - b.midpoint)

      if (withBrackets.length === 0) continue

      // Find peak bracket (highest yes_bid)
      let peakIdx = 0
      let peakBid = -1
      for (let i = 0; i < withBrackets.length; i++) {
        const bid = withBrackets[i].yes_bid ?? 0
        if (bid > peakBid) { peakBid = bid; peakIdx = i }
      }

      const peakMid = withBrackets[peakIdx].midpoint
      const bracketWidth = withBrackets[0].bracketWidth || 2

      // Identify tail brackets: 3+ bracket positions from peak
      for (const m of withBrackets) {
        const distBrackets = Math.abs(m.midpoint - peakMid) / bracketWidth
        if (distBrackets < 3) continue

        totalTailBrackets++
        const direction = m.midpoint < peakMid ? 'COLD' : 'WARM'
        const yesBid = m.yes_bid != null ? m.yes_bid : null
        const yesAsk = m.yes_ask != null ? m.yes_ask : null
        const noBid = m.no_bid != null ? m.no_bid : null
        const noAsk = m.no_ask != null ? m.no_ask : null
        const spread = (yesBid != null && yesAsk != null) ? (yesAsk - yesBid) : null

        // Fetch orderbook for depth
        const ob = await fetchOrderbook(m.ticker)
        await sleep(200)

        // NO-side depth: sum of quantities on YES bid side (selling NO = buying YES bid)
        let noSideDepth = 0
        if (ob?.yes) {
          for (const [_price, qty] of ob.yes) noSideDepth += qty
        }

        // Fee estimate on 10-contract NO sell
        // Selling NO at (100 - yes_bid) cents
        const noSellPrice = yesBid != null ? (100 - yesBid) / 100 : null
        const feeOn10 = noSellPrice != null ? (10 * FEE_PER_CONTRACT).toFixed(2) : '-'

        allRows.push([
          cityCode,
          `${m.floor_strike}-${m.cap_strike}°F`,
          `±${distBrackets.toFixed(0)}`,
          direction,
          yesBid != null ? `${yesBid}¢` : '-',
          noAsk != null ? `${noAsk}¢` : '-',
          String(noSideDepth || '-'),
          spread != null ? `${spread}¢` : '-',
          `$${feeOn10}`,
        ])
      }
    }
  }

  if (allRows.length === 0) {
    console.log('No tail brackets found across checked cities.')
    return
  }

  console.log(`Found ${totalTailBrackets} tail brackets (±3+ from peak) across ${CITIES_TO_CHECK.join(', ')}`)
  console.log(`Peak bracket = highest YES bid in each event`)
  console.log()

  printTable(
    ['City', 'Bracket', 'Dist', 'Dir', 'YES bid', 'NO ask', 'Depth', 'Spread', 'Fee/10'],
    allRows,
    [6, 12, 5, 5, 8, 8, 6, 7, 7],
  )
}

// ============================================================================
// Analysis 2: Historical Signal Volume and EV
// ============================================================================

interface TempBiasDoc {
  forecastTemp: number
  actualTemp: number
  error: number
  leadHours?: number
  cityCode: string
  marketType?: string
  marketId?: string
  timestamp: number
}

async function runAnalysis2(): Promise<void> {
  printHeader('Analysis 2: Historical Signal Volume and EV Estimate')

  const db = getDb()
  const docs = await db.collection<TempBiasDoc>('temp_bias')
    .find({
      timestamp: { $gte: CLEAN_ERA_EPOCH },
      marketType: 'high',
      forecastTemp: { $type: 'number' },
      actualTemp: { $type: 'number' },
    } as any)
    .project({ forecastTemp: 1, actualTemp: 1, error: 1, leadHours: 1, cityCode: 1, marketId: 1, timestamp: 1 })
    .toArray()

  console.log(`Clean-era events: ${docs.length}`)

  // ── Step 1: Count qualifying cold-side tail brackets ──

  console.log()
  console.log('Step 1 — Cold-side tail bracket opportunities (±3 to ±7 below forecast):')

  let totalTail = 0
  let totalTail_24_36 = 0
  let totalEvents_24_36 = 0
  const tailByDist: Record<number, { total: number; hits: number }> = {}
  const tailByDist_24_36: Record<number, { total: number; hits: number }> = {}
  const tailByDate: Record<string, number> = {}
  const tailByCity: Record<string, number> = {}

  for (const d of docs) {
    const forecastBracket = bracketOf(d.forecastTemp)
    const actualBracket = bracketOf(d.actualTemp)
    const date = new Date(d.timestamp).toISOString().slice(0, 10)
    const is24_36 = d.leadHours != null && d.leadHours >= 24 && d.leadHours <= 36

    if (is24_36) totalEvents_24_36++

    for (let dist = 3; dist <= 7; dist++) {
      const coldBracket = forecastBracket - dist * 2
      if (coldBracket <= 0 || coldBracket >= 120) continue

      totalTail++
      if (!tailByDist[dist]) tailByDist[dist] = { total: 0, hits: 0 }
      tailByDist[dist].total++
      if (actualBracket === coldBracket) tailByDist[dist].hits++

      if (!tailByDate[date]) tailByDate[date] = 0
      tailByDate[date]++
      if (!tailByCity[d.cityCode]) tailByCity[d.cityCode] = 0
      tailByCity[d.cityCode]++

      if (is24_36) {
        totalTail_24_36++
        if (!tailByDist_24_36[dist]) tailByDist_24_36[dist] = { total: 0, hits: 0 }
        tailByDist_24_36[dist].total++
        if (actualBracket === coldBracket) tailByDist_24_36[dist].hits++
      }
    }
  }

  const numDays = Object.keys(tailByDate).length
  const numCities = Object.keys(tailByCity).length

  // ── Step 2: Daily signal volume ──

  console.log()
  console.log('Step 2 — Signal volume:')
  console.log(`  Total cold-side tail brackets: ${totalTail}`)
  console.log(`  Days in range: ${numDays}`)
  console.log(`  Avg tail brackets/day: ${(totalTail / numDays).toFixed(0)}`)
  console.log(`  Avg tail brackets/city/day: ${(totalTail / numDays / numCities).toFixed(1)}`)
  console.log(`  24-36h subset: ${totalTail_24_36} brackets from ${totalEvents_24_36} events`)
  console.log(`  24-36h avg/day: ${(totalTail_24_36 / numDays).toFixed(0)}`)

  // Per-distance cold-side hit rates
  console.log()
  console.log('Cold-side hit rates by distance (all lead times):')
  printTable(
    ['Distance', 'Opportunities', 'Hits', 'Hit Rate'],
    [3, 4, 5, 6, 7].map(d => {
      const info = tailByDist[d] || { total: 0, hits: 0 }
      return [
        `±${d}`,
        String(info.total),
        String(info.hits),
        info.total > 0 ? (info.hits / info.total * 100).toFixed(2) + '%' : '0%',
      ]
    }),
    [10, 14, 6, 10],
  )

  console.log()
  console.log('Cold-side hit rates by distance (24-36h only):')
  printTable(
    ['Distance', 'Opportunities', 'Hits', 'Hit Rate'],
    [3, 4, 5, 6, 7].map(d => {
      const info = tailByDist_24_36[d] || { total: 0, hits: 0 }
      return [
        `±${d}`,
        String(info.total),
        String(info.hits),
        info.total > 0 ? (info.hits / info.total * 100).toFixed(2) + '%' : '0%',
      ]
    }),
    [10, 14, 6, 10],
  )

  // ── Step 3: EV estimates ──

  console.log()
  console.log('Step 3 — Per-signal EV estimates (cold-side only):')

  const priceAssumptions: Record<number, { lo: number; mid: number; hi: number }> = {
    3: { lo: 0.05, mid: 0.07, hi: 0.10 },
    4: { lo: 0.02, mid: 0.04, hi: 0.05 },
    5: { lo: 0.01, mid: 0.02, hi: 0.03 },
    6: { lo: 0.01, mid: 0.01, hi: 0.02 },
    7: { lo: 0.01, mid: 0.01, hi: 0.02 },
  }

  const evRows: string[][] = []
  for (const dist of [3, 4, 5, 6, 7]) {
    const info = tailByDist[dist] || { total: 0, hits: 0 }
    const hitRate = info.total > 0 ? info.hits / info.total : 0
    const missRate = 1 - hitRate
    const prices = priceAssumptions[dist]

    const evAtMid = missRate * prices.mid - hitRate * (1 - prices.mid) - FEE_PER_CONTRACT
    const evAtLo = missRate * prices.lo - hitRate * (1 - prices.lo) - FEE_PER_CONTRACT
    const evAtHi = missRate * prices.hi - hitRate * (1 - prices.hi) - FEE_PER_CONTRACT

    evRows.push([
      `±${dist}`,
      (hitRate * 100).toFixed(2) + '%',
      `${(prices.lo * 100).toFixed(0)}-${(prices.hi * 100).toFixed(0)}¢`,
      (evAtLo >= 0 ? '+' : '') + evAtLo.toFixed(3),
      (evAtMid >= 0 ? '+' : '') + evAtMid.toFixed(3),
      (evAtHi >= 0 ? '+' : '') + evAtHi.toFixed(3),
    ])
  }

  printTable(
    ['Dist', 'Hit Rate', 'YES range', 'EV (low)', 'EV (mid)', 'EV (high)'],
    evRows,
    [6, 10, 12, 10, 10, 10],
  )

  // ── Step 4: Portfolio-level return ──

  printHeader('Analysis 2 (cont): Portfolio-Level Return Estimates')

  const positionSizes = [10, 50, 100]
  // Use cold-side distance 3-5 combined for portfolio estimates
  let dailySignals = 0
  let weightedEV = 0
  let weightedHitRate = 0
  let totalWeight = 0

  for (const dist of [3, 4, 5]) {
    const info = tailByDist[dist] || { total: 0, hits: 0 }
    const dailyForDist = info.total / numDays
    const hitRate = info.total > 0 ? info.hits / info.total : 0
    const missRate = 1 - hitRate
    const prices = priceAssumptions[dist]
    const ev = missRate * prices.mid - hitRate * (1 - prices.mid) - FEE_PER_CONTRACT

    dailySignals += dailyForDist
    weightedEV += ev * dailyForDist
    weightedHitRate += hitRate * dailyForDist
    totalWeight += dailyForDist
  }

  const avgEVperSignal = totalWeight > 0 ? weightedEV / totalWeight : 0
  const avgHitRate = totalWeight > 0 ? weightedHitRate / totalWeight : 0

  console.log(`Combined ±3-5 cold-side signals:`)
  console.log(`  Daily signals: ${dailySignals.toFixed(1)}`)
  console.log(`  Weighted avg EV/signal: ${avgEVperSignal >= 0 ? '+' : ''}${avgEVperSignal.toFixed(4)}`)
  console.log(`  Weighted avg hit rate: ${(avgHitRate * 100).toFixed(2)}%`)
  console.log()

  const portfolioRows: string[][] = []
  for (const size of positionSizes) {
    const dailyEV = dailySignals * avgEVperSignal * size
    const monthlyEV = dailyEV * 30

    // Worst case: March 28 style NE corridor blowup
    // Count how many ±3-5 cold brackets existed on worst day
    const worstDay = Object.entries(tailByDate).sort((a, b) => b[1] - a[1])[0]
    const worstDaySignals = worstDay ? worstDay[1] : 0
    // If 3% of signals hit (worst case), losses = hits * (1 - avg_yes_price) * size
    // Conservative: assume 10% of worst-day signals hit
    const worstCaseHits = Math.ceil(worstDaySignals * 0.10)
    const avgLossPerHit = 0.95 * size // lose (1 - yes_price) ≈ $0.95 per $1 contract
    const worstDrawdown = worstCaseHits * avgLossPerHit

    portfolioRows.push([
      `$${size}`,
      `$${dailyEV.toFixed(2)}`,
      `$${monthlyEV.toFixed(2)}`,
      `${worstDaySignals}`,
      `${worstCaseHits}`,
      `-$${worstDrawdown.toFixed(2)}`,
    ])
  }

  printTable(
    ['Position', 'Daily EV', 'Monthly EV', 'Worst day sigs', 'Est hits', 'Max drawdown'],
    portfolioRows,
    [10, 10, 12, 16, 10, 14],
  )

  // ── Step 5: Bracket structure verification ──

  printHeader('Analysis 2 (cont): Bracket Structure Verification')

  // Parse bracket widths from actual market tickers
  const tickerSet = new Set<string>()
  for (const d of docs) {
    if (d.marketId) tickerSet.add(d.marketId as string)
  }

  const bracketWidths = new Map<string, number[]>()
  const bracketsByEvent = new Map<string, number[]>()

  for (const ticker of tickerSet) {
    // Parse T## or B## from ticker end
    const match = ticker.match(/-(T|B)(\d+\.?\d*)$/)
    if (!match) continue
    const value = parseFloat(match[2])

    // Extract event part (everything before the bracket suffix)
    const eventPart = ticker.replace(/-(T|B)\d+\.?\d*$/, '')
    if (!bracketsByEvent.has(eventPart)) bracketsByEvent.set(eventPart, [])
    bracketsByEvent.get(eventPart)!.push(value)
  }

  // Compute bracket widths per event
  const widthFreq = new Map<number, number>()
  for (const [event, values] of bracketsByEvent) {
    const sorted = [...new Set(values)].sort((a, b) => a - b)
    for (let i = 1; i < sorted.length; i++) {
      const width = sorted[i] - sorted[i - 1]
      widthFreq.set(width, (widthFreq.get(width) || 0) + 1)
    }
  }

  console.log('Bracket width distribution from market tickers:')
  for (const [width, count] of [...widthFreq.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${width}°F: ${count} gaps`)
  }

  // Check specific events for non-standard widths
  const eventSample = [...bracketsByEvent.entries()].slice(0, 5)
  console.log()
  console.log('Sample event bracket structures:')
  for (const [event, values] of eventSample) {
    const sorted = [...new Set(values)].sort((a, b) => a - b)
    const widths = sorted.slice(1).map((v, i) => v - sorted[i])
    const uniqueWidths = [...new Set(widths)]
    console.log(`  ${event}: ${sorted.length} brackets, widths: ${uniqueWidths.join(', ')}°F`)
    console.log(`    range: ${sorted[0]}-${sorted[sorted.length - 1]}°F`)
  }

  // ── Worst case deep dive ──

  printHeader('Analysis 2 (cont): Worst-Case Blowup Scenario')

  // March 28 deep dive
  const mar28 = docs.filter(d => {
    const date = new Date(d.timestamp).toISOString().slice(0, 10)
    return date === '2026-03-28'
  })

  if (mar28.length > 0) {
    console.log(`March 28, 2026 (worst day in clean era): ${mar28.length} events`)
    console.log()

    // Which cities blew up and by how much?
    const cityErrors: Record<string, { error: number; forecast: number; actual: number; dist: number }[]> = {}
    for (const d of mar28) {
      if (!cityErrors[d.cityCode]) cityErrors[d.cityCode] = []
      cityErrors[d.cityCode].push({
        error: d.error,
        forecast: d.forecastTemp,
        actual: d.actualTemp,
        dist: Math.abs(bracketOf(d.forecastTemp) - bracketOf(d.actualTemp)) / 2,
      })
    }

    console.log('Per-city March 28 misses:')
    const mar28Rows: string[][] = []
    for (const [city, errors] of Object.entries(cityErrors).sort((a, b) =>
      Math.max(...b[1].map(e => Math.abs(e.error))) - Math.max(...a[1].map(e => Math.abs(e.error)))
    )) {
      const maxErr = errors.reduce((max, e) => Math.abs(e.error) > Math.abs(max.error) ? e : max, errors[0])
      const maxDist = Math.max(...errors.map(e => e.dist))
      mar28Rows.push([
        city,
        String(errors.length),
        `${maxErr.forecast.toFixed(0)}°F`,
        `${maxErr.actual.toFixed(0)}°F`,
        `${maxErr.error >= 0 ? '+' : ''}${maxErr.error.toFixed(1)}°F`,
        `±${maxDist}`,
      ])
    }

    printTable(
      ['City', 'Events', 'Forecast', 'Actual', 'Max Error', 'Max Dist'],
      mar28Rows,
      [8, 8, 10, 10, 12, 10],
    )

    // Cold-side tail sell positions that would have been hit
    console.log()
    console.log('Cold-side tail positions that would have blown up:')
    let blownUp = 0
    for (const d of mar28) {
      const forecastBracket = bracketOf(d.forecastTemp)
      const actualBracket = bracketOf(d.actualTemp)
      for (let dist = 3; dist <= 7; dist++) {
        const coldBracket = forecastBracket - dist * 2
        if (coldBracket <= 0) continue
        if (actualBracket === coldBracket) {
          blownUp++
          console.log(`  ${d.cityCode}: forecast ${d.forecastTemp.toFixed(0)}°F, actual ${d.actualTemp.toFixed(0)}°F, cold bracket ${coldBracket}-${coldBracket + 2}°F HIT at ±${dist}`)
        }
      }
    }
    if (blownUp === 0) {
      console.log('  ZERO cold-side tail positions would have been hit on March 28.')
      console.log('  (All March 28 misses were WARM-side: actual > forecast, consistent with cold bias)')
    }
  }
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  await runAnalysis1()
  await runAnalysis2()

  // Final summary
  printHeader('Final Summary')
  console.log('Analysis 1: Live orderbook data for tail brackets across 4 cities')
  console.log('Analysis 2: Historical simulation of cold-side tail sell strategy')
  console.log()
  console.log('Key question answered: Are there enough liquid tail brackets to trade,')
  console.log('and does the historical data support positive EV at available prices?')
  console.log()
}

main()
  .then(() => closeClient())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[audit-tail-liquidity] Fatal:', err)
    closeClient().finally(() => process.exit(1))
  })
