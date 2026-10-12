// Justifies every package that moved between two package-lock.json files (lockfile v3).
// A moved package is JUSTIFIED when a direct dependency whose spec changed in package.json
// (the SDK bump) reaches it; it is DRIFT when only unchanged direct deps reach it.
// Reachability over-justifies (verif-curier, round 2), so every SDK-reached package that existed before is
// also tested for FORCED: would its OLD version still satisfy the range of every package that requires it
// in the new lock? If yes, the move was a float (npm picked a newer version it did not need).
// usage: node scripts/lock-justify.mjs <old-lock.json> <new-lock.json> [--table]
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const semver = createRequire(import.meta.url)("semver");

const [oldPath, newPath, flag] = process.argv.slice(2);
const oldLock = JSON.parse(readFileSync(oldPath, "utf8"));
const newLock = JSON.parse(readFileSync(newPath, "utf8"));

const nameOf = (p) => p.slice(p.lastIndexOf("node_modules/") + "node_modules/".length);
function versions(lock) {
  const m = new Map();
  for (const [p, v] of Object.entries(lock.packages)) {
    if (!p) continue;
    const n = nameOf(p);
    if (!m.has(n)) m.set(n, new Set());
    m.get(n).add(v.version);
  }
  return m;
}
// Which direct deps reach each package path (node resolution: walk up node_modules).
function reach(lock) {
  const pk = lock.packages;
  const resolve = (from, name) => {
    let base = from;
    for (;;) {
      const cand = (base ? base + "/" : "") + "node_modules/" + name;
      if (pk[cand]) return cand;
      if (!base) return null;
      const i = base.lastIndexOf("/node_modules/");
      base = i < 0 ? "" : base.slice(0, i);
    }
  };
  const roots = Object.keys({ ...pk[""].dependencies, ...pk[""].devDependencies });
  const by = new Map();
  for (const r of roots) {
    const start = resolve("", r);
    const stack = start ? [start] : [];
    const seen = new Set();
    while (stack.length) {
      const p = stack.pop();
      if (seen.has(p)) continue;
      seen.add(p);
      if (!by.has(p)) by.set(p, new Set());
      by.get(p).add(r);
      const e = pk[p];
      for (const d of Object.keys({ ...e.dependencies, ...e.optionalDependencies, ...e.peerDependencies })) {
        const q = resolve(p, d);
        if (q) stack.push(q);
      }
    }
  }
  return by;
}
const rootsByName = (lock, name) => {
  const out = new Set();
  for (const [p, rs] of reach(lock)) if (nameOf(p) === name) rs.forEach((r) => out.add(r));
  return out;
};

const oldRoot = oldLock.packages[""], newRoot = newLock.packages[""];
const spec = (r, n) => ({ ...r.dependencies, ...r.devDependencies })[n];
const sdkRoots = new Set(
  Object.keys({ ...newRoot.dependencies, ...newRoot.devDependencies }).filter((n) => spec(oldRoot, n) !== spec(newRoot, n)),
);
const ov = versions(oldLock), nv = versions(newLock);
const names = [...new Set([...ov.keys(), ...nv.keys()])].sort();
const rows = [];
for (const n of names) {
  const a = [...(ov.get(n) ?? [])].sort().join(","), b = [...(nv.get(n) ?? [])].sort().join(",");
  if (a === b) continue;
  const rs = rootsByName(nv.has(n) ? newLock : oldLock, n);
  const sdk = [...rs].filter((r) => sdkRoots.has(r));
  rows.push({ n, a: a || "-", b: b || "-", verdict: sdk.length ? "SDK" : rs.size ? "DRIFT" : "ORPHAN", via: (sdk.length ? sdk : [...rs]).slice(0, 3).join(" ") });
}
// requirers of a name in the new lock: every entry whose deps / optional / peer list it, with the range
const requirers = new Map();
for (const [p, e] of Object.entries(newLock.packages)) {
  for (const [d, range] of Object.entries({ ...e.dependencies, ...e.optionalDependencies, ...e.peerDependencies })) {
    if (!requirers.has(d)) requirers.set(d, []);
    requirers.get(d).push({ by: p || "(root)", range });
  }
}
for (const r of rows) {
  if (r.verdict !== "SDK" || r.a === "-" || r.b === "-") continue;
  const olds = r.a.split(",");
  const reqs = requirers.get(r.n) ?? [];
  const oldStillOk = olds.some((v) => reqs.every((q) => semver.satisfies(v, q.range, { includePrerelease: true })));
  if (oldStillOk) {
    r.verdict = "SDK-UNFORCED";
    r.via = reqs.slice(0, 2).map((q) => `${q.by.replace(/^.*node_modules\//, "")} ${q.range}`).join("; ");
  }
}
const count = (v) => rows.filter((r) => r.verdict === v).length;
console.log(`direct deps changed by the bump (${sdkRoots.size}): ${[...sdkRoots].sort().join(" ")}`);
console.log(`moved packages: ${rows.length}  SDK-forced: ${count("SDK")}  SDK-unforced (float): ${count("SDK-UNFORCED")}  DRIFT: ${count("DRIFT")}  ORPHAN: ${count("ORPHAN")}`);
for (const r of rows) if (flag === "--table" || r.verdict !== "SDK") console.log(`${r.verdict}\t${r.n}\t${r.a} -> ${r.b}\tvia ${r.via}`);
