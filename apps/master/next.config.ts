import path from "node:path";
import type { NextConfig } from "next";
import base from "../../next.config";

// Thin shell: the monolith config (transpilePackages, sw.js header) is the
// single source; only the roots move up to the repo so ../../src compiles.
const root = path.resolve(__dirname, "../..");

const nextConfig: NextConfig = {
  ...base,
  turbopack: { ...base.turbopack, root },
  outputFileTracingRoot: root,
};

export default nextConfig;
