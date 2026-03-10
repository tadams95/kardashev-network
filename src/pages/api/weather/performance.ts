// Live performance tracking API endpoint
// GET: Returns current performance snapshot (rolling win rate, Brier score, decay status)
// POST: Log a signal or resolve an outcome

import type { NextApiRequest, NextApiResponse } from 'next'
import {
  logSignal,
  resolveSignal,
  resolveByMarketId,
  getPerformanceSnapshot,
  getSignalHistory,
  getReliabilityData,
  getPnLBreakdown,
} from '@/lib/models/performanceTracker'
import { rget, rset } from '@/lib/cache/redis'
import { extractCityCode } from '@/lib/utils/tickerParsing'
import { requireAuth } from '@/lib/utils/apiAuth'

interface PerformanceApiResponse {
  success: boolean
  data?: any
  error?: string
  timestamp: number
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<PerformanceApiResponse>
) {
  if (req.method === 'GET') {
    const { limit, view } = req.query

    try {
      // Analytics view: combined reliability + P&L + snapshot in one call
      if (view === 'analytics') {
        const CACHE_KEY = 'analytics:snapshot:v3'
        const cached = await rget<any>(CACHE_KEY)
        if (cached) {
          return res.status(200).json({ success: true, data: cached, timestamp: Date.now() })
        }

        const [rollingSnapshot, reliabilityData, pnlBreakdown] = await Promise.all([
          getPerformanceSnapshot(),
          getReliabilityData(),
          getPnLBreakdown(500),
        ])

        // Derive analytics-specific stats from the resolved trades (not the
        // rolling window, which may contain only unresolved recent signals).
        const trades = pnlBreakdown.trades
        const resolvedCount = trades.length
        const wins = trades.filter(t => t.outcome).length

        // Recover actual market resolution from trade result.
        // t.outcome = "did the trade win", NOT "did the market resolve YES".
        // For YES bets (modelProb > marketPrice): trade wins ↔ market resolved YES
        // For NO bets (modelProb < marketPrice): trade wins ↔ market resolved NO
        function marketActual(t: typeof trades[0]): number {
          const bettingYes = t.modelProbability > t.marketPrice
          const resolvedYes = bettingYes ? t.outcome : !t.outcome
          return resolvedYes ? 1 : 0
        }

        // Model Brier: (P(YES) - actual)²
        const modelBrier = resolvedCount > 0
          ? trades.reduce((sum, t) => sum + (t.modelProbability - marketActual(t)) ** 2, 0) / resolvedCount
          : 0.25
        // Market baseline Brier
        const marketBrier = resolvedCount > 0
          ? trades.reduce((sum, t) => sum + (t.marketPrice - marketActual(t)) ** 2, 0) / resolvedCount
          : 0.25
        const bss = marketBrier > 0 ? 1 - (modelBrier / marketBrier) : 0

        const snapshot = {
          ...rollingSnapshot,
          // Override with analytics-scope values
          totalSignals: rollingSnapshot.totalSignals + resolvedCount,
          resolvedSignals: resolvedCount,
          winRate: resolvedCount > 0 ? wins / resolvedCount : 0.5,
          brierScore: modelBrier,
          marketBrierScore: marketBrier,
          brierSkillScore: bss,
          avgReturn: pnlBreakdown.overall.avgReturn,
          // Recompute decay using analytics-scope data
          modelDecay: resolvedCount >= 20 && (
            (wins / resolvedCount) < 0.55 || modelBrier > 0.25
          ),
        }

        const data = {
          snapshot,
          reliabilityBins: reliabilityData.bins,
          reliabilitySampleSize: reliabilityData.sampleSize,
          pnlBreakdown: {
            byCity: pnlBreakdown.byCity,
            byMarketType: pnlBreakdown.byMarketType,
            byLeadBucket: pnlBreakdown.byLeadBucket,
            overall: pnlBreakdown.overall,
          },
          trades,
        }

        // Cache for 15 minutes — bump key version if response shape changes
        await rset(CACHE_KEY, data, 900)

        return res.status(200).json({ success: true, data, timestamp: Date.now() })
      }

      // Default: performance snapshot + optional signal history
      const snapshot = await getPerformanceSnapshot()
      const history = limit
        ? await getSignalHistory(parseInt(String(limit)))
        : undefined

      return res.status(200).json({
        success: true,
        data: {
          snapshot,
          ...(history ? { recentSignals: history } : {}),
        },
        timestamp: Date.now(),
      })
    } catch (error) {
      console.error('[weather/performance] GET failed:', error)
      return res.status(500).json({
        success: false,
        error: 'Failed to load performance data',
        timestamp: Date.now(),
      })
    }
  }

  if (req.method === 'POST') {
    const { action } = req.body

    if (action === 'log') {
      // No requireAuth here — this is called from browser-side code
      // (useWeatherOpportunities.ts) which cannot carry CRON_SECRET.
      // Input validation + source allowlists below provide sufficient defense.

      // Log a new signal
      const {
        marketId,
        modelProbability,
        marketPrice,
        edge,
        direction,
        signal,
        cityCode,
        forecastTemp,
        hoursToResolution,
        temperatureType,
        rawModelProbability,
        correctedModelProbability,
        probabilityDelta,
        correctionF,
        decisionPolicyVersion,
        biasStateId,
        calibrationModelId,
        biasSnapshot,
        shadowMeta,
        perSourceForecasts,
        forecastCityName,
      } = req.body

      if (typeof marketId !== 'string') {
        return res.status(400).json({ success: false, error: 'marketId must be a string', timestamp: Date.now() })
      }
      if (typeof modelProbability !== 'number' || modelProbability < 0 || modelProbability > 1) {
        return res.status(400).json({ success: false, error: 'modelProbability must be a number between 0 and 1', timestamp: Date.now() })
      }
      if (typeof marketPrice !== 'number' || marketPrice < 0 || marketPrice > 1) {
        return res.status(400).json({ success: false, error: 'marketPrice must be a number between 0 and 1', timestamp: Date.now() })
      }

      // Validate optional fields that get persisted
      if (edge !== undefined && (typeof edge !== 'number' || !isFinite(edge) || edge < 0 || edge > 1)) {
        return res.status(400).json({ success: false, error: 'edge must be a finite number between 0 and 1', timestamp: Date.now() })
      }
      if (direction !== undefined && direction !== 'YES' && direction !== 'NO') {
        return res.status(400).json({ success: false, error: 'direction must be "YES" or "NO"', timestamp: Date.now() })
      }
      if (signal !== undefined && !['STRONG_YES', 'YES', 'HOLD', 'NO', 'STRONG_NO'].includes(signal)) {
        return res.status(400).json({ success: false, error: 'signal must be one of: STRONG_YES, YES, HOLD, NO, STRONG_NO', timestamp: Date.now() })
      }
      if (cityCode !== undefined && (typeof cityCode !== 'string' || cityCode.length > 10)) {
        return res.status(400).json({ success: false, error: 'cityCode must be a short string', timestamp: Date.now() })
      }
      if (forecastTemp !== undefined && (typeof forecastTemp !== 'number' || !isFinite(forecastTemp))) {
        return res.status(400).json({ success: false, error: 'forecastTemp must be a finite number', timestamp: Date.now() })
      }
      if (hoursToResolution !== undefined && (typeof hoursToResolution !== 'number' || !isFinite(hoursToResolution))) {
        return res.status(400).json({ success: false, error: 'hoursToResolution must be a finite number', timestamp: Date.now() })
      }
      if (temperatureType !== undefined && temperatureType !== 'high' && temperatureType !== 'low') {
        return res.status(400).json({ success: false, error: 'temperatureType must be "high" or "low"', timestamp: Date.now() })
      }
      if (rawModelProbability !== undefined && (typeof rawModelProbability !== 'number' || rawModelProbability < 0 || rawModelProbability > 1)) {
        return res.status(400).json({ success: false, error: 'rawModelProbability must be a number between 0 and 1', timestamp: Date.now() })
      }
      if (correctedModelProbability !== undefined && (typeof correctedModelProbability !== 'number' || correctedModelProbability < 0 || correctedModelProbability > 1)) {
        return res.status(400).json({ success: false, error: 'correctedModelProbability must be a number between 0 and 1', timestamp: Date.now() })
      }
      if (probabilityDelta !== undefined && (typeof probabilityDelta !== 'number' || !isFinite(probabilityDelta))) {
        return res.status(400).json({ success: false, error: 'probabilityDelta must be a finite number', timestamp: Date.now() })
      }
      if (correctionF !== undefined && (typeof correctionF !== 'number' || !isFinite(correctionF))) {
        return res.status(400).json({ success: false, error: 'correctionF must be a finite number', timestamp: Date.now() })
      }
      if (decisionPolicyVersion !== undefined && typeof decisionPolicyVersion !== 'string') {
        return res.status(400).json({ success: false, error: 'decisionPolicyVersion must be a string', timestamp: Date.now() })
      }
      if (biasStateId !== undefined && typeof biasStateId !== 'string') {
        return res.status(400).json({ success: false, error: 'biasStateId must be a string', timestamp: Date.now() })
      }
      if (calibrationModelId !== undefined && typeof calibrationModelId !== 'string') {
        return res.status(400).json({ success: false, error: 'calibrationModelId must be a string', timestamp: Date.now() })
      }
      if (biasSnapshot !== undefined) {
        const valid =
          biasSnapshot &&
          typeof biasSnapshot === 'object' &&
          typeof biasSnapshot.meanErrorF === 'number' && isFinite(biasSnapshot.meanErrorF) &&
          typeof biasSnapshot.correctionF === 'number' && isFinite(biasSnapshot.correctionF) &&
          typeof biasSnapshot.isActive === 'boolean' &&
          typeof biasSnapshot.sampleCount === 'number' && isFinite(biasSnapshot.sampleCount) &&
          typeof biasSnapshot.effectiveSampleSize === 'number' && isFinite(biasSnapshot.effectiveSampleSize)

        if (!valid) {
          return res.status(400).json({ success: false, error: 'biasSnapshot has invalid shape', timestamp: Date.now() })
        }
      }
      if (shadowMeta !== undefined) {
        const valid =
          shadowMeta &&
          typeof shadowMeta === 'object' &&
          (shadowMeta.regime === undefined || typeof shadowMeta.regime === 'string') &&
          (shadowMeta.contextKey === undefined || typeof shadowMeta.contextKey === 'string') &&
          (shadowMeta.effectiveSampleSize === undefined || (typeof shadowMeta.effectiveSampleSize === 'number' && isFinite(shadowMeta.effectiveSampleSize)))
        if (!valid) {
          return res.status(400).json({ success: false, error: 'shadowMeta has invalid shape', timestamp: Date.now() })
        }
      }
      if (perSourceForecasts !== undefined) {
        if (typeof perSourceForecasts !== 'object' || perSourceForecasts === null || Array.isArray(perSourceForecasts)) {
          return res.status(400).json({ success: false, error: 'perSourceForecasts must be an object', timestamp: Date.now() })
        }
        const KNOWN_SOURCES = new Set(['Open-Meteo', 'Google-Weather', 'NWS', 'METAR', 'AccuWeather', 'Tomorrow.io'])
        for (const [k, v] of Object.entries(perSourceForecasts)) {
          if (!KNOWN_SOURCES.has(k)) {
            return res.status(400).json({ success: false, error: `perSourceForecasts contains unknown source: ${k}`, timestamp: Date.now() })
          }
          if (typeof v !== 'number' || !isFinite(v as number)) {
            return res.status(400).json({ success: false, error: 'perSourceForecasts values must be finite numbers', timestamp: Date.now() })
          }
        }
      }

      if (forecastCityName !== undefined && typeof forecastCityName !== 'string') {
        return res.status(400).json({ success: false, error: 'forecastCityName must be a string', timestamp: Date.now() })
      }

      // Derive cityCode from marketId to prevent cross-city contamination
      const derivedCity = extractCityCode(marketId)
      if (derivedCity && cityCode && derivedCity !== cityCode) {
        console.warn(`[performance] Cross-city mismatch: client sent cityCode=${cityCode} but marketId=${marketId} → ${derivedCity}`)
      }
      const effectiveCityCode = derivedCity ?? cityCode

      let id: string
      try {
        id = await logSignal({
          marketId,
          timestamp: Date.now(),
          modelProbability,
          marketPrice,
          edge: edge ?? Math.abs(modelProbability - marketPrice),
          direction: direction ?? (modelProbability > marketPrice ? 'YES' : 'NO'),
          signal: signal ?? 'HOLD',
          ...(effectiveCityCode ? { cityCode: effectiveCityCode } : {}),
          ...(forecastTemp != null ? { forecastTemp } : {}),
          ...(hoursToResolution != null ? { hoursToResolution } : {}),
          ...(temperatureType ? { temperatureType } : {}),
          ...(rawModelProbability != null ? { rawModelProbability } : {}),
          ...(correctedModelProbability != null ? { correctedModelProbability } : {}),
          ...(probabilityDelta != null ? { probabilityDelta } : {}),
          ...(correctionF != null ? { correctionF } : {}),
          ...(decisionPolicyVersion ? { decisionPolicyVersion } : {}),
          ...(biasStateId ? { biasStateId } : {}),
          ...(calibrationModelId ? { calibrationModelId } : {}),
          ...(biasSnapshot ? { biasSnapshot } : {}),
          ...(shadowMeta ? { shadowMeta } : {}),
          ...(perSourceForecasts ? { perSourceForecasts } : {}),
          ...(forecastCityName ? { forecastCityName } : {}),
        })
      } catch (error) {
        console.error('[weather/performance] POST log failed:', error)
        return res.status(500).json({ success: false, error: 'Failed to log signal', timestamp: Date.now() })
      }

      return res.status(200).json({
        success: true,
        data: { signalId: id },
        timestamp: Date.now(),
      })
    }

    if (action === 'resolve') {
      if (!requireAuth(req)) {
        return res.status(401).json({ success: false, error: 'Unauthorized', timestamp: Date.now() })
      }

      // Resolve a signal outcome
      const { signalId, marketId, outcome } = req.body

      if (typeof outcome !== 'boolean') {
        return res.status(400).json({
          success: false,
          error: 'Missing or invalid required field: outcome (boolean)',
          timestamp: Date.now(),
        })
      }

      let resolved = 0
      try {
        if (signalId) {
          if (typeof signalId !== 'string') {
            return res.status(400).json({ success: false, error: 'signalId must be a string', timestamp: Date.now() })
          }
          resolved = (await resolveSignal(signalId, outcome)) ? 1 : 0
        } else if (marketId) {
          if (typeof marketId !== 'string') {
            return res.status(400).json({ success: false, error: 'marketId must be a string', timestamp: Date.now() })
          }
          resolved = await resolveByMarketId(marketId, outcome)
        } else {
          return res.status(400).json({
            success: false,
            error: 'Must provide signalId or marketId',
            timestamp: Date.now(),
          })
        }
      } catch (error) {
        console.error('[weather/performance] POST resolve failed:', error)
        return res.status(500).json({ success: false, error: 'Failed to resolve signal', timestamp: Date.now() })
      }

      return res.status(200).json({
        success: true,
        data: { resolved },
        timestamp: Date.now(),
      })
    }

    return res.status(400).json({
      success: false,
      error: 'Unknown action. Use "log" or "resolve".',
      timestamp: Date.now(),
    })
  }

  return res.status(405).json({
    success: false,
    error: 'Method not allowed',
    timestamp: Date.now(),
  })
}
