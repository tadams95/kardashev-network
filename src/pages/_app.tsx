import "@/styles/globals.css";
import "@coinbase/onchainkit/styles.css";
import { useEffect } from "react";
import type { AppProps } from "next/app";

import { OnchainKitProvider } from "@coinbase/onchainkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, createConfig, http } from "wagmi";
import { baseSepolia, base } from "wagmi/chains";
import { coinbaseWallet, injected } from "wagmi/connectors";
import { LocationProvider } from "@/context/LocationContext";
import SolanaProvider from "@/providers/SolanaProvider";
import { setCalibrationModel } from "@/lib/models/weatherProbability";

const isProduction = process.env.NEXT_PUBLIC_X402_NETWORK === "base";
const chain = isProduction ? base : baseSepolia;

const wagmiConfig = createConfig({
  chains: [chain],
  connectors: [
    coinbaseWallet({
      appName: "Kardashev Network",
      preference: "all",
    }),
    injected(),
  ],
  transports: {
    [baseSepolia.id]: http('https://sepolia.base.org'),
    [base.id]: http('https://mainnet.base.org'),
  },
  ssr: true,
});

const queryClient = new QueryClient();

export default function App({ Component, pageProps }: AppProps) {
  // Load persisted calibration model on app startup
  useEffect(() => {
    fetch('/api/weather/calibration')
      .then(res => res.json())
      .then(data => {
        if (data.success && data.data) {
          setCalibrationModel(data.data)
          console.log('[app] Calibration model loaded:', data.data.sampleSize, 'samples')
        }
      })
      .catch(() => {
        // No calibration model yet — will use uncalibrated probabilities
      })
  }, [])

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <OnchainKitProvider
          chain={chain}
          config={{
            appearance: {
              name: "Kardashev Network",
              logo: "https://www.svgrepo.com/show/323986/earth-sun.svg",
              mode: "dark",
              theme: "base",
            },
          }}
        >
          <SolanaProvider>
            <LocationProvider>
              <Component {...pageProps} />
            </LocationProvider>
          </SolanaProvider>
        </OnchainKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
