const webpack = require('webpack');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    instrumentationHook: true,
  },
  webpack: (config, { isServer }) => {
    config.resolve.fallback = { fs: false, net: false, tls: false };
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
