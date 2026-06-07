import type { NextConfig } from "next";

const devDomain = process.env.NEXT_PUBLIC_REPLIT_DEV_DOMAIN;

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: [
    "@northflow/payment-orchestration-client-sdk",
    "@northflow/payment-orchestration-core",
  ],
  allowedDevOrigins: devDomain ? [devDomain, `*.${devDomain}`] : [],
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.plugins = config.plugins ?? [];
      const { NormalModuleReplacementPlugin } = require("webpack");
      config.plugins.push(
        new NormalModuleReplacementPlugin(/^node:crypto$/, "crypto-browserify"),
        new NormalModuleReplacementPlugin(/^node:buffer$/, "buffer/"),
        new NormalModuleReplacementPlugin(/^node:stream$/, "stream-browserify"),
      );
      config.resolve = config.resolve ?? {};
      config.resolve.fallback = {
        ...(config.resolve.fallback ?? {}),
        crypto: require.resolve("crypto-browserify"),
        buffer: require.resolve("buffer/"),
        stream: require.resolve("stream-browserify"),
        vm: false,
      };
    }
    return config;
  },
};

export default nextConfig;
