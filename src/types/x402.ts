// x402 payment protocol types

export interface X402EndpointConfig {
  price: string           // USD amount (e.g., "$0.001" or "0.001")
  description: string
  freeTier: boolean       // Allow free access with limitations
  freeDelayMinutes?: number // Delay for free tier (if applicable)
}

export interface X402Config {
  receiverAddress: string
  network: 'base' | 'base-sepolia' | 'solana-devnet' | 'solana'
  facilitatorUrl: string
  solanaReceiverAddress?: string
}

export interface X402PricingConfig {
  [endpoint: string]: X402EndpointConfig
}

export interface PaymentReceipt {
  txHash: string
  amount: string
  timestamp: number
  endpoint: string
}

// x402 402 response payload
export interface X402PaymentRequired {
  x402Version: number
  accepts: Array<{
    scheme: string
    network: string
    maxAmountRequired: string
    resource: string
    description: string
    mimeType: string
    payTo: string
    maxTimeoutSeconds: number
    asset: string
    extra?: Record<string, unknown>
  }>
}
