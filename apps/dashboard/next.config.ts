import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@northflow/payment-orchestration-client-sdk"],
};

export default nextConfig;
