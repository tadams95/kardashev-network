# Kardashev Network

## Project Overview
Next.js app with x402 micropayments for premium solar irradiance data. Supports dual-chain payments: EVM (Base Sepolia) and Solana (Devnet).

## Tech Stack
- Next.js (Pages Router), React, TypeScript
- x402 / x402-fetch for payment protocol
- wagmi/viem for EVM wallet integration
- @solana/wallet-adapter-react + @solana/web3.js for Solana wallet integration
- SWR for data fetching
- Tailwind CSS

## Key Architecture

### x402 Payment Flow
1. Client requests premium data -> server returns 402 with `accepts[]` (both EVM and Solana requirements)
2. x402-fetch intercepts the 402, selects a payment requirement, has the wallet sign it, retries with `X-PAYMENT` header
3. Server verifies+settles via x402.org facilitator, creates session, returns premium data

### Critical: Chain-Type Matching
**x402-fetch does NOT automatically match the signer type to payment requirements.** When the server's 402 response contains both EVM and Solana requirements, x402-fetch may select the wrong one (e.g., EVM requirement for a Solana signer), causing "Invalid evm wallet client provided".

**Solution:** In `usePremiumSolarData.ts`, the `fetch` function passed to `wrapFetchWithPayment` is wrapped to filter the 402 response body, removing requirements that don't match `activeChainType` BEFORE x402-fetch processes them. Do NOT use a custom `paymentRequirementsSelector` for this — it runs too late and fallback logic can silently pick cross-chain requirements.

### Key Files
- `src/hooks/usePremiumSolarData.ts` — payment orchestration, chain-filtered fetch wrapper
- `src/hooks/useMultiChainX402.ts` — dual-chain state management (activeChainType, activeSigner)
- `src/hooks/useX402Solana.ts` — bridges @solana/wallet-adapter-react to x402's TransactionPartialSigner
- `src/hooks/useX402.ts` — EVM wallet setup
- `src/components/PaymentGate.tsx` — payment UI with chain selector
- `src/pages/api/solar/irradiance.ts` — API route with 402 payment verification

### Environment Variables (Payment)
- `X402_RECEIVER_ADDRESS` — EVM wallet to receive payments (required)
- `X402_SOLANA_RECEIVER_ADDRESS` — Solana wallet to receive payments (required for Solana payments)
- `NEXT_PUBLIC_X402_NETWORK` — EVM network (default: base-sepolia)
- `NEXT_PUBLIC_SOLANA_NETWORK` — Solana network (default: solana-devnet)
- `NEXT_PUBLIC_SOLANA_RPC_URL` — Solana RPC endpoint

## Commands
- `npm run dev` — start dev server
- `npx tsc --noEmit` — type-check without emitting
- `npm run build` — production build
- `npm run lint` — ESLint
