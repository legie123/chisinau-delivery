import path from "node:path";
import type { NextConfig } from "next";
import base from "../../next.config";

// Thin shell: the monolith config (transpilePackages, sw.js header) is the
// single source; only the roots move up to the repo so ../../src compiles.
const root = path.resolve(__dirname, "../..");

const nextConfig: NextConfig = {
  ...base,
  turbopack: {
    ...base.turbopack,
    root,
    // View-as: in THIS app every monolith import of the Supabase client factories lands on a
    // shell wrapper that returns the read-only viewer client on /view/* and the normal session
    // client everywhere else (apps/master/lib/viewAs/*). The monolith build is untouched.
    resolveAlias: {
      ...base.turbopack?.resolveAlias,
      // Relative to this app's directory (Turbopack resolves alias targets inside the project).
      "@/lib/supabase/server": "./lib/viewAs/serverClient.ts",
      "@/lib/supabase/client": "./lib/viewAs/browserClient.ts",
    },
  },
  outputFileTracingRoot: root,
};

export default nextConfig;
