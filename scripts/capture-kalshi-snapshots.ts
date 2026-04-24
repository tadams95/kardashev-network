// Periodic snapshot capture of all active KX-prefix Kalshi events.
// Designed for backtest of the fade-the-tail mass-concentration strategy
// (see working-checklist Phase A under "Fade-the-tail mass-concentration").
//
// Runs via crontab every 30 min, offset 15 min from execute-tail-sells:
//   15,45 * * * * cd /var/www/kardashev && npm run capture-kalshi-snapshots >> /var/log/capture-kalshi-snapshots.log 2>&1
//
// Public Kalshi market data does not require auth. We hit the markets
// endpoint with status=open, group by event, and persist a per-event
// snapshot row to the kalshi_market_snapshots collection.

import { MongoClient } from 'mongodb'
import { extractCityCode, extractMarketType } from '../src/lib/utils/tickerParsing'

const KALSHI_API_BASE = 'https://api.elections.kalshi.com/trade-api/v2'
const RETENTION_DAYS = 90
const PAGE_DELAY_MS = 100
const FETCH_TIMEOUT_MS = 15_000

interface KalshiMarketRaw {
  ticker: string
  event_ticker: string
  status: string
  yes_bid?: number  // cents 0-100
  yes_ask?: number
  no_bid?: number
  no_ask?: number
  last_price?: number  // cents 0-100
  volume?: number
  open_interest?: number
  cap_strike?: number
  floor_strike?: number
  close_time: string
  yes_sub_title: string
}

interface KalshiMarketsResponse {
  markets: KalshiMarketRaw[]
  cursor?: string
}

interface BracketSnapshot {
  ticker: string
  yesBid: number | null    // dollars 0-1
  yesAsk: number | null
  yesPrice: number | null  // best available signal: bid/ask mid, else last_price
  noBid: number | null
  noAsk: number | null
  noPrice: number | null
  lastTradePrice: number | null
  volume: number
  openInterest: number
  floorF: number | null
  capF: number | null
  label: string
}

interface EventSnapshot {
  _id: string                      // `${eventTicker}:${snapshotTime}`
  eventTicker: string
  cityCode: string | null
  marketType: 'high' | 'low'
  resolutionDate: string           // YYYY-MM-DD (parsed from close_time)
  snapshotTime: number             // epoch ms
  hoursToResolution: number
  brackets: BracketSnapshot[]
  dominantBracket: string | null   // ticker with highest yesPrice
  dominantConcentration: number    // dominant yesPrice (0-1)
  bracketCount: number
  expiresAt: Date
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchActiveKalshiMarkets(): Promise<KalshiMarketRaw[]> {
  const all: KalshiMarketRaw[] = []
  let cursor: string | undefined

  do {
    const url = new URL(`${KALSHI_API_BASE}/markets`)
    url.searchParams.set('status', 'open')
    url.searchParams.set('limit', '1000')
    if (cursor) url.searchParams.set('cursor', cursor)

    const res = await fetchWithTimeout(url.toString())
    if (!res.ok) {
      throw new Error(`Kalshi /markets failed: ${res.status} ${res.statusText}`)
    }
    const data = (await res.json()) as KalshiMarketsResponse
    all.push(...data.markets)
    cursor = data.cursor
    if (cursor) await new Promise(r => setTimeout(r, PAGE_DELAY_MS))
  } while (cursor)

  return all.filter(m => /^KX(HIGH|LOW)/i.test(m.event_ticker))
}

function centsToDollars(cents: number | undefined): number | null {
  if (cents == null || !isFinite(cents)) return null
  return cents / 100
}

function midOrNull(bid: number | null, ask: number | null): number | null {
  if (bid != null && ask != null) return (bid + ask) / 2
  if (bid != null) return bid
  if (ask != null) return ask
  return null
}

function parseResolutionDate(closeTime: string): string {
  // Kalshi close_time is ISO; we use date portion (UTC) for resolution date
  return closeTime.slice(0, 10)
}

function buildBracketSnapshot(m: KalshiMarketRaw): BracketSnapshot {
  const yesBid = centsToDollars(m.yes_bid)
  const yesAsk = centsToDollars(m.yes_ask)
  const noBid = centsToDollars(m.no_bid)
  const noAsk = centsToDollars(m.no_ask)
  const lastTrade = centsToDollars(m.last_price)
  return {
    ticker: m.ticker,
    yesBid,
    yesAsk,
    yesPrice: midOrNull(yesBid, yesAsk) ?? lastTrade,
    noBid,
    noAsk,
    noPrice: midOrNull(noBid, noAsk) ?? (lastTrade != null ? 1 - lastTrade : null),
    lastTradePrice: lastTrade,
    volume: m.volume ?? 0,
    openInterest: m.open_interest ?? 0,
    floorF: m.floor_strike != null ? Number(m.floor_strike) : null,
    capF: m.cap_strike != null ? Number(m.cap_strike) : null,
    label: m.yes_sub_title || '',
  }
}

function buildEventSnapshot(eventTicker: string, markets: KalshiMarketRaw[], snapshotTime: number): EventSnapshot {
  const brackets = markets.map(buildBracketSnapshot)
  let dominantBracket: string | null = null
  let dominantConcentration = 0
  for (const b of brackets) {
    if (b.yesPrice != null && b.yesPrice > dominantConcentration) {
      dominantConcentration = b.yesPrice
      dominantBracket = b.ticker
    }
  }

  const closeTime = markets[0]?.close_time ?? ''
  const resolutionDate = parseResolutionDate(closeTime)
  const closeMs = closeTime ? new Date(closeTime).getTime() : snapshotTime
  const hoursToResolution = Math.max(0, Math.round((closeMs - snapshotTime) / 3_600_000))

  return {
    _id: `${eventTicker}:${snapshotTime}`,
    eventTicker,
    cityCode: extractCityCode(eventTicker),
    marketType: extractMarketType(eventTicker),
    resolutionDate,
    snapshotTime,
    hoursToResolution,
    brackets,
    dominantBracket,
    dominantConcentration,
    bracketCount: brackets.length,
    expiresAt: new Date(snapshotTime + RETENTION_DAYS * 24 * 60 * 60 * 1000),
  }
}

async function main() {
  const start = Date.now()
  const mongoUri = process.env.MONGO_CONNECTION_STRING
  if (!mongoUri) {
    console.error('[capture-snapshots] MONGO_CONNECTION_STRING not set')
    process.exit(1)
  }

  console.log(`[capture-snapshots] starting at ${new Date(start).toISOString()}`)

  const markets = await fetchActiveKalshiMarkets()
  console.log(`[capture-snapshots] fetched ${markets.length} active KX markets`)

  // Group by event
  const byEvent = new Map<string, KalshiMarketRaw[]>()
  for (const m of markets) {
    if (!byEvent.has(m.event_ticker)) byEvent.set(m.event_ticker, [])
    byEvent.get(m.event_ticker)!.push(m)
  }
  console.log(`[capture-snapshots] grouped into ${byEvent.size} events`)

  const snapshotTime = Date.now()
  const snapshots: EventSnapshot[] = []
  for (const [eventTicker, eventMarkets] of byEvent) {
    snapshots.push(buildEventSnapshot(eventTicker, eventMarkets, snapshotTime))
  }

  const client = new MongoClient(mongoUri)
  await client.connect()
  try {
    const db = client.db('kardashev')
    const col = db.collection<EventSnapshot>('kalshi_market_snapshots')

    // Idempotent indexes (cheap if already exist)
    await col.createIndex({ eventTicker: 1, snapshotTime: -1 })
    await col.createIndex({ snapshotTime: -1 })
    await col.createIndex({ resolutionDate: 1 })
    await col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })

    let inserted = 0
    for (const snap of snapshots) {
      try {
        await col.insertOne(snap)
        inserted++
      } catch (err: any) {
        if (err?.code !== 11000) {
          console.error(`[capture-snapshots] insert failed for ${snap._id}:`, err?.message ?? err)
        }
      }
    }
    console.log(`[capture-snapshots] inserted ${inserted}/${snapshots.length} snapshots in ${Date.now() - start}ms`)
  } finally {
    await client.close()
  }
}

main().catch(err => {
  console.error('[capture-snapshots] fatal:', err)
  process.exit(1)
})
