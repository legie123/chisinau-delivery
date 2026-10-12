#!/usr/bin/env bash
# Gate: no service-role secret in anything a browser can receive. Runs at the end of `npm run build`
# (and standalone: npm run check:bundle).
# Scans: .next/static, .next/server (prerendered HTML/RSC), public/ (served verbatim), and the same for
# apps/*/. Fails on: any JWT whose payload says role=service_role (local or production), any
# `sb_secret_` key, and — when the local stack is up — the local service key's signature.
# Refuses (exit 2): no build, a build older than the source it should cover, or a failed positive
# control (no anon key found = wrong build; "0 secrets" would then be a false green).
# Limits, stated so they are not mistaken for coverage: RSC payloads of DYNAMIC routes exist only at
# request time (e.g. the /platform pages that use the service client) — they are protected by
# `import "server-only"` in src/lib/supabase/admin.ts, not by this scan; a key assembled by string
# concatenation is not detectable statically.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .next/BUILD_ID ] || { echo "✗ no .next build — run next build first" >&2; exit 2; }

newest=$(find src packages/*/src apps/*/app public -type f -newer .next/BUILD_ID 2>/dev/null | head -1 || true)
if [ -n "$newest" ]; then echo "✗ stale build: $newest is newer than .next/BUILD_ID — rebuild before trusting this gate" >&2; exit 2; fi

SVC_SIG=""
if out=$(bash scripts/supabase-status.sh 2>/dev/null); then
  SVC_SIG=$(printf '%s\n' "$out" | sed -n 's/^SERVICE_ROLE_KEY="\(.*\)"$/\1/p' | awk -F. '{print $NF}')
fi

SVC_SIG="$SVC_SIG" node - <<'NODE'
const fs = require("fs"), path = require("path");
const roots = [".next/static", ".next/server", "public"];
for (const app of fs.existsSync("apps") ? fs.readdirSync("apps") : []) {
  for (const sub of [".next/static", ".next/server", "public"]) roots.push(path.join("apps", app, sub));
}
const present = roots.filter((d) => fs.existsSync(d));
const exts = /\.(js|mjs|cjs|css|html|rsc|json|txt|body|meta|map|svg|webmanifest)$/;
const jwt = /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
const secretKey = /sb_secret_[A-Za-z0-9_-]{10,}/;
const sig = process.env.SVC_SIG || "";
let files = 0, controls = 0;
const bad = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== "cache") walk(p); continue; }
    if (!exts.test(e.name)) continue;
    files++;
    const t = fs.readFileSync(p, "utf8");
    if (sig && t.includes(sig)) bad.push(`${p}: local service key signature`);
    if (secretKey.test(t)) bad.push(`${p}: sb_secret_ key`);
    if (t.includes("sb_publishable_")) controls++;
    for (const m of t.match(jwt) ?? []) {
      try {
        const role = JSON.parse(Buffer.from(m.split(".")[1], "base64url").toString("utf8"))?.role;
        if (role === "service_role") bad.push(`${p}: JWT with role=service_role`);
        if (role === "anon") controls++;
      } catch {}
    }
  }
};
present.forEach(walk);
if (controls === 0) { console.error(`✗ control failed: no anon/publishable key in ${files} files — wrong or missing build?`); process.exit(2); }
if (bad.length) { console.error("FAIL: service-role secret reachable by the browser:\n  " + [...new Set(bad)].join("\n  ")); process.exit(1); }
console.log(`PASS: no service-role secret in ${files} files of ${present.join(" + ")} (control hits: ${controls})`);
NODE
