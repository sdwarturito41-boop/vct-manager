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
  // Force-include Prisma's engine binaries in Vercel's serverless bundle.
  // Our generator uses a custom output path (`src/generated/prisma`) which Next
  // doesn't auto-trace, so the `.so.node` RHEL binary gets dropped in prod.
  outputFileTracingIncludes: {
    "/**/*": [
      "./src/generated/prisma/**/*",
      "./node_modules/.prisma/client/**/*",
    ],
  },
};

export default nextConfig;
