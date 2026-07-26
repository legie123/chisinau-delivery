import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  // Workspace packages ship TS source; Next transpiles them (Master Council Phase 1).
  transpilePackages: ["@chisinau/shared-types", "@chisinau/shared-api"],
};

export default nextConfig;
