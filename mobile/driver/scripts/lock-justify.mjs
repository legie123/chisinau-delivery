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
// Per INSTANCE (verif-curier round 3: name-level requirers miscount): for every path in the new lock whose
// version did not exist before under that name, collect the requirers that RESOLVE to that path; the move is a
// float when some old version would satisfy all of them. A duplicate that was only removed is not a move.
const npk = newLock.packages;
const resolveIn = (pk, from, name) => {
  let base = from;
  for (;;) {
    const cand = (base ? base + "/" : "") + "node_modules/" + name;
    if (pk[cand]) return cand;
    if (!base) return null;
    const i = base.lastIndexOf("/node_modules/");
    base = i < 0 ? "" : base.slice(0, i);
  }
};
const requirersOf = new Map();
for (const [p, e] of Object.entries(npk)) {
  for (const [kind, deps] of [["dep", e.dependencies], ["opt", e.optionalDependencies], ["peer", e.peerDependencies]]) {
    for (const [d, range] of Object.entries(deps || {})) {
      const q = resolveIn(npk, p, d);
      if (!q) continue;
      if (!requirersOf.has(q)) requirersOf.set(q, []);
      requirersOf.get(q).push({ by: p || "(root)", range, kind });
    }
  }
}
const floats = [];
let movedInstances = 0;
for (const [p, e] of Object.entries(npk)) {
  if (!p) continue;
  const olds = ov.get(nameOf(p));
  if (!olds || olds.has(e.version)) continue; // new package, or a version that already existed
  movedInstances++;
  const reqs = requirersOf.get(p) ?? [];
  const fits = [...olds].filter((v) => reqs.every((q) => { try { return semver.satisfies(v, q.range, { includePrerelease: true }); } catch { return false; } }));
  if (reqs.length && fits.length) floats.push({ p, from: [...olds].join(","), to: e.version, via: reqs.slice(0, 2).map((q) => `${q.by.replace(/^.*node_modules\//, "")} ${q.range}`).join("; ") });
}
const count = (v) => rows.filter((r) => r.verdict === v).length;
console.log(`direct deps changed by the bump (${sdkRoots.size}): ${[...sdkRoots].sort().join(" ")}`);
console.log(`moved package names: ${rows.length}  reached by the SDK bump: ${count("SDK")}  DRIFT: ${count("DRIFT")}  ORPHAN: ${count("ORPHAN")}`);
console.log(`moved instances: ${movedInstances}  forced by a range: ${movedInstances - floats.length}  unforced floats: ${floats.length}`);
for (const f of floats) console.log(`FLOAT\t${f.p.replace(/^node_modules\//, "")}\t${f.from} -> ${f.to}\tvia ${f.via}`);
for (const r of rows) if (flag === "--table" || r.verdict !== "SDK") console.log(`${r.verdict}\t${r.n}\t${r.a} -> ${r.b}\tvia ${r.via}`);
