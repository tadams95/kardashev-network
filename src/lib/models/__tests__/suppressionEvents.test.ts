import { beforeEach, describe, expect, it, vi } from 'vitest'

// --- in-memory DB mock (per the temperatureBias.test pattern) ---
const inserted: Record<string, any[]> = { tail_sell_signals: [], suppression_events: [] }
const createIndex = vi.fn(async () => undefined)

vi.mock('@/lib/db/mongodb', () => ({
  getDb: () => ({
    collection: (name: string) => ({
      createIndex,
      // dedup query: tailSellSignals().find({...}).project({...}).toArray()
      find: () => ({ project: () => ({ toArray: async () => [] }) }),
      insertOne: async (doc: any) => { inserted[name].push(doc); return { insertedId: 'x' } },
      insertMany: async (docs: any[]) => { inserted[name].push(...docs); return { insertedCount: docs.length } },
    }),
  }),
}))

import { logTailSellSignals, buildSuppressionEvent } from '../tailSellTracker'
import type { PositionState } from '../tailSellTracker'

function emptyBudget() {
  return { byCity: new Map(), byCityType: new Map(), neCorridorTotal: 0, total: 0 }
}
function stateWithLiveTotal(total: number): PositionState {
  return { live: { ...emptyBudget(), total }, paper: emptyBudget(), dailyLoss: 0, circuitBreakerTripped: false }
}
// minimal cold/high live signal → mode is 'live' with no env dependency
function coldHighSignal(ticker = 'KXHIGHLA-26JUL23-T99') {
  return {
    ticker, eventTicker: 'KXHIGHLA-26JUL23', cityCode: 'LA', forecastF: 90,
    bracketFloorF: 98, bracketCapF: 100, bracketDistance: 8, direction: 'cold',
    yesPrice: 0.09, noSellPrice: 0.91, expectedProfit: 0.08, leadHours: 24,
    spreadF: 2, confidence: 'high', sourceCount: 5, temperatureType: 'high',
    timestamp: 1_780_000_000_000,
  } as any
}

beforeEach(() => { inserted.tail_sell_signals.length = 0; inserted.suppression_events.length = 0; createIndex.mockClear() })

describe('logTailSellSignals suppression persistence (Item 2)', () => {
  it('slots FULL: records a suppression document and places NO order', async () => {
    const logged = await logTailSellSignals([coldHighSignal()], stateWithLiveTotal(8)) // MAX_TOTAL=8
    expect(logged).toBe(0)
    expect(inserted.tail_sell_signals.length).toBe(0)          // no order/record
    expect(inserted.suppression_events.length).toBe(1)          // one suppression doc
    const s = inserted.suppression_events[0]
    expect(s.reason).toBe('max_total')
    expect(s.cityCode).toBe('LA')
    expect(s.occupancy).toBe(8)
    expect(s.cap).toBe(8)
    expect(s.wouldSize).toBe(10)                                // LA trimmed size
    expect(s.quadrant).toBe('cold/high')
  })

  it('slot AVAILABLE: logs the signal and records NO suppression', async () => {
    const logged = await logTailSellSignals([coldHighSignal()], stateWithLiveTotal(0))
    expect(logged).toBe(1)
    expect(inserted.tail_sell_signals.length).toBe(1)
    expect(inserted.suppression_events.length).toBe(0)
  })
})

describe('buildSuppressionEvent (pure)', () => {
  it('builds the documented shape with resolved wouldSize', () => {
    const e = buildSuppressionEvent(coldHighSignal('KXHIGHCHI-26JUL23-T83'), 'max_total', 8, 8, 'live')
    expect(e).toMatchObject({ reason: 'max_total', cityCode: 'LA', wouldSize: 10, occupancy: 8, cap: 8, mode: 'live', quadrant: 'cold/high' })
    expect(e.expiresAt instanceof Date).toBe(true)
  })
})
