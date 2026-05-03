// Late-Day Arbitrage — Forward-Data Analysis
//
// Reads accumulated `kalshi_late_day_snapshots` and produces 5 sub-analyses:
//   1. Gap distribution by minutes-to-window-end
//   2. Decided-bracket pricing accuracy
//   3. Hypothetical EV simulation after fees
//   4. Orderbook context at large gaps (thin vs stacked)
//   5. σ-heuristic consistency (Brier across σ1/σ2/σ3)
//
// Outputs a markdown report. Run:
//   tsx scripts/analyze-late-day-arb.ts > docs/work/late-day-arb-analysis-2026-05-03.md
//
// Optional filter: --since=YYYY-MM-DD to limit to recent snapshots.

import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })
dotenv.config()

import { getDb, closeClient } from '../src/lib/db/mongodb'
import { DEFAULT_FEE_RATE } from '../src/lib/models/weatherProbability'
import { CITY_COORDS } from '../src/lib/utils/cityCoordinates'

const COLLECTION = 'kalshi_late_day_snapshots'
const DECIDED_TAU = 0.95          // obs-implied prob threshold for treating a bracket as locked
const ACTIONABLE_GAP = 0.03       // |gap| ≥ 3¢ to consider a trade
const LARGE_GAP = 0.05            // |gap| ≥ 5¢ for "real edge candidate"
const KALSHI_API_BASE = 'https://api.elections.kalshi.com/trade-api/v2'
const SLEEP_BETWEEN_REQUESTS_MS = 250
const IOWA_USER_AGENT = 'KardashevNetwork analyze-late-day-arb/1.0'

interface SnapshotDoc {
  _id: string
  ticker: string
  eventTicker: string
  cityCode: string
  marketType: string
  bracketKind: string
  bracketLow: number | null
  bracketHigh: number | null
  timestamp: number
  resolvesAt: number
  windowStartUtcMs: number
  windowEndUtcMs: number
  minutesToWindowEnd: number
  yesBid: number | null
  yesAsk: number | null
  lastPrice: number | null
  yesVolume: number | null
  yesOpenInterest: number | null
  yesBookDepth: Array<[number, number]>
  noBookDepth: Array<[number, number]>
  spread: number | null
  midPrice: number | null
  observedSoFar: number | null
  observedAtTs: number | null
  observationSource: string | null
  observationCount: number | null
  bracketDecided: boolean
  obsImpliedYesProb_sigma1: number | null
  obsImpliedYesProb_sigma2: number | null
  obsImpliedYesProb_sigma3: number | null
  priceVsObsGap_sigma2: number | null
}

function parseSinceArg(): number | null {
  const arg = process.argv.find(a => a.startsWith('--since='))
  if (!arg) return null
  const value = arg.split('=')[1]
  const n = Number(value)
  if (isFinite(n) && n > 0) return n
  const ms = new Date(value).getTime()
  return isFinite(ms) ? ms : null
}

const skipResolution = process.argv.includes('--skip-resolution')

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

interface ResolvedKalshiMarket {
  ticker: string
  status: string                          // 'finalized' | 'active' | 'settled' | etc.
  result: string                          // 'yes' | 'no' | '' (unresolved)
  expiration_value?: string               // settlement value as dollar-string (e.g. "61.00" for °F)
}

async function fetchResolvedKalshiMarket(ticker: string): Promise<ResolvedKalshiMarket | null> {
  const url = `${KALSHI_API_BASE}/markets/${ticker}`
  try {
    const resp = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!resp.ok) return null
    const data = await resp.json() as { market?: ResolvedKalshiMarket }
    return data.market ?? null
  } catch {
    return null
  }
}

interface UnifiedObservation { timestampMs: number; temperatureF: number }

async function fetchIowaAsosObservations(
  station: string,
  startUtcMs: number,
  endUtcMs: number,
): Promise<UnifiedObservation[]> {
  const queryStart = new Date(startUtcMs - 24 * 3600_000)
  const queryEnd = new Date(endUtcMs + 24 * 3600_000)
  const qs = new URLSearchParams({
    station, data: 'tmpf',
    year1: String(queryStart.getUTCFullYear()),
    month1: String(queryStart.getUTCMonth() + 1),
    day1: String(queryStart.getUTCDate()),
    year2: String(queryEnd.getUTCFullYear()),
    month2: String(queryEnd.getUTCMonth() + 1),
    day2: String(queryEnd.getUTCDate()),
    tz: 'Etc/UTC', format: 'onlycomma', latlon: 'no', elev: 'no',
    missing: 'M', trace: 'T',
  })
  const url = `https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?${qs.toString()}`
  const res = await fetch(url, { headers: { 'User-Agent': IOWA_USER_AGENT, Accept: 'text/csv' } })
  if (!res.ok) return []
  const body = await res.text()
  const lines = body.split('\n')
  if (lines.length < 2) return []
  const out: UnifiedObservation[] = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    const parts = line.split(',')
    if (parts.length < 3) continue
    const valid = parts[1]
    const tmpfRaw = parts[2]
    if (tmpfRaw === 'M' || tmpfRaw === '') continue
    const t = parseFloat(tmpfRaw)
    if (!isFinite(t)) continue
    const m = valid.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/)
    if (!m) continue
    const ts = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])
    if (ts < startUtcMs || ts >= endUtcMs) continue
    out.push({ timestampMs: ts, temperatureF: t })
  }
  return out
}

function fmtPct(n: number): string {
  return (n * 100).toFixed(1) + '%'
}

function fmtCents(n: number): string {
  const sign = n >= 0 ? '+' : ''
  return sign + (n * 100).toFixed(2) + '¢'
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * q))
  return sorted[idx]
}

function bookDepthTotal(book: Array<[number, number]> | null | undefined): number {
  if (!Array.isArray(book)) return 0
  return book.reduce((sum, [, qty]) => sum + (Number(qty) || 0), 0)
}

async function main() {
  const since = parseSinceArg()

  const db = await getDb()
  const col = db.collection<SnapshotDoc>(COLLECTION)

  const filter: Record<string, unknown> = {}
  if (since) filter.timestamp = { $gte: since }

  const all = await col.find(filter).toArray()
  if (all.length === 0) {
    console.log('# Late-Day Arb Analysis — No snapshots found')
    await closeClient()
    return
  }

  const oldestTs = Math.min(...all.map(d => d.timestamp))
  const newestTs = Math.max(...all.map(d => d.timestamp))
  const decided = all.filter(d => d.bracketDecided === true)

  console.log('# Late-Day Arbitrage — Forward-Data Analysis')
  console.log()
  console.log(`Generated: ${new Date().toISOString()}`)
  console.log()
  console.log('## Sample summary')
  console.log()
  console.log(`- Total snapshots: **${all.length.toLocaleString()}**`)
  console.log(`- Decided (obs locks bracket): **${decided.length.toLocaleString()}** (${fmtPct(decided.length / all.length)})`)
  console.log(`- Time range: ${new Date(oldestTs).toISOString()} → ${new Date(newestTs).toISOString()}`)
  console.log(`- Span: ${((newestTs - oldestTs) / 3600000).toFixed(1)}h`)
  console.log(`- Unique tickers: ${new Set(all.map(d => d.ticker)).size}`)
  console.log(`- Unique events: ${new Set(all.map(d => d.eventTicker)).size}`)
  console.log(`- Cities × types: ${new Set(all.map(d => `${d.cityCode}/${d.marketType}`)).size}`)
  if (since) console.log(`- Since filter: ${new Date(since).toISOString()}`)
  console.log()

  // ==========================================================================
  // Analysis 1 — Gap distribution by minutes-to-window-end
  // ==========================================================================

  console.log('## Analysis 1 — Gap distribution by minutes-to-window-end')
  console.log()
  console.log('Tests whether mispricings widen or narrow as resolution approaches.')
  console.log('`gap = midPrice − obsImpliedYesProb_sigma2`. Positive = market priced higher than obs implies.')
  console.log()

  const buckets: Array<{ label: string; lo: number; hi: number }> = [
    { label: '0-30',   lo: 0,   hi: 30  },
    { label: '30-60',  lo: 30,  hi: 60  },
    { label: '60-120', lo: 60,  hi: 120 },
    { label: '120-240', lo: 120, hi: 240 },
    { label: '240-360', lo: 240, hi: 360 },
    { label: 'past-window', lo: -Infinity, hi: 0 },
  ]

  console.log('| Min-to-window-end | n | mean gap | median |gap| | p95 |gap| | ≥5¢ count |')
  console.log('|---|---:|---:|---:|---:|---:|')
  for (const b of buckets) {
    const group = decided.filter(d =>
      typeof d.minutesToWindowEnd === 'number' &&
      d.minutesToWindowEnd >= b.lo && d.minutesToWindowEnd < b.hi &&
      typeof d.priceVsObsGap_sigma2 === 'number',
    )
    if (group.length === 0) {
      console.log(`| ${b.label} | 0 | — | — | — | 0 |`)
      continue
    }
    const gaps = group.map(d => d.priceVsObsGap_sigma2 as number)
    const mean = gaps.reduce((s, g) => s + g, 0) / gaps.length
    const absSorted = gaps.map(Math.abs).sort((a, b) => a - b)
    const median = quantile(absSorted, 0.5)
    const p95 = quantile(absSorted, 0.95)
    const big = gaps.filter(g => Math.abs(g) >= LARGE_GAP).length
    console.log(`| ${b.label} | ${group.length} | ${fmtCents(mean)} | ${fmtCents(median)} | ${fmtCents(p95)} | ${big} |`)
  }
  console.log()

  // ==========================================================================
  // Analysis 2 — Decided-bracket pricing accuracy
  // ==========================================================================

  console.log('## Analysis 2 — Decided-bracket pricing accuracy')
  console.log()
  console.log('For snapshots where observation locks the outcome, where does the market price?')
  console.log('Efficient market: P(midPrice) → 1 when obs implies YES, → 0 when obs implies NO.')
  console.log()

  const decidedYes = decided.filter(d =>
    typeof d.obsImpliedYesProb_sigma2 === 'number' &&
    d.obsImpliedYesProb_sigma2 >= DECIDED_TAU &&
    typeof d.midPrice === 'number',
  )
  const decidedNo = decided.filter(d =>
    typeof d.obsImpliedYesProb_sigma2 === 'number' &&
    d.obsImpliedYesProb_sigma2 <= 1 - DECIDED_TAU &&
    typeof d.midPrice === 'number',
  )

  function priceStats(label: string, group: SnapshotDoc[], expectedSide: 'YES' | 'NO') {
    if (group.length === 0) {
      console.log(`- **${label}** — n=0`)
      return
    }
    const prices = group.map(d => d.midPrice as number).sort((a, b) => a - b)
    const mean = prices.reduce((s, p) => s + p, 0) / prices.length
    const median = quantile(prices, 0.5)
    const minP = prices[0]
    const maxP = prices[prices.length - 1]
    const target = expectedSide === 'YES' ? 1.0 : 0.0
    const within3c = prices.filter(p => Math.abs(p - target) <= 0.03).length
    console.log(`- **${label}** — n=${group.length}`)
    console.log(`  - mean=${fmtCents(mean)} | median=${fmtCents(median)} | range=[${fmtCents(minP)}, ${fmtCents(maxP)}]`)
    console.log(`  - within 3¢ of ${expectedSide === 'YES' ? '$1.00' : '$0.00'} (efficient): ${within3c} (${fmtPct(within3c / prices.length)})`)
  }

  priceStats('Obs implies YES (P ≥ 0.95)', decidedYes, 'YES')
  priceStats('Obs implies NO (P ≤ 0.05)', decidedNo, 'NO')
  console.log()

  // ==========================================================================
  // Analysis 3 — Hypothetical EV simulation after fees
  // ==========================================================================

  console.log('## Analysis 3 — Hypothetical EV simulation after fees')
  console.log()
  console.log(`Strategy: at each snapshot where bracket is decided AND |gap| ≥ ${(ACTIONABLE_GAP * 100).toFixed(0)}¢, take the side that observation predicts.`)
  console.log(`Fees: ${(DEFAULT_FEE_RATE * 100).toFixed(0)}% of profit on winning trades only. Loss = -cost (full stake at risk).`)
  console.log(`Outcome proxy: when obs-implied prob ≥ ${DECIDED_TAU}, treat outcome as YES; ≤ ${1 - DECIDED_TAU}, treat as NO.`)
  console.log()

  type Trade = {
    direction: 'BUY_YES' | 'SELL_YES'
    fillPrice: number    // cost basis per contract
    won: boolean
    pnl: number
    gap: number          // signed gap at trade time
    minutesToEnd: number
  }

  function simulateTrade(d: SnapshotDoc): Trade | null {
    if (!d.bracketDecided) return null
    const obsP = d.obsImpliedYesProb_sigma2
    const gap = d.priceVsObsGap_sigma2
    if (typeof obsP !== 'number' || typeof gap !== 'number') return null
    if (Math.abs(gap) < ACTIONABLE_GAP) return null
    const ask = d.yesAsk
    const bid = d.yesBid
    if (typeof ask !== 'number' || typeof bid !== 'number') return null

    const obsImpliesYes = obsP >= DECIDED_TAU
    const obsImpliesNo = obsP <= 1 - DECIDED_TAU
    if (!obsImpliesYes && !obsImpliesNo) return null

    if (obsImpliesYes && gap < 0) {
      // Market underpricing YES → buy YES at ask
      const cost = ask
      if (cost <= 0 || cost >= 1) return null
      const won = true   // proxy: obs implies YES → outcome YES
      const pnl = won ? (1 - cost) * (1 - DEFAULT_FEE_RATE) : -cost
      return { direction: 'BUY_YES', fillPrice: cost, won, pnl, gap, minutesToEnd: d.minutesToWindowEnd }
    }
    if (obsImpliesNo && gap > 0) {
      // Market overpricing YES → sell YES (buy NO at 1-bid)
      const cost = 1 - bid
      if (cost <= 0 || cost >= 1) return null
      const won = true   // proxy: obs implies NO → outcome NO → NO position wins
      const pnl = won ? (1 - cost) * (1 - DEFAULT_FEE_RATE) : -cost
      return { direction: 'SELL_YES', fillPrice: cost, won, pnl, gap, minutesToEnd: d.minutesToWindowEnd }
    }
    return null
  }

  // Per-snapshot EV (one trade per minute per ticker — upper bound on opportunity)
  const allTrades: Trade[] = []
  for (const d of decided) {
    const t = simulateTrade(d)
    if (t) allTrades.push(t)
  }

  // Per-ticker EV (one trade per ticker — pick latest snapshot meeting gate)
  const byTicker = new Map<string, SnapshotDoc>()
  for (const d of decided) {
    const t = simulateTrade(d)
    if (!t) continue
    const prev = byTicker.get(d.ticker)
    if (!prev || d.timestamp > prev.timestamp) byTicker.set(d.ticker, d)
  }
  const tickerTrades: Trade[] = []
  for (const d of byTicker.values()) {
    const t = simulateTrade(d)
    if (t) tickerTrades.push(t)
  }

  function evReport(label: string, trades: Trade[]) {
    if (trades.length === 0) {
      console.log(`- **${label}** — n=0 (no actionable opportunities)`)
      return
    }
    const totalPnl = trades.reduce((s, t) => s + t.pnl, 0)
    const wins = trades.filter(t => t.won).length
    const meanPnl = totalPnl / trades.length
    const meanFill = trades.reduce((s, t) => s + t.fillPrice, 0) / trades.length
    const meanGap = trades.reduce((s, t) => s + Math.abs(t.gap), 0) / trades.length
    const buyCount = trades.filter(t => t.direction === 'BUY_YES').length
    const sellCount = trades.filter(t => t.direction === 'SELL_YES').length
    console.log(`- **${label}**`)
    console.log(`  - n=${trades.length} (BUY_YES=${buyCount}, SELL_YES=${sellCount})`)
    console.log(`  - Win rate: ${fmtPct(wins / trades.length)} (proxy outcome)`)
    console.log(`  - Total P&L: $${totalPnl.toFixed(2)} per contract-equivalent`)
    console.log(`  - **Mean P&L per trade: ${fmtCents(meanPnl)}**`)
    console.log(`  - Mean fill price: ${fmtCents(meanFill)} | Mean |gap|: ${fmtCents(meanGap)}`)
  }

  evReport('Per-snapshot (every minute, every ticker)', allTrades)
  console.log()
  evReport('Per-ticker (one trade per ticker, latest decided snapshot)', tickerTrades)
  console.log()
  console.log('> ⚠️  Outcome here is proxied from `obsImpliedYesProb_sigma2`. Both BUY_YES and SELL_YES legs always "win" by construction (obs implies the side we take). Real-world deviation comes from σ-model error: cases where σ-implied 0.99+ confidence is wrong. Validating against actual `resolvedOutcome` requires waiting for snapshot tickers to resolve and joining via `market_predictions` or Kalshi resolution feed.')
  console.log()

  // EV by gap-magnitude bucket
  console.log('### EV by gap magnitude (per-snapshot)')
  console.log()
  console.log('| |gap| range | n | win rate | mean P&L/trade |')
  console.log('|---|---:|---:|---:|')
  const gapBuckets = [
    { label: '3-5¢',   lo: 0.03, hi: 0.05 },
    { label: '5-10¢',  lo: 0.05, hi: 0.10 },
    { label: '10-25¢', lo: 0.10, hi: 0.25 },
    { label: '25-50¢', lo: 0.25, hi: 0.50 },
    { label: '50-100¢', lo: 0.50, hi: 1.01 },
  ]
  for (const gb of gapBuckets) {
    const grp = allTrades.filter(t => Math.abs(t.gap) >= gb.lo && Math.abs(t.gap) < gb.hi)
    if (grp.length === 0) {
      console.log(`| ${gb.label} | 0 | — | — |`)
      continue
    }
    const wins = grp.filter(t => t.won).length
    const mean = grp.reduce((s, t) => s + t.pnl, 0) / grp.length
    console.log(`| ${gb.label} | ${grp.length} | ${fmtPct(wins / grp.length)} | ${fmtCents(mean)} |`)
  }
  console.log()

  // ==========================================================================
  // Analysis 4 — Orderbook context at large gaps
  // ==========================================================================

  console.log('## Analysis 4 — Orderbook context at large gaps')
  console.log()
  console.log(`For snapshots with |gap| ≥ ${(LARGE_GAP * 100).toFixed(0)}¢, is the book thin (mechanical mispricing) or stacked (informed disagreement)?`)
  console.log()

  const largeGap = decided.filter(d =>
    typeof d.priceVsObsGap_sigma2 === 'number' && Math.abs(d.priceVsObsGap_sigma2) >= LARGE_GAP,
  )

  if (largeGap.length === 0) {
    console.log('- No large-gap snapshots in sample.')
  } else {
    let thin = 0, mid = 0, stacked = 0
    let yesDepthSum = 0, noDepthSum = 0
    for (const d of largeGap) {
      const yesD = bookDepthTotal(d.yesBookDepth)
      const noD = bookDepthTotal(d.noBookDepth)
      yesDepthSum += yesD
      noDepthSum += noD
      const minSide = Math.min(yesD, noD)
      if (minSide < 10) thin++
      else if (minSide < 100) mid++
      else stacked++
    }
    console.log(`- Total large-gap snapshots: **${largeGap.length}**`)
    console.log(`- Thin (min side <10 contracts): ${thin} (${fmtPct(thin / largeGap.length)}) → mechanical mispricing`)
    console.log(`- Medium (10-100): ${mid} (${fmtPct(mid / largeGap.length)})`)
    console.log(`- Stacked (≥100): ${stacked} (${fmtPct(stacked / largeGap.length)}) → informed disagreement`)
    console.log(`- Mean YES book depth: ${(yesDepthSum / largeGap.length).toFixed(0)} contracts`)
    console.log(`- Mean NO book depth: ${(noDepthSum / largeGap.length).toFixed(0)} contracts`)
  }
  console.log()

  // ==========================================================================
  // Analysis 5 — σ-heuristic consistency (Brier across σ1/σ2/σ3)
  // ==========================================================================

  console.log('## Analysis 5 — σ-heuristic consistency')
  console.log()
  console.log('Brier score on decided cases, treating each σ heuristic as the prediction and the σ2-decided side as the proxy outcome.')
  console.log('Lower Brier = more accurate. If all three σ values converge to identical 0/1 outputs at decision time, all three Briers will be near-zero (saturated).')
  console.log()

  const sigmaDecided = decided.filter(d =>
    typeof d.obsImpliedYesProb_sigma1 === 'number' &&
    typeof d.obsImpliedYesProb_sigma2 === 'number' &&
    typeof d.obsImpliedYesProb_sigma3 === 'number',
  )

  if (sigmaDecided.length === 0) {
    console.log('- No usable snapshots.')
  } else {
    function brierAgainstS2(getProb: (d: SnapshotDoc) => number) {
      let sum = 0
      let n = 0
      for (const d of sigmaDecided) {
        const proxyOutcome = (d.obsImpliedYesProb_sigma2 as number) >= 0.5 ? 1 : 0
        const p = getProb(d)
        sum += (p - proxyOutcome) ** 2
        n++
      }
      return n > 0 ? sum / n : NaN
    }
    const b1 = brierAgainstS2(d => d.obsImpliedYesProb_sigma1 as number)
    const b2 = brierAgainstS2(d => d.obsImpliedYesProb_sigma2 as number)
    const b3 = brierAgainstS2(d => d.obsImpliedYesProb_sigma3 as number)

    let agree = 0
    for (const d of sigmaDecided) {
      const s1 = (d.obsImpliedYesProb_sigma1 as number) >= 0.5 ? 1 : 0
      const s2 = (d.obsImpliedYesProb_sigma2 as number) >= 0.5 ? 1 : 0
      const s3 = (d.obsImpliedYesProb_sigma3 as number) >= 0.5 ? 1 : 0
      if (s1 === s2 && s2 === s3) agree++
    }

    console.log(`- n=${sigmaDecided.length}`)
    console.log(`- σ1 Brier: ${b1.toFixed(4)}`)
    console.log(`- σ2 Brier: ${b2.toFixed(4)} (reference)`)
    console.log(`- σ3 Brier: ${b3.toFixed(4)}`)
    console.log(`- σ1/σ2/σ3 directional agreement: ${agree} / ${sigmaDecided.length} (${fmtPct(agree / sigmaDecided.length)})`)
    console.log()
    console.log('> If agreement → 100%, the three σ heuristics differ only in the *near-boundary* cases (which are excluded from `bracketDecided=true`). This is expected and means σ choice is irrelevant for the late-day arb question — it only matters mid-window.')
  }
  console.log()

  // ==========================================================================
  // Phase 2 — Resolution-joined validation + settlement-source alignment
  // ==========================================================================

  // Per-ticker: latest snapshot (most reliable observed-so-far + obs-implied)
  const latestByTicker = new Map<string, SnapshotDoc>()
  for (const d of all) {
    const prev = latestByTicker.get(d.ticker)
    if (!prev || d.timestamp > prev.timestamp) latestByTicker.set(d.ticker, d)
  }
  const uniqueTickers = [...latestByTicker.keys()]

  type ResolvedJoin = {
    ticker: string
    latest: SnapshotDoc
    kalshi: ResolvedKalshiMarket | null
    iowaExtremeF: number | null
    iowaObsCount: number
  }

  let joinResults: ResolvedJoin[] = []

  if (skipResolution) {
    console.log('## Phase 2 — Resolution-joined validation')
    console.log()
    console.log('_Skipped (`--skip-resolution` flag set)._')
    console.log()
  } else {
    process.stderr.write(`[phase-2] fetching resolved data for ${uniqueTickers.length} tickers...\n`)

    // Step 1: fetch Kalshi /markets/{ticker} for all unique tickers
    const kalshiByTicker = new Map<string, ResolvedKalshiMarket | null>()
    for (let i = 0; i < uniqueTickers.length; i++) {
      const t = uniqueTickers[i]
      const m = await fetchResolvedKalshiMarket(t)
      kalshiByTicker.set(t, m)
      if (i % 50 === 49) process.stderr.write(`[phase-2] kalshi ${i + 1}/${uniqueTickers.length}\n`)
      await sleep(SLEEP_BETWEEN_REQUESTS_MS)
    }

    // Step 2: fetch Iowa observations once per (cityCode, weatherDate-window)
    const iowaCache = new Map<string, UnifiedObservation[]>()
    type IowaKey = { cityCode: string; windowStartUtcMs: number; windowEndUtcMs: number }
    const iowaKeys = new Map<string, IowaKey>()
    for (const d of latestByTicker.values()) {
      const key = `${d.cityCode}:${d.windowStartUtcMs}`
      if (!iowaKeys.has(key)) {
        iowaKeys.set(key, {
          cityCode: d.cityCode,
          windowStartUtcMs: d.windowStartUtcMs,
          windowEndUtcMs: d.windowEndUtcMs,
        })
      }
    }
    process.stderr.write(`[phase-2] fetching Iowa obs for ${iowaKeys.size} (city, window) pairs...\n`)
    let iowaCount = 0
    for (const [key, iw] of iowaKeys.entries()) {
      const cityInfo = CITY_COORDS[iw.cityCode]
      const station = cityInfo?.resolutionStation
      // Only fetch if window has fully elapsed (otherwise Iowa data is partial).
      if (!station || Date.now() < iw.windowEndUtcMs) {
        iowaCache.set(key, [])
      } else {
        try {
          const obs = await fetchIowaAsosObservations(station, iw.windowStartUtcMs, iw.windowEndUtcMs)
          iowaCache.set(key, obs)
        } catch {
          iowaCache.set(key, [])
        }
        await sleep(SLEEP_BETWEEN_REQUESTS_MS)
      }
      iowaCount++
      if (iowaCount % 10 === 0) process.stderr.write(`[phase-2] iowa ${iowaCount}/${iowaKeys.size}\n`)
    }

    // Step 3: join
    for (const [ticker, latest] of latestByTicker.entries()) {
      const kalshi = kalshiByTicker.get(ticker) ?? null
      const obsKey = `${latest.cityCode}:${latest.windowStartUtcMs}`
      const obs = iowaCache.get(obsKey) ?? []
      let extreme: number | null = null
      if (obs.length > 0) {
        if (latest.marketType === 'temperature-high') {
          extreme = Math.max(...obs.map(o => o.temperatureF))
        } else if (latest.marketType === 'temperature-low') {
          extreme = Math.min(...obs.map(o => o.temperatureF))
        }
      }
      joinResults.push({ ticker, latest, kalshi, iowaExtremeF: extreme, iowaObsCount: obs.length })
    }

    // ----- Phase 2a: resolution-joined validation -----

    const resolved = joinResults.filter(j => j.kalshi && (j.kalshi.result === 'yes' || j.kalshi.result === 'no'))
    const decidedResolved = resolved.filter(j =>
      j.latest.bracketDecided === true &&
      typeof j.latest.obsImpliedYesProb_sigma2 === 'number',
    )

    console.log('## Phase 2a — Resolution-joined validation')
    console.log()
    console.log(`Of ${uniqueTickers.length} unique tickers, **${resolved.length}** have actual Kalshi resolutions (status finalized/settled).`)
    console.log(`Of those, **${decidedResolved.length}** were classified \`bracketDecided=true\` at probe time.`)
    console.log()

    if (decidedResolved.length === 0) {
      console.log('- No resolved decided cases yet — re-run after window-end of more tickers.')
    } else {
      let matches = 0
      let yesWhenObsYes = 0, yesObsTotal = 0
      let noWhenObsNo = 0, noObsTotal = 0
      let brierSum = 0
      for (const j of decidedResolved) {
        const obsP = j.latest.obsImpliedYesProb_sigma2 as number
        const actual = j.kalshi!.result === 'yes' ? 1 : 0
        const obsImpliesYes = obsP >= DECIDED_TAU
        const obsImpliesNo = obsP <= 1 - DECIDED_TAU
        if (obsImpliesYes) {
          yesObsTotal++
          if (actual === 1) yesWhenObsYes++
        }
        if (obsImpliesNo) {
          noObsTotal++
          if (actual === 0) noWhenObsNo++
        }
        if ((obsImpliesYes && actual === 1) || (obsImpliesNo && actual === 0)) matches++
        brierSum += (obsP - actual) ** 2
      }
      const brier = brierSum / decidedResolved.length
      console.log(`- Overall match rate (obs-implied direction = actual outcome): **${fmtPct(matches / decidedResolved.length)}** (${matches}/${decidedResolved.length})`)
      console.log(`- When obs implies YES (P ≥ ${DECIDED_TAU}): actual YES rate ${yesObsTotal > 0 ? fmtPct(yesWhenObsYes / yesObsTotal) : 'n/a'} (${yesWhenObsYes}/${yesObsTotal})`)
      console.log(`- When obs implies NO  (P ≤ ${1 - DECIDED_TAU}): actual NO  rate ${noObsTotal > 0 ? fmtPct(noWhenObsNo / noObsTotal) : 'n/a'} (${noWhenObsNo}/${noObsTotal})`)
      console.log(`- **Brier score (obs-implied σ2 vs actual outcome): ${brier.toFixed(4)}**`)
      console.log()

      // Re-simulate trades using REAL outcomes
      type RealTrade = { fillPrice: number; won: boolean; pnl: number; gap: number }
      const realTrades: RealTrade[] = []
      for (const j of decidedResolved) {
        const d = j.latest
        const obsP = d.obsImpliedYesProb_sigma2 as number
        const gap = d.priceVsObsGap_sigma2
        const ask = d.yesAsk, bid = d.yesBid
        if (typeof gap !== 'number' || typeof ask !== 'number' || typeof bid !== 'number') continue
        if (Math.abs(gap) < ACTIONABLE_GAP) continue
        const actual = j.kalshi!.result === 'yes' ? 1 : 0
        if (obsP >= DECIDED_TAU && gap < 0) {
          const cost = ask
          if (cost <= 0 || cost >= 1) continue
          const won = actual === 1
          const pnl = won ? (1 - cost) * (1 - DEFAULT_FEE_RATE) : -cost
          realTrades.push({ fillPrice: cost, won, pnl, gap })
        } else if (obsP <= 1 - DECIDED_TAU && gap > 0) {
          const cost = 1 - bid
          if (cost <= 0 || cost >= 1) continue
          const won = actual === 0
          const pnl = won ? (1 - cost) * (1 - DEFAULT_FEE_RATE) : -cost
          realTrades.push({ fillPrice: cost, won, pnl, gap })
        }
      }
      console.log('### Phase 2a EV — actual outcomes')
      console.log()
      if (realTrades.length === 0) {
        console.log('- n=0 actionable trades among resolved cases.')
      } else {
        const wins = realTrades.filter(t => t.won).length
        const totalPnl = realTrades.reduce((s, t) => s + t.pnl, 0)
        const meanPnl = totalPnl / realTrades.length
        console.log(`- n=${realTrades.length}`)
        console.log(`- **Real win rate: ${fmtPct(wins / realTrades.length)}** (${wins}/${realTrades.length})`)
        console.log(`- Total P&L: $${totalPnl.toFixed(2)} per contract-equivalent`)
        console.log(`- **Mean P&L per trade (real): ${fmtCents(meanPnl)}**`)
      }
    }
    console.log()

    // ----- Phase 2b: settlement-source alignment -----

    console.log('## Phase 2b — Settlement-source alignment (Iowa ASOS vs Kalshi)')
    console.log()
    console.log('For each resolved ticker with completed window, compare Iowa-observed extreme to Kalshi `expected_expiration_value`.')
    console.log('If the two sources diverge by ≥0.5°F on boundary cases, our "decided" classification can be wrong.')
    console.log()

    const parseExpirationValue = (s: string | undefined): number | null => {
      if (!s) return null
      const n = parseFloat(s)
      return isFinite(n) ? n : null
    }
    const aligned = joinResults.filter(j =>
      j.kalshi && (j.kalshi.result === 'yes' || j.kalshi.result === 'no') &&
      parseExpirationValue(j.kalshi.expiration_value) !== null &&
      typeof j.iowaExtremeF === 'number',
    )

    if (aligned.length === 0) {
      console.log('- No resolved tickers with both Kalshi value and Iowa extreme available yet.')
    } else {
      // Dedup by (cityCode, weatherDate, marketType) — same Iowa extreme reused across all brackets in an event
      const byEvent = new Map<string, ResolvedJoin>()
      for (const j of aligned) {
        const key = `${j.latest.cityCode}:${j.latest.windowStartUtcMs}:${j.latest.marketType}`
        if (!byEvent.has(key)) byEvent.set(key, j)
      }
      const events = [...byEvent.values()]
      const deltas: number[] = []
      const overOneDeg: ResolvedJoin[] = []
      for (const j of events) {
        const kalshiVal = parseExpirationValue(j.kalshi!.expiration_value) as number
        const delta = kalshiVal - (j.iowaExtremeF as number)
        deltas.push(delta)
        if (Math.abs(delta) >= 1.0) overOneDeg.push(j)
      }
      const sorted = [...deltas].sort((a, b) => a - b)
      const mean = deltas.reduce((s, d) => s + d, 0) / deltas.length
      const meanAbs = deltas.reduce((s, d) => s + Math.abs(d), 0) / deltas.length
      console.log(`- Events compared: **${events.length}** (${aligned.length} resolved tickers, deduped to one per event)`)
      console.log(`- Mean Δ (Kalshi − Iowa): ${mean >= 0 ? '+' : ''}${mean.toFixed(2)}°F`)
      console.log(`- Mean |Δ|: ${meanAbs.toFixed(2)}°F`)
      console.log(`- |Δ| range: [${Math.min(...deltas).toFixed(2)}, ${Math.max(...deltas).toFixed(2)}]°F`)
      console.log(`- p50 |Δ|: ${Math.abs(sorted[Math.floor(deltas.length * 0.5)]).toFixed(2)}°F`)
      console.log(`- p95 |Δ|: ${Math.abs(sorted[Math.floor(deltas.length * 0.95)]).toFixed(2)}°F`)
      console.log(`- Cases with |Δ| ≥ 1°F: **${overOneDeg.length}** (${fmtPct(overOneDeg.length / events.length)})`)
      console.log()

      if (overOneDeg.length > 0) {
        console.log('### Drift cases (|Δ| ≥ 1°F)')
        console.log()
        console.log('| City | Type | Iowa extreme | Kalshi value | Δ |')
        console.log('|---|---|---:|---:|---:|')
        for (const j of overOneDeg.slice(0, 20)) {
          const k = parseExpirationValue(j.kalshi!.expiration_value) as number
          const i = j.iowaExtremeF as number
          console.log(`| ${j.latest.cityCode} | ${j.latest.marketType} | ${i.toFixed(2)}°F | ${k.toFixed(2)}°F | ${(k - i >= 0 ? '+' : '')}${(k - i).toFixed(2)}°F |`)
        }
        if (overOneDeg.length > 20) console.log(`\n_(showing 20 of ${overOneDeg.length})_`)
      }
    }
    console.log()
  }

  // ==========================================================================
  // Recommendation
  // ==========================================================================

  const meanPerTrade = allTrades.length > 0
    ? allTrades.reduce((s, t) => s + t.pnl, 0) / allTrades.length
    : 0
  const meanPerTicker = tickerTrades.length > 0
    ? tickerTrades.reduce((s, t) => s + t.pnl, 0) / tickerTrades.length
    : 0

  // Compute real-outcome metrics if Phase 2 ran
  let realMean: number | null = null
  let realN = 0
  let realWinRate: number | null = null
  if (!skipResolution) {
    const resolved = joinResults.filter(j => j.kalshi && (j.kalshi.result === 'yes' || j.kalshi.result === 'no'))
    const decidedResolved = resolved.filter(j =>
      j.latest.bracketDecided === true &&
      typeof j.latest.obsImpliedYesProb_sigma2 === 'number',
    )
    const realPnls: number[] = []
    let wins = 0
    for (const j of decidedResolved) {
      const d = j.latest
      const obsP = d.obsImpliedYesProb_sigma2 as number
      const gap = d.priceVsObsGap_sigma2
      const ask = d.yesAsk, bid = d.yesBid
      if (typeof gap !== 'number' || typeof ask !== 'number' || typeof bid !== 'number') continue
      if (Math.abs(gap) < ACTIONABLE_GAP) continue
      const actual = j.kalshi!.result === 'yes' ? 1 : 0
      let cost: number | null = null, won = false
      if (obsP >= DECIDED_TAU && gap < 0) {
        cost = ask
        won = actual === 1
      } else if (obsP <= 1 - DECIDED_TAU && gap > 0) {
        cost = 1 - bid
        won = actual === 0
      }
      if (cost == null || cost <= 0 || cost >= 1) continue
      const pnl = won ? (1 - cost) * (1 - DEFAULT_FEE_RATE) : -cost
      realPnls.push(pnl)
      if (won) wins++
    }
    realN = realPnls.length
    if (realN > 0) {
      realMean = realPnls.reduce((s, p) => s + p, 0) / realN
      realWinRate = wins / realN
    }
  }

  console.log('## Recommendation')
  console.log()
  console.log('### Proxy outcomes (σ2-derived; tautological)')
  console.log(`- Per-snapshot mean P&L: ${fmtCents(meanPerTrade)} (n=${allTrades.length})`)
  console.log(`- Per-ticker mean P&L: ${fmtCents(meanPerTicker)} (n=${tickerTrades.length})`)
  console.log()
  if (realMean != null) {
    console.log('### Real outcomes (Kalshi-resolved; load-bearing)')
    console.log(`- n=${realN}`)
    console.log(`- Win rate: ${fmtPct(realWinRate as number)}`)
    console.log(`- **Mean P&L per trade: ${fmtCents(realMean)}**`)
    console.log()
    if (realMean >= 0.05) {
      console.log('> **PROCEED** — real-outcome mean ≥ 5¢/trade. Scope the execution module (Phase 5).')
    } else if (realMean > 0) {
      console.log('> **CONTINUE** — real-outcome EV positive but small. Let the probe accumulate another late-window cycle and re-validate.')
    } else {
      console.log('> **KILL** — real-outcome EV is negative after fees. The σ2-implied "decided" classification overstates confidence; on YES-side cases especially, ground-truth disagrees often enough to wipe out the gap. Hypothesis disproven.')
    }
  } else {
    console.log('### Real outcomes')
    console.log()
    console.log('_Not yet available — re-run after more snapshot tickers resolve._')
    console.log()
    console.log('> **PENDING** — proxy numbers above are tautological by construction. Withhold go/no-go until real outcomes are joined.')
  }
  console.log()
  console.log('### Caveats')
  console.log('- Sample window is short — data spans a single late-window cycle. Re-run after another 24h for stability check.')
  console.log('- Per-snapshot column overstates throughput: in practice you cannot trade every minute on every ticker simultaneously.')
  console.log('- Fees modeled at flat 10% of profit on wins. Kalshi\'s actual fee schedule has tier breakpoints that may differ at small contract sizes.')
  console.log('- Settlement-source: Kalshi resolves on NWS Climatological Report (city-specific station); our σ-implied prob uses Iowa Mesonet ASOS for the same station. Phase 2b quantifies any drift.')

  await closeClient()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
