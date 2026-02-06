import { NextRequest, NextResponse } from 'next/server'
import { paymentMiddleware } from 'x402-next'

const sessions = new Map<string, { expires: number; txHash: string }>()
const SESSION_DURATION = 30 * 60 * 1000

const x402 = paymentMiddleware(
  (process.env.X402_RECEIVER_ADDRESS || '0x0000000000000000000000000000000000000000') as `0x${string}`,
  {
    '/api/solar/irradiance': {
      price: '$0.001',
      network: (process.env.NEXT_PUBLIC_X402_NETWORK as 'base' | 'base-sepolia') || 'base-sepolia',
      config: { description: 'Premium solar irradiance data' },
    },
  },
  { url: 'https://x402.org/facilitator' as `https://${string}` }
)

function cleanExpiredSessions() {
  const now = Date.now()
  for (const [key, session] of sessions) {
    if (now > session.expires) {
      sessions.delete(key)
    }
  }
}

export async function middleware(request: NextRequest) {
  cleanExpiredSessions()

  const walletAddress = request.headers.get('x-wallet-address')
  const hasPaymentHeader = !!request.headers.get('x-payment')
  const requestsPremium = !!request.headers.get('x-request-premium')

  // Check for existing session
  if (walletAddress) {
    const session = sessions.get(walletAddress.toLowerCase())
    if (session && Date.now() < session.expires) {
      const headers = new Headers(request.headers)
      headers.set('x-premium-verified', 'true')
      return NextResponse.next({
        request: { headers },
      })
    }
  }

  // If request has payment header or requests premium, delegate to x402
  if (hasPaymentHeader || requestsPremium) {
    const response = await x402(request as unknown as Parameters<typeof x402>[0])

    // Check if x402 settled successfully (non-402 response with payment response header)
    const paymentResponseHeader = response.headers.get('x-payment-response')
    if (response.status !== 402 && paymentResponseHeader) {
      // Store session for the payer
      let txHash = ''
      try {
        const decoded = JSON.parse(atob(paymentResponseHeader))
        txHash = decoded.transaction || decoded.txHash || ''
      } catch {
        txHash = paymentResponseHeader
      }

      if (walletAddress) {
        sessions.set(walletAddress.toLowerCase(), {
          expires: Date.now() + SESSION_DURATION,
          txHash,
        })
      }

      // Forward the response with premium verification
      response.headers.set('x-premium-verified', 'true')
    }

    return response
  }

  // Free request - passthrough
  return NextResponse.next()
}

export const config = {
  matcher: '/api/solar/irradiance',
}
