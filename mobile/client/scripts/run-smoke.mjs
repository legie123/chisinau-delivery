// Bundles scripts/place-order-smoke.ts with esbuild (the repo's, from ../../node_modules),
// mapping @chisinau/* to ../../packages exactly like metro.config.js, then runs it.
// Credentials: SUPABASE_URL / SUPABASE_ANON_KEY env, else parsed from `supabase status -o env`
// (never printed). Test customer: SMOKE_EMAIL / SMOKE_PASSWORD, default client@test.md.
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "..");
const packages = path.resolve(appRoot, "../../packages");

function localSupabaseEnv() {
  const out = execFileSync("supabase", ["status", "-o", "env"], { cwd: path.resolve(appRoot, "../.."), encoding: "utf8" });
  const get = (k) => out.match(new RegExp(`^${k}="?([^"\\n]+)"?$`, "m"))?.[1];
  return { url: get("API_URL"), anonKey: get("ANON_KEY") };
}

const local = process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY ? null : localSupabaseEnv();
const env = {
  url: process.env.SUPABASE_URL ?? local.url,
  anonKey: process.env.SUPABASE_ANON_KEY ?? local.anonKey,
  email: process.env.SMOKE_EMAIL ?? "client@test.md",
  password: process.env.SMOKE_PASSWORD ?? "parola123",
};
if (!env.url || !env.anonKey) throw new Error("smoke: no Supabase URL / anon key");

const outfile = path.join(mkdtempSync(path.join(tmpdir(), "client-smoke-")), "smoke.mjs");
await build({
  entryPoints: [path.join(here, "place-order-smoke.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile,
  logLevel: "error",
  nodePaths: [path.join(appRoot, "node_modules")],
  alias: {
    "@chisinau/shared-types": path.join(packages, "shared-types/src/index.ts"),
    "@chisinau/shared-api": path.join(packages, "shared-api/src/index.ts"),
    "@chisinau/shared-domain": path.join(packages, "shared-domain/src/index.ts"),
  },
});
const { main } = await import(pathToFileURL(outfile).href);
const { ok, result } = await main(env);
console.log(JSON.stringify(result, null, 2));
console.log(ok ? "SMOKE PASS" : "SMOKE FAIL");
process.exit(ok ? 0 : 1);
