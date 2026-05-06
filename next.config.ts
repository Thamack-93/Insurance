import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["*.janeway.replit.dev", "*.replit.dev"],
  experimental: {
    turbopackFileSystemCacheForDev: false,
    turbopackFileSystemCacheForBuild: false,
  },
  async redirects() {
    return [
      { source: "/payments", destination: "/receipts?tab=cobrar", permanent: false },
      { source: "/payments/new", destination: "/receipts?tab=cobrar", permanent: false },
      { source: "/data-quality", destination: "/risks?tab=completitud", permanent: false },
    ];
  },
};

export default nextConfig;
