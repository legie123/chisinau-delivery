import { defineConfig } from "vitest/config";
import path from "node:path";

// Pure-logic tests for the courier app (no React Native runtime). Run with the
// repo root's vitest: `npm test` here (= ../../node_modules/.bin/vitest).
const packages = path.resolve(__dirname, "../../packages");

export default defineConfig({
  resolve: {
    alias: {
      "@chisinau/shared-types": path.join(packages, "shared-types/src/index.ts"),
      "@chisinau/shared-api": path.join(packages, "shared-api/src/index.ts"),
      "@chisinau/shared-domain": path.join(packages, "shared-domain/src/index.ts"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
