import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  // Workspace packages ship TS source; Next transpiles them (Master Council Phase 1).
  transpilePackages: ["@chisinau/shared-types", "@chisinau/shared-api"],
  // Directive 9: cacheComponents was tried and REVERTED — see commit message /
  // build report. Enabling it broke prerendering on every per-user page that
  // reads cookies() (createClient()) without a <Suspense> boundary — 32 files
  // app-wide (orders/profile/courier/admin), not a one-liner fix, out of scope
  // for this conservative pass. Keeping only the sw.js no-cache header below.
  async headers() {
    return [
      {
        // Service worker must never be served stale — browsers/CDNs caching it
        // delays push-notification fixes reaching installed clients.
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "no-cache" }],
      },
    ];
  },
};

export default nextConfig;
