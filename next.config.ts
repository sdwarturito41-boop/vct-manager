import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "cdn-api.pandascore.co" },
      { protocol: "https", hostname: "placehold.co" },
    ],
  },
};

export default nextConfig;
