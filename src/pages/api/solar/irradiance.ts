import type { NextApiRequest, NextApiResponse } from 'next'
import { fetchSolarData } from '@/lib/api/openMeteo'
import { useFacilitator as createFacilitator } from 'x402/verify'
import { decodePayment } from 'x402/schemes'
import {
  processPriceToAtomicAmount,
  findMatchingPaymentRequirements,
  safeBase64Encode,
  getDefaultAsset,
} from 'x402/shared'
import type { PaymentRequirements, Network } from 'x402/types'
import { SupportedSVMNetworks } from 'x402/types'
import type { SolarApiResponse } from '@/types/solar'

// ── Config (persistent across requests) ──────────────────────────────
function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `FATAL: ${name} env var is not set. Refusing to start — payments would be lost.`
    )
  }
  return value
}
const EVM_RECEIVER_ADDRESS = requireEnv('X402_RECEIVER_ADDRESS')
const SOLANA_RECEIVER_ADDRESS = process.env.X402_SOLANA_RECEIVER_ADDRESS || ''
const EVM_NETWORK = (process.env.NEXT_PUBLIC_X402_NETWORK || 'base-sepolia') as Network
const SOLANA_NETWORK = (process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'solana-devnet') as Network
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

// ── EVM Payment requirements ─────────────────────────────────────────
const evmPriceResult = processPriceToAtomicAmount('$0.001', EVM_NETWORK)
const evmDefaultAsset = getDefaultAsset(EVM_NETWORK)

function buildEvmPaymentRequirements(): PaymentRequirements {
  if ('error' in evmPriceResult) {
    throw new Error(`Failed to process EVM price: ${evmPriceResult.error}`)
  }
  return {
    scheme: 'exact',
    network: EVM_NETWORK,
    maxAmountRequired: evmPriceResult.maxAmountRequired,
    asset: evmDefaultAsset.address,
    resource: '',
    description: 'Premium solar irradiance data',
    mimeType: 'application/json',
    payTo: EVM_RECEIVER_ADDRESS,
    maxTimeoutSeconds: 300,
    extra: evmDefaultAsset.eip712,
  }
}

// ── Solana Payment requirements ──────────────────────────────────────
let solanaPaymentRequirements: PaymentRequirements | null = null

function buildSolanaPaymentRequirements(): PaymentRequirements | null {
  if (!SOLANA_RECEIVER_ADDRESS) return null
  try {
    const solanaPriceResult = processPriceToAtomicAmount('$0.001', SOLANA_NETWORK)
    if ('error' in solanaPriceResult) {
      console.warn(`[x402] Failed to process Solana price: ${solanaPriceResult.error}`)
      return null
    }
    const solanaDefaultAsset = getDefaultAsset(SOLANA_NETWORK)
    return {
      scheme: 'exact',
      network: SOLANA_NETWORK,
      maxAmountRequired: solanaPriceResult.maxAmountRequired,
      asset: solanaDefaultAsset.address,
      resource: '',
      description: 'Premium solar irradiance data',
      mimeType: 'application/json',
      payTo: SOLANA_RECEIVER_ADDRESS,
      maxTimeoutSeconds: 300,
      extra: solanaDefaultAsset.eip712,
    }
  } catch (err) {
    console.warn('[x402] Could not build Solana payment requirements:', err)
    return null
  }
}

const evmPaymentRequirements = buildEvmPaymentRequirements()

try {
  solanaPaymentRequirements = buildSolanaPaymentRequirements()
} catch {
  // Solana requirements are optional
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

function isSvmNetwork(network: string): boolean {
  return SupportedSVMNetworks.includes(network as Network)
}

function getAllPaymentRequirements(resourceUrl: string): PaymentRequirements[] {
  const reqs: PaymentRequirements[] = [
    { ...evmPaymentRequirements, resource: resourceUrl },
  ]
  if (solanaPaymentRequirements) {
    reqs.push({ ...solanaPaymentRequirements, resource: resourceUrl })
  }
  return reqs
}

// ── Handler ──────────────────────────────────────────────────────────
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
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

  const walletAddress = req.headers['x-wallet-address'] as string | undefined
  const paymentHeader = req.headers['x-payment'] as string | undefined
  const requestsPremium = !!req.headers['x-request-premium']

  // 1. Check session — return premium data without payment
  // Use case-insensitive lookup for EVM (hex) addresses, case-sensitive for Solana (base58)
  if (walletAddress) {
    // Check both original case and lowercase for session lookup
    const session = sessions.get(walletAddress) || sessions.get(walletAddress.toLowerCase())
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
      // Universal decode — auto-detects EVM vs SVM
      const decodedPayment = decodePayment(paymentHeader)
      decodedPayment.x402Version = 1

      const paymentIsSvm = isSvmNetwork(decodedPayment.network)

      if (process.env.NODE_ENV === 'development') {
        console.log('[x402] decoded payment: scheme=%s, network=%s, isSvm=%s', decodedPayment.scheme, decodedPayment.network, paymentIsSvm)
      }

      // Build per-request payment requirements with full resource URL
      const allRequirements = getAllPaymentRequirements(resourceUrl)

      // Find matching payment requirements
      const matched = findMatchingPaymentRequirements(allRequirements, decodedPayment)
      if (!matched) {
        return res.status(400).json({
          success: false,
          error: 'No matching payment requirements for this payment',
        })
      }

      if (process.env.NODE_ENV === 'development') {
        console.log('[x402] matched requirements: network=%s', matched.network)
      }

      // Check for self-payment (from == to)
      const payerAddress = 'authorization' in decodedPayment.payload
        ? decodedPayment.payload.authorization.from
        : undefined
      if (payerAddress && matched.payTo &&
          payerAddress.toLowerCase() === matched.payTo.toLowerCase()) {
        return res.status(400).json({
          success: false,
          error: 'Self-payment detected: your wallet address matches the receiver address. Use a different wallet or update X402_RECEIVER_ADDRESS in .env.local.',
        })
      }

      // Verify the payment
      const verifyResult = await facilitator.verify(decodedPayment, matched)
      if (process.env.NODE_ENV === 'development') {
        console.log('[x402] verify result: isValid=%s, payer=%s', verifyResult.isValid, verifyResult.payer)
      }
      if (!verifyResult.isValid) {
        return res.status(402).json({
          x402Version: 1,
          accepts: allRequirements,
          error: `Payment invalid: ${verifyResult.invalidReason || 'unknown reason'}`,
          settlement: {
            errorReason: verifyResult.invalidReason || 'unknown',
            network: matched.network || 'unknown',
            payer: verifyResult.payer || null,
            transaction: null,
          },
        })
      }

      // Settle the payment
      const settleResult = await facilitator.settle(decodedPayment, matched)
      if (process.env.NODE_ENV === 'development') {
        console.log('[x402] settle result: success=%s, tx=%s, payer=%s', settleResult.success, settleResult.transaction, settleResult.payer)
      }
      if (!settleResult.success) {
        console.error('[x402] settlement FAILED — payer=%s, payTo=%s, errorReason=%s',
          settleResult.payer, matched.payTo, settleResult.errorReason)
        console.error('[x402] settlement FAILED — full result:', JSON.stringify(settleResult, null, 2))
        return res.status(402).json({
          x402Version: 1,
          accepts: allRequirements,
          error: `Settlement failed: ${settleResult.errorReason || 'unknown reason'}`,
          settlement: {
            errorReason: settleResult.errorReason || 'unknown',
            network: settleResult.network || 'unknown',
            payer: settleResult.payer || null,
            transaction: settleResult.transaction || null,
          },
        })
      }

      // Create session
      // For EVM addresses, store lowercase; for Solana (base58), store as-is
      const payer = settleResult.payer || walletAddress || ''
      const sessionKey = paymentIsSvm ? payer : payer.toLowerCase()
      if (sessionKey) {
        sessions.set(sessionKey, {
          expires: Date.now() + SESSION_DURATION,
          txHash: settleResult.transaction,
        })
        if (process.env.NODE_ENV === 'development') {
          console.log('[x402] session created for %s, tx=%s', sessionKey, settleResult.transaction)
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
        errorType: err instanceof Error ? err.constructor.name : typeof err,
      })
    }
  }

  // 3. Premium requested but no payment — return 402 with payment requirements
  if (requestsPremium) {
    if (process.env.NODE_ENV === 'development') {
      console.log('[x402] returning 402 with payment requirements')
    }
    return res.status(402).json({
      x402Version: 1,
      accepts: getAllPaymentRequirements(resourceUrl),
      error: 'X402: Payment Required',
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
      premium: true,
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
