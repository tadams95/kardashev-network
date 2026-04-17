import { useState, useCallback, useEffect, useMemo } from 'react'
import useSWR, { mutate as globalMutate } from 'swr'
import { wrapFetchWithPayment } from 'x402-fetch'
import { settleResponseFromHeader } from 'x402/types'
import { useMultiChainX402 } from './useMultiChainX402'
import type { ChainType } from './useMultiChainX402'
import { calculateWastedValueFromData } from '@/lib/calculations/solarValue'
import { X402_PRICING } from '@/lib/x402/config'
import type { SolarData, SolarApiResponse, WastedEnergy } from '@/types/solar'
import type { X402PaymentRequired } from '@/types/x402'

interface UsePremiumSolarDataReturn {
  solarData: SolarData | undefined
  wastedEnergy: WastedEnergy | undefined
  isLoading: boolean
  isError: boolean
  error: Error | undefined
  isPremium: boolean
  isCached: boolean
  paymentRequired: X402PaymentRequired | null
  showPaymentGate: boolean
  setShowPaymentGate: (show: boolean) => void
  initiatePayment: () => Promise<string | null>
  paymentState: {
    isPending: boolean
    isSuccess: boolean
    isError: boolean
    error: string | null
    txHash: string | null
  }
  refresh: () => void
  upgradeToPremium: () => void
  isWrongChain: boolean
  switchToCorrectChain: () => void
  isSwitchingChain: boolean
  requiredChainName: string
  activeChainType: ChainType
  preferredChain: ChainType
  setPreferredChain: (chain: ChainType) => void
  getExplorerTxUrl: (txHash: string) => string
  isConnected: boolean
  signerReady: boolean
  evmConnected: boolean
  solConnected: boolean
}

const SESSION_TOKEN_STORAGE_KEY = 'kn_x402_session_token'

export function usePremiumSolarData(
  lat: number | null | undefined,
  lng: number | null | undefined,
  roofAreaM2?: number,
  electricityRate?: number,
  yearlySavings?: number,
): UsePremiumSolarDataReturn {
  // Optimistic init (per plan §3.2 / OQ#2): if a session token is in
  // localStorage, assume premium until the first server response
  // confirms or demotes. Smoother UX for the common case (returning
  // user with a valid session) at the cost of a brief premium → free
  // flicker for users with an expired token.
  //
  // Premium semantics here are PER-BROWSER, not per-wallet. The localStorage
  // token works for any wallet active in this browser. Wallet switches
  // mid-session don't tear down `isPremium` — the server resolves via
  // token first (`irradiance.ts:215-237`), so the token from wallet A
  // keeps wallet B premium until expiry. Justification: x402's pitch is
  // "no account, just pay" — the wallet is the signing instrument, not
  // the user identity, and at $0.001/30min the abuse vector is
  // economically uninteresting. Revisit if the price tier ever changes.
  const [isPremium, setIsPremium] = useState(() => {
    if (typeof window === 'undefined') return false
    return !!window.localStorage.getItem(SESSION_TOKEN_STORAGE_KEY)
  })
  const [showPaymentGate, setShowPaymentGate] = useState(false)
  const [sessionToken, setSessionToken] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    return window.localStorage.getItem(SESSION_TOKEN_STORAGE_KEY)
  })

  const {
    activeChainType,
    preferredChain,
    setPreferredChain,
    isConnected,
    activeSigner,
    activeAddress,
    paymentState,
    setPaymentState,
    isWrongChain,
    switchToCorrectChain,
    isSwitchingChain,
    requiredChainName,
    x402FetchConfig,
    getExplorerTxUrl,
    evm,
    sol,
  } = useMultiChainX402()

  const solarPricing = X402_PRICING['/api/solar/irradiance']
  const priceAmount = solarPricing?.price.replace('$', '') || '0.001'
  const desc = solarPricing?.description || 'Real-time solar irradiance data'
  const evmNetwork = process.env.NEXT_PUBLIC_X402_NETWORK || 'base-sepolia'
  const solNetwork = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'solana-devnet'
  const defaultPaymentRequired = useMemo<X402PaymentRequired>(() => ({
    x402Version: 1,
    accepts: [
      {
        scheme: 'exact',
        network: evmNetwork,
        maxAmountRequired: priceAmount,
        resource: '/api/solar/irradiance',
        description: desc,
        mimeType: 'application/json',
        payTo: '',
        maxTimeoutSeconds: 300,
        asset: 'USDC',
      },
      {
        scheme: 'exact',
        network: solNetwork,
        maxAmountRequired: priceAmount,
        resource: '/api/solar/irradiance',
        description: desc,
        mimeType: 'application/json',
        payTo: '',
        maxTimeoutSeconds: 300,
        asset: 'USDC',
      },
    ],
  }), [priceAmount, desc, evmNetwork, solNetwork])

  const shouldFetch = lat != null && lng != null && !isNaN(lat) && !isNaN(lng)
  const baseUrl = shouldFetch ? `/api/solar/irradiance?lat=${lat}&lng=${lng}` : null

  // Include wallet address in SWR key so session-aware refetches work
  // and include session token marker to force revalidation when token rotates.
  const swrKey = shouldFetch
    ? activeAddress
      ? `${baseUrl}&session=${activeAddress}&token=${sessionToken ? '1' : '0'}`
      : `${baseUrl}&token=${sessionToken ? '1' : '0'}`
    : null

  // SWR fetcher — include signed session token (primary) and wallet (legacy fallback)
  const fetcher = useCallback(async (url: string): Promise<SolarApiResponse> => {
    // Strip session param from URL before fetching
    const fetchUrl = url
      .replace(/&session=[a-zA-Z0-9]+/g, '')
      .replace(/&token=[01]/g, '')
    const headers: Record<string, string> = {}
    if (sessionToken) {
      headers['X-Session-Token'] = sessionToken
    }
    if (activeAddress) {
      headers['X-Wallet-Address'] = activeAddress
    }
    const res = await fetch(fetchUrl, { headers })

    const nextToken = res.headers.get('x-session-token')
    if (nextToken && nextToken !== sessionToken) {
      setSessionToken(nextToken)
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, nextToken)
      }
    }

    if (!res.ok && res.status !== 402) {
      throw new Error('Failed to fetch solar data')
    }
    return res.json()
  }, [activeAddress, sessionToken])

  const { data, error, isLoading, mutate } = useSWR<SolarApiResponse>(
    swrKey,
    fetcher,
    {
      refreshInterval: isPremium ? 0 : 300000,
      revalidateOnFocus: false,
    }
  )

  // Mirror server's premium flag — single source of truth for isPremium
  // once a response has arrived. Handles BOTH directions:
  //   • Promotion: server-recognized session (token in localStorage) →
  //     `data.premium` true → isPremium true. Covers page refresh +
  //     resume-in-new-tab.
  //   • Demotion: session expired or invalidated → `data.premium`
  //     false → isPremium false. The previous code only handled
  //     promotion, so a stale isPremium=true could persist after
  //     server-side expiry.
  //
  // Wallet disconnect (activeAddress falsy) still resets immediately —
  // even though the localStorage token might still resolve a premium
  // response server-side, the user has no signer for any premium
  // follow-up action, so the premium UI shouldn't claim active state.
  // Wallet *switch* (A → B with both connected at different times)
  // is intentionally a no-op here per the per-browser session model.
  useEffect(() => {
    if (!activeAddress) {
      setIsPremium(false)
      return
    }
    // `data` is undefined during refetch — keep current isPremium until
    // the new response lands. Avoids a free-flicker on every refetch.
    if (data) {
      setIsPremium(!!data.premium)
    }
  }, [data, activeAddress])

  const wastedEnergy = data?.data
    ? calculateWastedValueFromData(data.data, roofAreaM2, !!roofAreaM2, electricityRate)
    : undefined

  // When Google Solar yearly savings is available, anchor monthly estimate to it
  // instead of extrapolating from today's irradiance (which overestimates on sunny days)
  if (wastedEnergy && yearlySavings) {
    wastedEnergy.monthlyEstimate = Math.round(yearlySavings / 12)
  }

  // Premium upgrade via x402-fetch
  const initiatePayment = useCallback(async () => {
    if (!activeSigner || !baseUrl) {
      if (process.env.NODE_ENV === 'development') {
        console.error('[x402] initiatePayment aborted: signer=%o, baseUrl=%s', activeSigner, baseUrl)
      }
      setPaymentState({
        isPending: false,
        isSuccess: false,
        isError: true,
        error: !activeSigner
          ? 'Wallet not ready — try disconnecting and reconnecting'
          : 'Location not set',
        txHash: null,
      })
      return null
    }

    setPaymentState({
      isPending: true,
      isSuccess: false,
      isError: false,
      error: null,
      txHash: null,
    })

    try {
      if (process.env.NODE_ENV === 'development') {
        console.log('[x402] initiatePayment: url=%s, address=%s, chain=%s', baseUrl, activeAddress, activeChainType)
      }

      // Wrap fetch to filter the 402 response body so x402-fetch only
      // sees payment requirements matching the active chain. This prevents
      // signer/requirement mismatch (Solana signer + EVM requirement).
      const chainFilteredFetch: typeof fetch = async (input, init) => {
        const res = await fetch(input, init)
        if (res.status !== 402) return res

        const body = await res.json()
        if (Array.isArray(body.accepts)) {
          const isSvm = activeChainType === 'svm'
          const chainAccepts = body.accepts.filter((r: any) =>
            isSvm ? r.network?.startsWith('solana') : !r.network?.startsWith('solana')
          )
          if (process.env.NODE_ENV === 'development') {
            console.log('[x402] 402 accepts: %d total, %d for %s', body.accepts.length, chainAccepts.length, activeChainType)
          }
          if (chainAccepts.length === 0) {
            throw new Error(
              isSvm
                ? 'Server does not accept Solana payments. Check that X402_SOLANA_RECEIVER_ADDRESS is configured.'
                : 'Server does not accept EVM payments.'
            )
          }
          body.accepts = chainAccepts
        }
        return new Response(JSON.stringify(body), {
          status: 402,
          statusText: res.statusText,
          headers: res.headers,
        })
      }

      const premiumFetch = wrapFetchWithPayment(
        chainFilteredFetch,
        activeSigner as Parameters<typeof wrapFetchWithPayment>[1],
        undefined,
        undefined,
        x402FetchConfig
      )
      const response = await premiumFetch(baseUrl, {
        headers: {
          'X-Request-Premium': 'true',
          'X-Wallet-Address': activeAddress!,
          ...(sessionToken ? { 'X-Session-Token': sessionToken } : {}),
        },
      })

      // x402-fetch does NOT throw on facilitator failures — it returns the 402 response.
      // We must check response.ok to catch verify/settle failures.
      if (!response.ok) {
        const errorBody = await response.json().catch(() => null)
        if (process.env.NODE_ENV === 'development') {
          console.error('[x402] payment response error body:', errorBody)
          console.error('[x402] response status:', response.status, response.statusText)
        }
        const reason = errorBody?.error || `Payment failed (${response.status})`
        const settlement = errorBody?.settlement || null

        const err = new Error(typeof reason === 'string' ? reason : JSON.stringify(reason))
        ;(err as any).settlement = settlement
        ;(err as any).statusCode = response.status
        throw err
      }

      const result: SolarApiResponse = await response.json()

      // Extract tx hash from settlement response header
      const paymentResponseHeader = response.headers.get('x-payment-response')
      const nextToken = response.headers.get('x-session-token')
      if (nextToken && nextToken !== sessionToken) {
        setSessionToken(nextToken)
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, nextToken)
        }
      }
      if (process.env.NODE_ENV === 'development') {
        console.log('[x402] payment response status:', response.status)
        console.log('[x402] x-payment-response header:', paymentResponseHeader)
      }
      let txHash: string | null = null
      if (paymentResponseHeader) {
        try {
          const settlement = settleResponseFromHeader(paymentResponseHeader)
          txHash = settlement.transaction || null
        } catch {
          // Fallback: try JSON parse directly
          try {
            const parsed = JSON.parse(paymentResponseHeader)
            txHash = parsed.transaction || null
          } catch {
            // Header might be the tx hash itself
            txHash = paymentResponseHeader
          }
        }
      }

      setIsPremium(true)
      setPaymentState({
        isPending: false,
        isSuccess: true,
        isError: false,
        error: null,
        txHash,
      })
      setShowPaymentGate(false)

      // Inject premium data directly into SWR cache. Per plan §3.3:
      // setSessionToken(nextToken) above rotates the swrKey
      // (because line ~122's key includes `&token=${sessionToken ? '1' : '0'}`)
      // — but the closure-captured `mutate` is bound to the *pre-rotation*
      // key. Calling `mutate(result)` would write to the soon-to-be-orphaned
      // entry, and the new render's new key would trigger an extra fetch.
      // Use the global mutate API with the explicit post-rotation key so
      // the new SWR cache entry is hydrated directly.
      if (result.success && result.data) {
        const tokenMarker = nextToken ? '1' : '0'
        const newSwrKey = activeAddress
          ? `${baseUrl}&session=${activeAddress}&token=${tokenMarker}`
          : `${baseUrl}&token=${tokenMarker}`
        globalMutate(newSwrKey, result, { revalidate: false })
      }
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.error('[x402] payment error:', error)
        if (error instanceof TypeError && error.cause) {
          console.error('[x402] error cause:', error.cause)
        }
      }

      let message = error instanceof Error ? error.message : 'Payment failed'
      const settlement = (error as any)?.settlement || null
      const statusCode = (error as any)?.statusCode || null

      // Surface the underlying cause (e.g. ECONNREFUSED, HPE_HEADER_OVERFLOW)
      if (error instanceof TypeError && error.cause instanceof Error && error.cause.message) {
        message = `${message} (${error.cause.message})`
      }

      // Append actionable hint based on error pattern
      if (message.includes('transaction_failed') && activeChainType === 'svm') {
        message += '\n\nThis usually means insufficient USDC balance on Solana Devnet. Use a faucet to get devnet USDC, or check that your Phantom wallet has the correct token account.'
      } else if (message.includes('transaction_failed')) {
        message += '\n\nThis usually means insufficient USDC balance or missing token approval. Check that your wallet has testnet USDC on Base Sepolia.'
      } else if (message.includes('insufficient') && activeChainType === 'svm') {
        message += '\n\nYour Solana wallet does not have enough USDC on Devnet. Fund it via a Solana devnet USDC faucet.'
      } else if (message.includes('Payment invalid')) {
        message += '\n\nThe payment signature was rejected. Try disconnecting and reconnecting your wallet.'
      }

      if (process.env.NODE_ENV === 'development' && statusCode) {
        console.error('[x402] payment failed with status %d, settlement:', statusCode, settlement)
      }

      setPaymentState({
        isPending: false,
        isSuccess: false,
        isError: true,
        error: message,
        txHash: settlement?.transaction || null,
      })
    }

    return null
  }, [activeSigner, baseUrl, activeAddress, activeChainType, setPaymentState, x402FetchConfig, sessionToken])

  const upgradeToPremium = useCallback(() => {
    setShowPaymentGate(true)
  }, [])

  const refresh = useCallback(() => {
    mutate()
  }, [mutate])

  return {
    solarData: data?.data,
    wastedEnergy,
    isLoading,
    isError: !!error || data?.success === false,
    error: error || (data?.error ? new Error(data.error) : undefined),
    isPremium,
    isCached: data?.cached ?? false,
    paymentRequired: defaultPaymentRequired,
    showPaymentGate,
    setShowPaymentGate,
    initiatePayment,
    paymentState,
    refresh,
    upgradeToPremium,
    isWrongChain,
    switchToCorrectChain,
    isSwitchingChain,
    requiredChainName,
    activeChainType,
    preferredChain,
    setPreferredChain,
    getExplorerTxUrl,
    isConnected,
    signerReady: !!activeSigner,
    evmConnected: evm.isConnected,
    solConnected: sol.isConnected,
  }
}
