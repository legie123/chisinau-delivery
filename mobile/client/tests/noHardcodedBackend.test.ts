import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

// Red-team 2026-10-02: the prototype shipped a paused remote project URL + anon JWT as
// a silent fallback. A build without its env must fail loudly (src/lib/config.ts),
// never talk to some other backend. Source scan, no app imports: runs on any revision.
const appRoot = path.resolve(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx|js|json)$/.test(name) ? [p] : [];
  });
}

describe("backend config", () => {
  it("no hard-coded project URL, project ref or JWT anywhere in the app source", () => {
    const files = [...sourceFiles(path.join(appRoot, "src")), path.join(appRoot, "App.tsx"), path.join(appRoot, "index.ts"), path.join(appRoot, "app.json")];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      expect(text, f).not.toMatch(/[a-z]{20}\.supabase\.co/);
      expect(text, f).not.toMatch(/eyJhbGciOi/);
      expect(text, f).not.toMatch(/EXPO_PUBLIC_SUPABASE_[A-Z_]+\s*\?\?/);
    }
  });
});
