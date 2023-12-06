import "@/styles/globals.css";
import type { AppProps } from "next/app";

import { getDefaultWallets, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { createConfig, configureChains, WagmiConfig } from "wagmi";
import { mainnet } from "wagmi/chains";
import { publicProvider } from "wagmi/providers/public";
import { SessionProvider } from "next-auth/react";
import "@rainbow-me/rainbowkit/styles.css";

const { chains, publicClient, webSocketPublicClient } = configureChains(
  [mainnet],
  [publicProvider()]
);

const { connectors } = getDefaultWallets({
  appName: "kardashev-network",
  projectId: "94716ac6945bdb2f5a440e647d03e3f3", // Get your project ID from https://cloud.walletconnect.com/
  chains,
});

const config = createConfig({
  autoConnect: true,
  publicClient,
  webSocketPublicClient,
  connectors,
});

//added RainbowKitProvider
export default function App({ Component, pageProps }: AppProps | any) {
  return (
    <WagmiConfig config={config}>
    <SessionProvider session={pageProps.session} refetchInterval={0}>
      <RainbowKitProvider chains={chains}>
        <Component {...pageProps} />
      </RainbowKitProvider>
    </SessionProvider>
  </WagmiConfig>
  );
}
