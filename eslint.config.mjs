import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Expo apps — own toolchain, not part of the Next.js build/lint.
    "mobile/**",
    // App shells (apps/*): the default '.next/**' only covers the root build output.
    "apps/*/.next/**",
    "apps/*/next-env.d.ts",
    // Agent git worktrees (.claude/worktrees/*) are whole copies of the repo: linting them
    // reported a worktree's half-done work as errors of main.
    ".claude/**",
  ]),
]);

export default eslintConfig;
