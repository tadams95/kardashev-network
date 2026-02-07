import "@/styles/globals.css";
import "@coinbase/onchainkit/styles.css";
import type { AppProps } from "next/app";

import { OnchainKitProvider } from "@coinbase/onchainkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, createConfig, http } from "wagmi";
import { baseSepolia, base } from "wagmi/chains";
import { coinbaseWallet, injected } from "wagmi/connectors";
import { LocationProvider } from "@/context/LocationContext";

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
    [baseSepolia.id]: http(),
    [base.id]: http(),
  },
  ssr: true,
});

const queryClient = new QueryClient();

export default function App({ Component, pageProps }: AppProps) {
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
          <LocationProvider>
            <Component {...pageProps} />
          </LocationProvider>
        </OnchainKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
