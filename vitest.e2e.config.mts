import { defineConfig } from "vitest/config";
import path from "node:path";

// Cross-app E2E against the LOCAL stack (commits data). Not part of `npm test`.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@chisinau/shared-domain": path.resolve(__dirname, "packages/shared-domain/src/index.ts"),
    },
  },
  test: {
    include: ["tests/e2e/**/*.e2e.test.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 60_000,
  },
});
