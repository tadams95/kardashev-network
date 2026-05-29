// x402 payment configuration

import type { X402PricingConfig } from '@/types/x402'

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
