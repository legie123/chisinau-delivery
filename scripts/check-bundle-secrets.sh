#!/usr/bin/env bash
# Gate: no service-role secret in anything a browser can receive. Runs at the end of `npm run build`,
# of apps/master and apps/restaurant builds (arg = app dir), and standalone: npm run check:bundle [dir].
# Scans: .next/static, the browser-bound payloads in .next/server (html/rsc/body/meta — not the
# server-only JS there), public/ (served verbatim: every file,
# whatever its extension), and the same for apps/*/. Fails on: any JWT whose payload says
# role=service_role (local or production), any `sb_secret_` key, the name of the project JWT secret
# variable, and — when the local stack is up — the local service key's signature and the project JWT
# secret's value (whoever holds it can mint service_role tokens).
# Refuses (exit 2): no build, a build older than the source or config it should cover, or a failed
# positive control (no anon key found = wrong build; "0 secrets" would then be a false green).
# Limits, stated so they are not mistaken for coverage: RSC payloads of DYNAMIC routes exist only at
# request time (e.g. the /platform pages that use the service client), so this scan cannot see them.
# `import "server-only"` (src/lib/supabase/admin.ts, src/lib/viewAs/token.ts) only stops a CLIENT
# component from importing those modules; it does not stop a Server Component passing a secret from
# process.env as a prop — review for that. A key assembled by string concatenation is not detectable
# statically either.
set -euo pipefail
cd "$(dirname "$0")/.."
BUILD_DIR="${1:-.}"
[ -f "$BUILD_DIR/.next/BUILD_ID" ] || { echo "✗ no build in $BUILD_DIR/.next — run next build first" >&2; exit 2; }

newest=$(find src packages/*/src apps/*/app apps/*/lib public next.config.* apps/*/next.config.* apps/*/proxy.ts \
           .env .env.local .env.production apps/*/.env* -type f -newer "$BUILD_DIR/.next/BUILD_ID" 2>/dev/null | head -1 || true)
if [ -n "$newest" ]; then echo "✗ stale build: $newest is newer than $BUILD_DIR/.next/BUILD_ID — rebuild before trusting this gate" >&2; exit 2; fi

SVC_SIG=""; JWT_SEC=""
if out=$(bash scripts/supabase-status.sh 2>/dev/null); then
  SVC_SIG=$(printf '%s\n' "$out" | sed -n 's/^SERVICE_ROLE_KEY="\(.*\)"$/\1/p' | awk -F. '{print $NF}')
  JWT_SEC=$(printf '%s\n' "$out" | sed -n 's/^JWT_SEC''RET="\(.*\)"$/\1/p')
fi

SVC_SIG="$SVC_SIG" JWT_SEC="$JWT_SEC" node - <<'NODE'
const fs = require("fs"), path = require("path");
const roots = [".next/static", ".next/server", "public"]; // root build + shared public/
for (const app of fs.existsSync("apps") ? fs.readdirSync("apps") : []) {
  for (const sub of [".next/static", ".next/server", "public"]) roots.push(path.join("apps", app, sub));
}
const present = roots.filter((d) => fs.existsSync(d));
const exts = /\.(js|mjs|cjs|css|html|rsc|json|txt|body|meta|map|svg|webmanifest)$/i;
const isPublic = (p) => p.split(path.sep).includes("public");
// .next/server holds two kinds of files: server-only JS (never sent to a browser; reading
// process.env there is correct) and prerendered payloads that ARE sent (html, rsc, body, meta…).
const sentFromServer = /\.(html|rsc|body|meta|txt|json|segment)$/i;
const isServerDir = (p) => p.split(path.sep).join("/").includes(".next/server/");
const jwt = /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
const secretKey = /sb_secret_[A-Za-z0-9_-]{10,}/;
const secretVarName = ["SUPABASE", "JWT", "SEC" + "RET"].join("_");
const sig = process.env.SVC_SIG || "";
const jwtSec = process.env.JWT_SEC || "";
let files = 0, controls = 0;
const bad = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== "cache") walk(p); continue; }
    if (isServerDir(p) ? !sentFromServer.test(e.name) : !exts.test(e.name) && !isPublic(p)) continue;
    if (fs.statSync(p).size > 20 * 1024 * 1024) continue;
    files++;
    const t = fs.readFileSync(p, "latin1");
    if (sig && t.includes(sig)) bad.push(`${p}: local service key signature`);
    if (jwtSec && t.includes(jwtSec)) bad.push(`${p}: project JWT secret value`);
    if (t.includes(secretVarName)) bad.push(`${p}: ${secretVarName} name`);
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
