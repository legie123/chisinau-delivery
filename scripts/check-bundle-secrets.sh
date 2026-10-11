#!/usr/bin/env bash
# Gate: no service_role key in what a browser can receive. Run AFTER `next build`:
#   npm run check:bundle
# Scans .next/static (client JS/CSS) AND .next/server (prerendered HTML/RSC payloads sent to the
# browser). Fails on (1) the local service key's signature and (2) ANY JWT whose payload says
# role=service_role — that also catches a production key, which this machine never sees.
# Positive control: the anon key MUST be found; if not, the scan is looking at no build or the
# wrong one, and "0 service keys" would be a false green.
# Known limit: a key split by string concatenation in source is not detectable here; that is
# what the server-only import of src/lib/supabase/admin.ts ("server-only") prevents.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -d .next/static ] || { echo "✗ no .next/static — run next build first" >&2; exit 2; }
eval "$(bash scripts/supabase-status.sh 2>/dev/null | grep -E '^(SERVICE_ROLE_KEY|ANON_KEY)=')"
[ -n "${SERVICE_ROLE_KEY:-}" ] && [ -n "${ANON_KEY:-}" ] || { echo "✗ cannot read local keys" >&2; exit 2; }

SVC_SIG="${SERVICE_ROLE_KEY##*.}" ANON_SIG="${ANON_KEY##*.}" node - <<'NODE'
const fs = require("fs"), path = require("path");
const roots = [".next/static", ".next/server"].filter((d) => fs.existsSync(d));
const exts = /\.(js|mjs|cjs|css|html|rsc|json|txt|body|meta|map)$/;
const jwt = /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
let files = 0, ctl = 0;
const bad = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (exts.test(e.name)) {
      files++;
      const t = fs.readFileSync(p, "utf8");
      if (t.includes(process.env.ANON_SIG)) ctl++;
      if (t.includes(process.env.SVC_SIG)) bad.push(`${p}: local service key signature`);
      for (const m of t.match(jwt) ?? []) {
        try {
          const payload = JSON.parse(Buffer.from(m.split(".")[1], "base64url").toString("utf8"));
          if (payload && payload.role === "service_role") bad.push(`${p}: JWT with role=service_role`);
        } catch {}
      }
    }
  }
};
roots.forEach(walk);
if (ctl === 0) { console.error(`✗ control failed: anon key not found in ${files} files — wrong or missing build?`); process.exit(2); }
if (bad.length) { console.error("FAIL: service_role key reachable by the browser:\n  " + [...new Set(bad)].join("\n  ")); process.exit(1); }
console.log(`PASS: no service_role key in ${files} files of ${roots.join(" + ")} (control: anon key in ${ctl})`);
NODE
