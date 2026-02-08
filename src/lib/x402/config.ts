// x402 payment configuration

import type { X402Config, X402PricingConfig } from '@/types/x402'

export const X402_PRICING: X402PricingConfig = {
  '/api/solar/irradiance': {
    price: '$0.001',
    description: 'Live solar data, hourly forecasts, 7-day predictions & roof analysis',
    freeTier: true,
    freeDelayMinutes: 15,
  },
  '/api/grid/carbon': {
    price: '$0.002',
    description: 'Grid carbon intensity',
    freeTier: true,
  },
  '/api/buildings/area': {
    price: '$0.005',
    description: 'Building footprint data',
    freeTier: false,
  },
  '/api/geocode/search': {
    price: '$0.001',
    description: 'Address geocoding',
    freeTier: true,
  },
  '/api/premium/analytics': {
    price: '$0.01',
    description: 'Premium analytics and historical data',
    freeTier: false,
  },
} as const

export const X402_CONFIG: X402Config = {
  receiverAddress: process.env.X402_RECEIVER_ADDRESS || '',
  network: (process.env.NEXT_PUBLIC_X402_NETWORK as X402Config['network']) || 'base-sepolia',
  facilitatorUrl: process.env.NEXT_PUBLIC_X402_NETWORK === 'base'
    ? 'https://x402.org/facilitator'
    : 'https://x402.org/facilitator', // Same URL works for testnet
  solanaReceiverAddress: process.env.X402_SOLANA_RECEIVER_ADDRESS || '',
}

// Helper to get pricing for an endpoint
export function getEndpointPricing(endpoint: string) {
  return X402_PRICING[endpoint] || null
}

// Helper to check if endpoint requires payment (no free tier)
export function requiresPayment(endpoint: string): boolean {
  const pricing = X402_PRICING[endpoint]
  return pricing ? !pricing.freeTier : false
}
