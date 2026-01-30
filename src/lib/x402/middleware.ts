// x402 middleware for Next.js Pages Router
// Wraps API handlers to require payment via x402 protocol

import type { NextApiRequest, NextApiResponse, NextApiHandler } from 'next'
import { X402_CONFIG } from './config'
import type { X402EndpointConfig, X402PaymentRequired } from '@/types/x402'

interface WithX402Options {
  price: string
  description: string
  network?: 'base' | 'base-sepolia'
}

// Check if request has valid x402 payment header
function hasPaymentHeader(req: NextApiRequest): boolean {
  return !!req.headers['x-payment'] || !!req.headers['x-payment-response']
}

// Generate 402 Payment Required response
function generate402Response(
  options: WithX402Options,
  req: NextApiRequest
): X402PaymentRequired {
  const network = options.network || X402_CONFIG.network
  const priceValue = options.price.replace('$', '')

  // Construct the resource URL
  const protocol = req.headers['x-forwarded-proto'] || 'http'
  const host = req.headers.host || 'localhost:3000'
  const resource = `${protocol}://${host}${req.url}`

  return {
    x402Version: 1,
    accepts: [
      {
        scheme: 'exact',
        network: network,
        maxAmountRequired: priceValue,
        resource: resource,
        description: options.description,
        mimeType: 'application/json',
        payTo: X402_CONFIG.receiverAddress,
        maxTimeoutSeconds: 60,
        asset: 'USDC',
        extra: {
          facilitator: X402_CONFIG.facilitatorUrl,
        },
      },
    ],
  }
}

/**
 * Wrap a Pages Router API handler with x402 payment requirement
 *
 * For free tier endpoints, this will pass through without payment.
 * For paid endpoints, it returns 402 Payment Required with payment details.
 *
 * Note: Full payment verification requires the x402 package.
 * This implementation provides the 402 response structure.
 * Payment verification should be added when x402 deps are installed.
 */
export function withX402(
  handler: NextApiHandler,
  options: WithX402Options
): NextApiHandler {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    // Skip payment check if receiver address not configured
    if (!X402_CONFIG.receiverAddress) {
      console.warn('x402: No receiver address configured, skipping payment check')
      return handler(req, res)
    }

    // Check for payment header
    if (!hasPaymentHeader(req)) {
      // Return 402 Payment Required
      const paymentDetails = generate402Response(options, req)

      res.setHeader('Content-Type', 'application/json')
      res.setHeader('X-Payment-Required', 'true')
      return res.status(402).json(paymentDetails)
    }

    // Payment header present - verify payment
    // TODO: Add payment verification using x402 package
    // For now, we'll trust the payment header and proceed
    // This should be updated when x402 deps are installed

    const paymentHeader = req.headers['x-payment'] || req.headers['x-payment-response']
    if (typeof paymentHeader === 'string') {
      // Payment provided, execute the handler
      // In production, verify the payment signature here
      return handler(req, res)
    }

    // Invalid payment header format
    return res.status(400).json({
      error: 'Invalid payment header format',
    })
  }
}

/**
 * Middleware for endpoints with free tier support
 *
 * - Without payment: Returns cached/delayed data (free tier)
 * - With payment: Returns real-time data (paid tier)
 */
export function withX402FreeTier(
  handler: NextApiHandler,
  paidHandler: NextApiHandler,
  options: WithX402Options & { freeTierNote?: string }
): NextApiHandler {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    // If no receiver address configured, use free handler
    if (!X402_CONFIG.receiverAddress) {
      return handler(req, res)
    }

    // Check for payment header
    if (hasPaymentHeader(req)) {
      // Payment provided, use paid handler
      const paymentHeader = req.headers['x-payment'] || req.headers['x-payment-response']
      if (typeof paymentHeader === 'string') {
        return paidHandler(req, res)
      }
    }

    // No payment - return free tier data with upgrade prompt
    // Add header indicating free tier response
    res.setHeader('X-Free-Tier', 'true')
    res.setHeader('X-Upgrade-Available', 'true')

    // Generate payment info for upgrade
    const upgradeInfo = generate402Response(options, req)
    res.setHeader('X-Upgrade-Info', JSON.stringify(upgradeInfo))

    // Execute free tier handler
    return handler(req, res)
  }
}
