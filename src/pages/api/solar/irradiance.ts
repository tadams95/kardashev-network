import type { NextApiRequest, NextApiResponse } from 'next'
import { fetchSolarData } from '@/lib/api/openMeteo'
import { useFacilitator as createFacilitator } from 'x402/verify'
import { exact } from 'x402/schemes'
import {
  processPriceToAtomicAmount,
  findMatchingPaymentRequirements,
  safeBase64Encode,
  getDefaultAsset,
} from 'x402/shared'
import type { PaymentRequirements, Network } from 'x402/types'
import type { SolarApiResponse } from '@/types/solar'

// ── Config (persistent across requests) ──────────────────────────────
const RECEIVER_ADDRESS = process.env.X402_RECEIVER_ADDRESS || '0x0000000000000000000000000000000000000000'
const NETWORK = (process.env.NEXT_PUBLIC_X402_NETWORK || 'base-sepolia') as Network
const FACILITATOR_URL = 'https://x402.org/facilitator'

const facilitator = createFacilitator({ url: FACILITATOR_URL as `https://${string}` })

// ── Session store ────────────────────────────────────────────────────
const sessions = new Map<string, { expires: number; txHash: string }>()
const SESSION_DURATION = 30 * 60 * 1000 // 30 minutes

function cleanExpiredSessions() {
  const now = Date.now()
  for (const [key, session] of sessions) {
    if (now > session.expires) {
      sessions.delete(key)
    }
  }
}

// ── Payment requirements (built once) ────────────────────────────────
const priceResult = processPriceToAtomicAmount('$0.001', NETWORK)
const defaultAsset = getDefaultAsset(NETWORK)

function buildPaymentRequirements(): PaymentRequirements {
  if ('error' in priceResult) {
    throw new Error(`Failed to process price: ${priceResult.error}`)
  }
  return {
    scheme: 'exact',
    network: NETWORK,
    maxAmountRequired: priceResult.maxAmountRequired,
    asset: defaultAsset.address,
    resource: '', // set per-request with full URL
    description: 'Premium solar irradiance data',
    mimeType: 'application/json',
    payTo: RECEIVER_ADDRESS,
    maxTimeoutSeconds: 300,
    extra: defaultAsset.eip712,
  }
}

const paymentRequirements = buildPaymentRequirements()

const x402Response = {
  x402Version: 1,
  accepts: [paymentRequirements],
  error: 'X402: Payment Required',
}

// ── Helpers ──────────────────────────────────────────────────────────
function parseCoordinates(req: NextApiRequest): { lat: number; lng: number } | null {
  const { lat, lng, latitude, longitude } = req.query

  const latValue = lat || latitude
  const lngValue = lng || longitude

  if (!latValue || !lngValue) {
    return null
  }

  const parsedLat = parseFloat(Array.isArray(latValue) ? latValue[0] : latValue)
  const parsedLng = parseFloat(Array.isArray(lngValue) ? lngValue[0] : lngValue)

  if (isNaN(parsedLat) || isNaN(parsedLng)) {
    return null
  }

  if (parsedLat < -90 || parsedLat > 90 || parsedLng < -180 || parsedLng > 180) {
    return null
  }

  return { lat: parsedLat, lng: parsedLng }
}

// ── Handler ──────────────────────────────────────────────────────────
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SolarApiResponse | typeof x402Response>
) {
  const coords = parseCoordinates(req)

  if (!coords) {
    return res.status(400).json({
      success: false,
      error: 'Missing or invalid coordinates. Provide lat/lng or latitude/longitude query params.',
    })
  }

  cleanExpiredSessions()

  // Build full resource URL from request
  const protocol = req.headers['x-forwarded-proto'] || 'http'
  const host = req.headers.host || 'localhost:3000'
  const resourceUrl = `${protocol}://${host}/api/solar/irradiance`

  const walletAddress = (req.headers['x-wallet-address'] as string | undefined)?.toLowerCase()
  const paymentHeader = req.headers['x-payment'] as string | undefined
  const requestsPremium = !!req.headers['x-request-premium']

  // 1. Check session — return premium data without payment
  if (walletAddress) {
    const session = sessions.get(walletAddress)
    if (session && Date.now() < session.expires) {
      if (process.env.NODE_ENV === 'development') {
        console.log('[x402] session hit for %s', walletAddress)
      }
      return servePremiumData(coords, res)
    }
  }

  // 2. Payment header present — verify & settle via facilitator
  if (paymentHeader) {
    try {
      // Decode the payment from the X-PAYMENT header
      const decodedPayment = exact.evm.decodePayment(paymentHeader)
      decodedPayment.x402Version = 1

      if (process.env.NODE_ENV === 'development') {
        console.log('[x402] decoded payment from wallet, scheme=%s, network=%s', decodedPayment.scheme, decodedPayment.network)
      }

      // Build per-request payment requirements with full resource URL
      const reqPaymentRequirements = { ...paymentRequirements, resource: resourceUrl }

      // Find matching payment requirements
      const matched = findMatchingPaymentRequirements([reqPaymentRequirements], decodedPayment)
      if (!matched) {
        return res.status(400).json({
          success: false,
          error: 'No matching payment requirements for this payment',
        })
      }

      // Verify the payment
      const verifyResult = await facilitator.verify(decodedPayment, matched)
      if (process.env.NODE_ENV === 'development') {
        console.log('[x402] verify result: isValid=%s, payer=%s', verifyResult.isValid, verifyResult.payer)
      }
      if (!verifyResult.isValid) {
        return res.status(402).json({
          ...x402Response,
          error: `Payment invalid: ${verifyResult.invalidReason || 'unknown reason'}`,
        })
      }

      // Settle the payment
      const settleResult = await facilitator.settle(decodedPayment, matched)
      if (process.env.NODE_ENV === 'development') {
        console.log('[x402] settle result: success=%s, tx=%s, payer=%s', settleResult.success, settleResult.transaction, settleResult.payer)
      }
      if (!settleResult.success) {
        return res.status(402).json({
          ...x402Response,
          error: `Settlement failed: ${settleResult.errorReason || 'unknown reason'}`,
        })
      }

      // Create session
      const payer = (settleResult.payer || walletAddress || '').toLowerCase()
      if (payer) {
        sessions.set(payer, {
          expires: Date.now() + SESSION_DURATION,
          txHash: settleResult.transaction,
        })
        if (process.env.NODE_ENV === 'development') {
          console.log('[x402] session created for %s, tx=%s', payer, settleResult.transaction)
        }
      }

      // Set X-PAYMENT-RESPONSE header
      const paymentResponse = {
        success: settleResult.success,
        transaction: settleResult.transaction,
        network: settleResult.network,
        payer: settleResult.payer,
      }
      res.setHeader('X-PAYMENT-RESPONSE', safeBase64Encode(JSON.stringify(paymentResponse)))

      return servePremiumData(coords, res)
    } catch (err) {
      console.error('[x402] payment processing error:', err)
      return res.status(500).json({
        success: false,
        error: err instanceof Error ? err.message : 'Payment processing failed',
      })
    }
  }

  // 3. Premium requested but no payment — return 402 with payment requirements
  if (requestsPremium) {
    if (process.env.NODE_ENV === 'development') {
      console.log('[x402] returning 402 with payment requirements')
    }
    return res.status(402).json({
      ...x402Response,
      accepts: [{ ...paymentRequirements, resource: resourceUrl }],
    })
  }

  // 4. Free request
  return serveFreeData(coords, res)
}

async function servePremiumData(
  coords: { lat: number; lng: number },
  res: NextApiResponse<SolarApiResponse>
) {
  try {
    const { data } = await fetchSolarData(coords, { bypassCache: true, premium: true })
    return res.status(200).json({
      success: true,
      data,
      cached: false,
      timestamp: Date.now(),
    })
  } catch (error) {
    console.error('Solar API error:', error)
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch solar data',
    })
  }
}

async function serveFreeData(
  coords: { lat: number; lng: number },
  res: NextApiResponse<SolarApiResponse>
) {
  try {
    const { data, cached } = await fetchSolarData(coords)
    return res.status(200).json({
      success: true,
      data,
      cached,
      timestamp: Date.now(),
    })
  } catch (error) {
    console.error('Solar API error:', error)
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to fetch solar data',
    })
  }
}
