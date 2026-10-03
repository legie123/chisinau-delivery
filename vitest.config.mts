import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // Same mapping as tsconfig paths — no node_modules link needed (no root lockfile change).
      "@chisinau/shared-domain": path.resolve(__dirname, "packages/shared-domain/src/index.ts"),
    },
  },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
});
