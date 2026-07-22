const webpack = require('webpack');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The production droplet is a 1-vCPU / 3.8 GB box; `next build`'s TypeScript +
  // ESLint validation phase needs ~2.6 GB and OOMs there at every heap size (see the
  // 2026-07-22 deploy incident). Webpack compilation itself succeeds. Type-safety is
  // NOT lost — it moves to `tsc --noEmit` + `vitest` in CI / pre-deploy, which stay
  // fully strict; only the in-build validation pass (the memory-heavy part) is skipped.
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  experimental: {
    instrumentationHook: true,
  },
  webpack: (config, { isServer }) => {
    config.resolve.fallback = { fs: false, net: false, tls: false, dns: false, child_process: false, stream: false, path: false };
    if (!isServer) {
      config.resolve.fallback.crypto = require('path').resolve(__dirname, 'src/lib/crypto-shim.mjs');
      // Solana packages need Buffer in the browser
      config.plugins.push(
        new webpack.ProvidePlugin({
          Buffer: ['buffer', 'Buffer'],
        })
      );
    }
    config.externals.push('pino-pretty', 'lokijs', 'encoding');
    config.resolve.alias = {
      ...config.resolve.alias,
      '@react-native-async-storage/async-storage': false,
    };
    return config;
  },
}

module.exports = nextConfig
