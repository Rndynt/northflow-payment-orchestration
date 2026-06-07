import type { NextConfig } from "next";

const devDomain = process.env.NEXT_PUBLIC_REPLIT_DEV_DOMAIN;

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@northflow/payment-orchestration-client-sdk"],
  allowedDevOrigins: devDomain ? [devDomain, `*.${devDomain}`] : [],
};

export default nextConfig;
