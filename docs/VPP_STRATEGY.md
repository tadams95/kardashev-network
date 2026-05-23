# Kardashev Network → Virtual Power Plant (VPP) Strategy

> Phase 2 + 3 of the VPP evolution study. Companion: [`ARCHITECTURE_REVIEW.md`](./ARCHITECTURE_REVIEW.md).
> Snapshot: 2026-05-21. Code blocks are **illustrative design sketches**, not wired-up code.

---

## ⛔ VERDICT (2026-05-21): DECLINED — do not build

This document is preserved as a **documented decision**, not a build plan. After analysis,
the VPP pivot was **passed on**. The "forecast-driven dispatch" thesis below does not hold up.

**Why:**
1. **Forecasting is not a moat — shown twice, independently.** On Kalshi our forecast MAE is
   decent (~1.88°F) but loses to the market (BSS −0.20 to −0.27); forecasting was already
   demoted to a filter, not the edge. For VPP, the most predictive input for a site's
   generation/load is *that site's own telemetry history* — which Tesla/Enphase own across
   millions of sites and we don't. Incumbent data strictly dominates external irradiance.
2. **Incumbents already do proactive forecast dispatch** (Tesla Autobidder/Tesla Electric,
   Enphase forecast-charging, Sunrun CAISO VPP, aggregators Leap/AutoGrid). The "they're
   reactive, we'd be proactive" premise is false.
3. **A VPP needs what we lack:** hardware fleet + customer relationships, residential CAC,
   privileged telemetry, regulatory/grid compliance (IEEE 2030.5/CSIP, UL 1741-SB, metering/
   settlement), and capital.

**Corroboration:** three independent passes agree — our own Kalshi P&L, in-session analysis,
and an external Grok read ("Pass on the VPP pivot… keep it focused on making solar potential
visible and monetizing data/insights rather than orchestrating physical assets").

**Only surviving thread (incremental, not transformative):** a narrow B2B *spatial/fleet-level*
irradiance forecasting **data product** for aggregators/grid, metered via existing x402 rails.
Competes with Solcast/DNV; treat as a low-cost experiment, never a funded pivot.

**The lane:** Kardashev = energy *intelligence* — make potential visible and monetize insight
(what the solar dashboard already does). Do **not** orchestrate physical assets. Don't
re-litigate without new facts (privileged data, a hardware/distribution partner, or a proven
underserved segment). See `memory/vpp-pivot-declined-2026-05-21.md`.

*Everything below is the original exploratory analysis, retained for the record.*

---

## 0. Thesis — the forecast engine is the moat

Most residential/commercial VPP aggregators (Tesla, Sunrun, Swell, Leap, OhmConnect)
dispatch **reactively**: a utility calls an event, the platform tells batteries to
discharge. The differentiation is in customer acquisition and hardware partnerships, not
software intelligence.

Kardashev already operates the rare hard asset: a **calibrated, multi-source, per-location
irradiance + temperature ensemble with quantified uncertainty**, plus a discipline of
fail-closed probabilistic decision-making proven on real money (Kalshi tail-sells). That
same machinery, pointed at energy assets, forecasts **site-level generation and load** and
dispatches batteries *ahead* of high-value windows instead of reacting to them.

> The bet: **proactive, forecast-optimal dispatch** captures meaningfully more value per
> kWh of battery than reactive dispatch — and that delta is defensible because the forecast
> stack took years to calibrate.

This makes the natural wedge **NEM 3.0 California**, where the value of *when* you export
swings ~10× across the day and a good generation+price forecast directly converts to dollars.

---

## Phase 2 — Opportunity Analysis

### 2.1 New data streams, APIs & device integrations

| Layer | Source / protocol | Why | Notes |
|---|---|---|---|
| Battery / inverter | Tesla FleetAPI (Powerwall), Enphase Enlighten, SolarEdge, **SunSpec Modbus / IEEE 2030.5** | real-time SoC, generation, dispatch control | 2030.5 (CSIP) is the CA utility-grade path |
| Smart meter | **Green Button** (DataCustodian / Share My Data), utility APIs | actual interval load + tariff context | 15-min intervals; PII-bearing |
| EV charger | **OCPP 1.6/2.0.1**, Tesla, Enphase IQ | flexible load, V2G later | huge controllable load |
| Price / grid | **CAISO OASIS** (LMP), utility TOU schedules, OpenEI URDB | the value signal dispatch optimizes against | drives export timing |
| Program | CA **DSGS**, **ELRP**, utility VPP APIs (PG&E/SCE/SDG&E), **Leap**/aggregator APIs | event calls, baselines, settlement | enrollment + telemetry obligations |
| Weather | **(existing)** ensemble + irradiance | generation & load forecast inputs | the moat — reused, not rebuilt |

The new ingestion surface is **device telemetry + meter + price**. Everything else
(forecasting) is already in-house.

### 2.2 Using existing forecast data for battery optimization

The existing irradiance ensemble maps almost directly onto a **site generation forecast**:

```
per-site generation forecast (kW, hourly)
  = ensemble GHI/DNI forecast            ← already produced per location
  × site array geometry (tilt/azimuth)   ← already available from Google Solar buildingInsights
  × panel η · system losses · thermal derate  ← already in calculateWastedValue()
```

`src/lib/calculations/solarValue.ts` is, in effect, a generation model already — it just
needs to emit a **forward hourly kW curve** instead of a single "wasted value" number, fed
by the forecast ensemble rather than current conditions. That is a small, well-scoped
extension of code that exists.

Combine generation forecast + load forecast + TOU/export price curve and the optimizer
solves a daily schedule with three objectives:
- **Self-consumption** — store midday surplus, avoid importing at peak (NEM 3.0 makes
  exported kWh worth far less than avoided imports).
- **Strategic export** — discharge into the **4–9pm high-value window** when export
  compensation (ACC values) and TOU peaks align.
- **Backup reserve** — never discharge below a user-set floor (resilience).

### 2.3 VPP software layer (three components)

```
   ┌──────────────────────────────────────────────────────────────────┐
   │                     KARDASHEV VPP SOFTWARE LAYER                   │
   │                                                                    │
   │  (a) AGGREGATION            (b) OPTIMIZATION        (c) PROGRAMS    │
   │  ─────────────────          ─────────────────       ────────────   │
   │  device registry            per-site dispatch        DSGS / ELRP    │
   │  consent + telemetry        scheduler (multi-obj)    utility VPP    │
   │  fleet state store          fleet roll-up            Leap adapter   │
   │  (time-series)              forecast adapter ◀──────── existing     │
   │                             (gen + load)               ensemble     │
   └──────────────────────────────────────────────────────────────────┘
            ▲                          │                       │
        telemetry                  dispatch cmds          event calls /
        (devices)                  (to devices)            settlement
```

- **(a) Aggregation** — device registry, consented telemetry ingestion, fleet state store
  (a real time-series DB, the missing primitive from the review).
- **(b) Optimization** — the differentiator: a per-site `BatteryDispatchScheduler` consuming
  the existing forecast, plus a fleet roll-up that decides *which* sites dispatch for a VPP
  event to hit a target MW while respecting each site's economics and reserve.
- **(c) Program participation** — adapters that translate utility/aggregator event APIs
  (DSGS, ELRP, Leap) into fleet dispatch targets and ingest baselines/settlement.

### 2.4 Revenue models

1. **VPP event dispatch payments** — capacity + energy payments from utility/aggregator
   programs; Kardashev takes a margin on dispatched kWh/kW.
2. **SaaS / licensing** — license the forecast+optimization layer to installers and small
   aggregators who have hardware + customers but no dispatch intelligence. Highest-margin,
   most defensible (sells the moat directly).
3. **Bill-savings share** — a cut of the customer bill reduction from optimized
   self-consumption (aligns incentives, needs the location-tariff fix from §4 first).
4. **Tokenized energy credits** — credibly reuses the dormant on-chain + x402 rails:
   settle dispatch payouts or represent verified exported/curtailed kWh as on-chain credits.
   Speculative, but it's why the crypto stack already exists — and fits the "energy
   intelligence ledger" mission framing.

---

## Phase 3 — Concrete Recommendations & Next Steps

### 3.1 Top 5 highest-impact items

Ordered to **pay down the exact debt that blocks VPP while building net-new capability**:

1. **Device telemetry ingestion + time-series store** *(net-new, foundational)* — a
   `POST /api/vpp/telemetry` endpoint behind a queue, writing to a MongoDB **time-series
   collection** (or Timescale). Closes the #1 gap from the review.
2. **Generation/load forecast adapter** *(reuse the moat)* — extend `solarValue.ts` +
   the ensemble into a forward hourly per-site generation curve; add a simple load
   forecaster (meter history + temperature). Small surface, highest leverage.
3. **`BatteryDispatchScheduler`** *(the differentiator)* — multi-objective day-ahead
   schedule from generation + load + price. Start rule-based/greedy; evolve to MILP/ML.
4. **Platform hardening** *(debt that VPP forces)* — shared API middleware, PM2 cluster
   mode, request dedup, and a WebSocket/queue layer (BullMQ or Redis Streams). The review
   flagged all of these; a device fleet makes them non-optional.
5. **Consent & telemetry module** *(regulatory prerequisite)* — explicit per-site consent,
   scoped data retention, audit trail. Required before touching meter/device PII.

### 3.2 VPP integration architecture (text diagram)

```
 DEVICES                INGEST                 STORE              INTELLIGENCE            ACT
 ───────                ──────                 ─────              ────────────            ───
 Powerwall  ─┐
 Enphase    ─┼─▶ POST /api/vpp/telemetry ─▶ queue ─▶ TS collection ─┐
 SolarEdge  ─┘     (consent-gated,            (BullMQ /   (telemetry_*) │
 EV (OCPP)  ───▶    rate-limited)              Redis                    │
                                               Streams)                 ▼
 Smart meter ─▶ Green Button sync ───────────────────────────▶  Forecast adapter
 CAISO/TOU   ─▶ price sync ──────────────────────────────────▶  (gen + load + price)
 (weather ensemble — already in-house) ─────────────────────────▶      │
                                                                       ▼
                                                            BatteryDispatchScheduler
                                                            (self-consume / export / reserve)
                                                                       │
                              ┌──────────────── fleet roll-up ◀────────┘
                              ▼                  (target MW for event)
                   POST /api/vpp/dispatch ─▶ device control adapters ─▶ Powerwall / inverter / EVSE
                   (utility/aggregator event → per-site commands; settlement back)
```

### 3.3 Code sketches (design intent)

All sketches reuse existing utilities: `rget`/`rset` (`src/lib/cache/redis.ts`),
`requireAuth` (`src/lib/utils/apiAuth.ts`), and `calculateWastedValue`
(`src/lib/calculations/solarValue.ts`). They follow the repo's fail-closed conventions.

**(i) Battery dispatch scheduler** — consumes the existing forecast.

```typescript
// src/lib/vpp/dispatchScheduler.ts  (SKETCH)
import { calculateWastedValue } from '@/lib/calculations/solarValue'

export interface DispatchInputs {
  generationKwByHour: number[]   // 24h, from ensemble irradiance × site geometry
  loadKwByHour: number[]         // 24h, from meter history + temperature forecast
  importPriceByHour: number[]    // $/kWh TOU
  exportValueByHour: number[]    // $/kWh NEM 3.0 ACC export value
  battery: { capacityKwh: number; maxChargeKw: number; maxDischargeKw: number; soc0: number; reserveFloorFrac: number }
}

export interface DispatchPlan {
  batteryKwByHour: number[]      // + = charge, - = discharge
  projectedSocByHour: number[]
  expectedDailyValue: number     // $ vs. no-battery baseline
}

/** Greedy multi-objective day-ahead schedule. Objectives, in priority order:
 *  1) keep SoC ≥ reserve floor (backup), 2) avoid peak imports (self-consumption),
 *  3) export only when exportValue clears the opportunity cost of stored energy. */
export function planDispatch(input: DispatchInputs): DispatchPlan {
  const { battery } = input
  const reserveKwh = battery.capacityKwh * battery.reserveFloorFrac
  let soc = battery.soc0 * battery.capacityKwh
  const batteryKwByHour: number[] = []
  const projectedSocByHour: number[] = []

  for (let h = 0; h < 24; h++) {
    const surplus = input.generationKwByHour[h] - input.loadKwByHour[h] // + = excess solar
    let action = 0

    if (surplus > 0) {
      // Excess solar: store it unless exporting now beats the best future import we'd offset.
      const bestFutureImport = Math.max(...input.importPriceByHour.slice(h))
      const exportNow = input.exportValueByHour[h]
      action = exportNow > bestFutureImport
        ? -Math.min(surplus, battery.maxDischargeKw)   // export-through (don't bank)
        : Math.min(surplus, battery.maxChargeKw, (battery.capacityKwh - soc))
    } else {
      // Deficit: discharge to cover load during expensive hours, never below reserve.
      const expensive = input.importPriceByHour[h] >= median(input.importPriceByHour)
      if (expensive && soc > reserveKwh) {
        action = -Math.min(-surplus, battery.maxDischargeKw, (soc - reserveKwh))
      }
    }
    soc = clamp(soc + action, reserveKwh, battery.capacityKwh)
    batteryKwByHour.push(action)
    projectedSocByHour.push(soc / battery.capacityKwh)
  }
  return { batteryKwByHour, projectedSocByHour, expectedDailyValue: scorePlan(input, batteryKwByHour) }
}
// helpers: median(), clamp(), scorePlan() omitted. Evolve greedy → MILP (e.g. javascript-lp-solver) → learned policy.
```

**(ii) VPP dispatch API endpoint** — utility/aggregator event → per-site commands.

```typescript
// src/pages/api/vpp/dispatch.ts  (SKETCH)
import type { NextApiRequest, NextApiResponse } from 'next'
import { requireAuth } from '@/lib/utils/apiAuth'   // cron/server-to-server only
import { rget, rset } from '@/lib/cache/redis'
import { planDispatch } from '@/lib/vpp/dispatchScheduler'

// POST { programEvent: { startIso, endIso, targetMw, programId } }
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'method' })
  if (!requireAuth(req)) return res.status(401).json({ success: false, error: 'unauthorized' }) // fail closed

  const { programEvent } = req.body ?? {}
  if (!programEvent?.targetMw) return res.status(400).json({ success: false, error: 'bad event' })

  // 1) load consented, online sites (cached fleet state)
  const fleet = (await rget<SiteState[]>(`vpp:fleet:${programEvent.programId}`)) ?? []

  // 2) rank sites by available dischargeable kWh above reserve + dispatch value, fill to targetMw
  const ranked = fleet
    .filter(s => s.online && s.consentDispatch)
    .map(s => ({ site: s, plan: planDispatch(s.dispatchInputs) }))
    .sort((a, b) => b.plan.expectedDailyValue - a.plan.expectedDailyValue)

  const commands: DispatchCommand[] = []
  let committedKw = 0
  const targetKw = programEvent.targetMw * 1000
  for (const { site } of ranked) {
    if (committedKw >= targetKw) break
    const kw = Math.min(site.maxDischargeKw, site.availableKwhAboveReserve) // simplified
    commands.push({ siteId: site.id, dischargeKw: kw, window: programEvent })
    committedKw += kw
  }

  await rset(`vpp:dispatch:${programEvent.programId}:${programEvent.startIso}`, commands, 6 * 3600)
  // (device control adapters consume `commands` out-of-band; settlement reconciled later)
  return res.status(200).json({ success: true, committedMw: committedKw / 1000, sites: commands.length })
}
```

**(iii) Consent + telemetry ingest** — regulatory prerequisite, queue-backed.

```typescript
// src/pages/api/vpp/telemetry.ts  (SKETCH)
import type { NextApiRequest, NextApiResponse } from 'next'
import { rincr, rset } from '@/lib/cache/redis'

// Devices POST signed readings. NOT requireAuth (devices can't carry CRON_SECRET) —
// gate with per-site device token + input validation + Redis rate limit, mirroring the
// existing browser-callable logging-endpoint invariant in CLAUDE.md.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ success: false })
  const { siteId, deviceToken, reading } = req.body ?? {}

  const consent = await verifySiteConsent(siteId, deviceToken, 'telemetry') // explicit, scoped, revocable
  if (!consent.ok) return res.status(403).json({ success: false, error: 'no consent' })

  const count = await rincr(`vpp:ratelimit:telemetry:${siteId}`, 60)  // per-site per-minute cap
  if (count !== null && count > 120) return res.status(429).json({ success: false })

  if (!validReading(reading)) return res.status(400).json({ success: false }) // SoC/kW sanity bounds

  // enqueue → worker bulk-inserts into time-series collection (avoid sync Mongo write on hot path)
  await enqueueTelemetry({ siteId, ts: new Date(), ...reading, retentionTier: consent.retentionTier })
  await rset(`vpp:laststate:${siteId}`, reading, 900)  // L2 latest-state cache for fast fleet roll-up
  return res.status(202).json({ success: true })
}
```

```javascript
// MongoDB time-series collection (the missing primitive)
db.createCollection("vpp_telemetry", {
  timeseries: { timeField: "ts", metaField: "siteId", granularity: "minutes" },
  expireAfterSeconds: 60 * 60 * 24 * 90   // 90d retention; consent tier can shorten
})
```

### 3.4 Tech additions

| Need | Recommendation | Why |
|---|---|---|
| Time-series store | **MongoDB time-series collections** (already on Mongo) → Timescale if scale demands | least new infra; native downsampling |
| Queue / streaming | **BullMQ** or **Redis Streams** (Redis already in stack) | decouple hot-path ingest from writes |
| Real-time push | **WebSocket gateway** (`ws`) on a clustered PM2 process | fleet state + event push without polling |
| Optimization | rule-based → **MILP** (`javascript-lp-solver` / Python `PuLP` microservice) → learned dispatch policy | grow sophistication with data |
| Scale | PM2 **cluster mode**; separate ingest workers from web | review flagged single-instance ceiling |
| Forecast→gen | extend `solarValue.ts` to emit forward hourly kW curve | reuse the moat, minimal new code |

### 3.5 Regulatory, privacy & grid challenges

- **NEM 3.0 reality** — export compensation uses time-varying Avoided Cost Calculator (ACC)
  values, far below retail; the whole optimization premise is *self-consume by default,
  export only in the high-value 4–9pm window*. The math must use ACC + TOU, not net metering.
- **Interconnection / control standards** — utility-grade dispatch on CA utilities means
  **IEEE 2030.5 (CSIP)** and **UL 1741-SB** compliant inverters/gateways; cannot just
  poke vendor cloud APIs for settled programs.
- **Program enrollment** — DSGS / ELRP / utility VPPs require enrollment, baseline
  methodology, and telemetry/metering obligations; aggregating via **Leap** can shortcut
  market access early.
- **Privacy / PII** — meter interval + device data is personal data (CCPA/CPRA). The consent
  module, scoped retention, and an auditable trail are prerequisites, not afterthoughts.
- **Wholesale path** — **FERC Order 2222** opens wholesale market participation for DERs via
  aggregation; relevant for a later, larger-scale play (CAISO DERP/DERA).
- **Metering accuracy** — VPP settlement requires revenue-grade or approved telemetry;
  consumer-device readings alone won't settle utility payments.

---

## Mission tie-in

This evolution is squarely on the Kardashev arc: the platform today makes solar *potential*
visible (uncaptured-value dashboards). A VPP layer makes solar *dispatchable* — turning a
calibrated planetary forecast into coordinated, monetized energy action across a fleet. That
is a concrete step up the Kardashev scale: not just measuring available energy, but
**intelligently routing it** — planetary energy intelligence with a P&L.

> Strategic sequencing note: the forecast stack is the durable asset and is already built.
> Recommend building VPP capability *adjacent to*, not on top of, the Kalshi trading path —
> the trading work proves the forecasting edge with real money while the VPP layer
> commercializes that same edge in physical energy markets.
