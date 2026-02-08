import { useState, useCallback, useMemo } from 'react'
import { useWallet, useConnection } from '@solana/wallet-adapter-react'
import { VersionedTransaction } from '@solana/web3.js'
import type { PaymentState } from './useX402'

const initialPaymentState: PaymentState = {
  isPending: false,
  isSuccess: false,
  isError: false,
  error: null,
  txHash: null,
}

/**
 * Bridge @solana/wallet-adapter-react → x402 SvmSigner (TransactionPartialSigner).
 *
 * x402's SvmSigner is `TransactionPartialSigner` from @solana/kit:
 *   { address: Address<string>, signTransactions(txs) => SignatureDictionary[] }
 *
 * The wallet adapter gives us `publicKey` + `signTransaction` using @solana/web3.js v1.
 * We bridge by serializing the v2 Transaction to wire bytes, deserializing as a v1
 * VersionedTransaction, signing, and extracting the signature back.
 */
export function useX402Solana() {
  const { publicKey, connected, signTransaction, wallet } = useWallet()
  const { connection } = useConnection()
  const [paymentState, setPaymentState] = useState<PaymentState>(initialPaymentState)

  const address = useMemo(
    () => (publicKey ? publicKey.toBase58() : null),
    [publicKey]
  )

  // Create x402-compatible TransactionPartialSigner from wallet adapter

  const solSigner = useMemo((): any => {
    if (!publicKey || !signTransaction || !connected) return null

    const signerAddress = publicKey.toBase58()

    return {
      address: signerAddress,
      async signTransactions(
      
        transactions: readonly any[]
    
      ): Promise<readonly Record<string, any>[]> {
        const results = []

        for (const tx of transactions) {
          // tx is a @solana/kit v2 Transaction: { messageBytes, signatures }
          // We need to get wire bytes, convert to v1 VersionedTransaction, sign, extract sig

          // Build the wire bytes from the v2 transaction
          // The v2 Transaction has `messageBytes` and `signatures` map
          const messageBytes: Uint8Array = tx.messageBytes

          // Get all signer addresses from the signatures map
          const signerAddresses = Object.keys(tx.signatures)

          // Build signature array in the correct order (matching the message's signer ordering)
          const signaturesArray: (Uint8Array | null)[] = signerAddresses.map(
          
            (addr: string) => (tx.signatures as any)[addr] ?? null
          )

          // Build wire-format bytes manually:
          // [1 byte: num_signatures] + [64 bytes * num_signatures] + [message_bytes]
          const numSigners = signaturesArray.length
          const wireBytes = new Uint8Array(1 + numSigners * 64 + messageBytes.length)
          wireBytes[0] = numSigners

          for (let i = 0; i < numSigners; i++) {
            const sig = signaturesArray[i]
            if (sig) {
              wireBytes.set(sig, 1 + i * 64)
            }
            // else: leave as zeros (unsigned placeholder)
          }
          wireBytes.set(messageBytes, 1 + numSigners * 64)

          // Deserialize as v1 VersionedTransaction
          const v1Tx = VersionedTransaction.deserialize(wireBytes)

          // Sign with wallet adapter
          const signed = await signTransaction(v1Tx)

          // Extract signature for our address
          // The first signature in a v1 VersionedTransaction is the fee payer's
          const signerIndex = signerAddresses.indexOf(signerAddress)
          const extractedSig = signed.signatures[signerIndex >= 0 ? signerIndex : 0]

          // Return as SignatureDictionary { [address]: Signature }
          const sigDict: Record<string, Uint8Array> = {}
          if (extractedSig) {
            sigDict[signerAddress] = new Uint8Array(extractedSig)
          }
          results.push(sigDict)
        }

        return results
      },
    }
  }, [publicKey, signTransaction, connected])

  const resetPayment = useCallback(() => {
    setPaymentState(initialPaymentState)
  }, [])

  const networkName = process.env.NEXT_PUBLIC_SOLANA_NETWORK === 'solana'
    ? 'Solana'
    : 'Solana Devnet'

  return {
    isConnected: connected && !!publicKey,
    address,
    solSigner,
    paymentState,
    setPaymentState,
    resetPayment,
    networkName,
    connection,
    walletName: wallet?.adapter.name ?? null,
  }
}
