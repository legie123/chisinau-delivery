// Cross-app E2E harness: real GoTrue logins for every role, the real shared-api wrappers (the
// code the web server actions and both native apps call), a read-only SQL helper for the
// audit facts RLS hides from the apps, and a report collector. LOCAL STACK ONLY.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@chisinau/shared-types";

export type Db = SupabaseClient<Database>;

// Clean env: this machine's shell wrapper (`_lc`) breaks plain commands (see CLAUDE.md).
const WRAP = { HOME: process.env.HOME ?? "", PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin" } as unknown as NodeJS.ProcessEnv;

function stackEnv(): Record<string, string> {
  // Through scripts/supabase-status.sh: it loads the rotated JWT secret that config.toml reads via
  // env(); plain `supabase status` derives the keys from the unresolved literal (79dc0ee).
  const script = path.resolve(process.cwd(), "scripts/supabase-status.sh");
  const out = execFileSync("bash", [script], { env: WRAP, encoding: "utf8" });
  const env: Record<string, string> = {};
  for (const m of out.matchAll(/^([A-Z_]+)="(.*)"$/gm)) env[m[1]] = m[2];
  if (!env.API_URL || !env.ANON_KEY) throw new Error("Local Supabase is not running (bash scripts/supabase-up.sh).");
  if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(env.API_URL)) throw new Error("E2E runs against the LOCAL stack only.");
  return env;
}
export const stack = stackEnv();

export const PASSWORD = "parola123";

export type Session = { db: Db; userId: string; email: string };

export async function login(email: string): Promise<Session> {
  const db = createClient<Database>(stack.API_URL, stack.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await db.auth.signInWithPassword({ email, password: PASSWORD });
  if (error || !data.user) throw new Error(`login ${email}: ${error?.message}`);
  return { db, userId: data.user.id, email };
}

/** Read-only audit SQL through the DB container (rows split on "|"). Never used for writes. */
export function sql(query: string): string[][] {
  const out = execFileSync(
    "docker",
    ["exec", "-i", "supabase_db_chisinau-delivery", "psql", "-U", "postgres", "-d", "postgres", "-At", "-F", "|", "-v", "ON_ERROR_STOP=1"],
    { env: WRAP, input: query, encoding: "utf8" },
  );
  return out.trim() === "" ? [] : out.trim().split("\n").map((l) => l.split("|"));
}

/** Anonymous client: the public anon key and nothing else (what any visitor holds). */
export function anonClient(): Db {
  return createClient<Database>(stack.API_URL, stack.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** A page of the running web app as a dev-doorway role (client | restaurant | platform): GET html. */
export async function webSession(role: "client" | "restaurant" | "platform", base = "http://localhost:3007") {
  const r = await fetch(`${base}/enter/${role}`, { method: "POST", redirect: "manual" });
  const cookie = r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  if (!cookie) throw new Error(`${base}/enter/${role}: no session cookie (is the dev server up? status ${r.status})`);
  return async (route: string): Promise<{ status: number; html: string }> => {
    const res = await fetch(base + route, { headers: { cookie }, redirect: "follow" });
    return { status: res.status, html: await res.text() };
  };
}

export function viewerClient(token: string): Db {
  return createClient<Database>(stack.API_URL, stack.ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function until<T>(what: string, fn: () => Promise<T | null | undefined | false>, ms = 12000, every = 400): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timeout waiting for ${what}`);
    await sleep(every);
  }
}

// ---- report ----
export type Check = { scenario: string; step: string; ok: boolean; detail: string };
export const checks: Check[] = [];
export const facts: Record<string, Record<string, unknown>> = {};

export function check(scenario: string, step: string, ok: boolean, detail = ""): boolean {
  checks.push({ scenario, step, ok, detail });
  return ok;
}
export const failures = () => checks.filter((c) => !c.ok);

export function fact(scenario: string, key: string, value: unknown) {
  (facts[scenario] ??= {})[key] = value;
}

export function writeReport(runId: string): string {
  const file = process.env.E2E_REPORT ?? path.join(__dirname, ".last-report.json");
  writeFileSync(file, JSON.stringify({ runId, at: new Date().toISOString(), checks, facts }, null, 1));
  return file;
}

export function table(): string {
  const scenarios = [...new Set(checks.map((c) => c.scenario))];
  return scenarios
    .map((s) => {
      const mine = checks.filter((c) => c.scenario === s);
      const bad = mine.filter((c) => !c.ok);
      return [
        `${bad.length === 0 ? "PASS" : "FAIL"}  ${s}  (${mine.length - bad.length}/${mine.length})`,
        ...mine.map((c) => `   ${c.ok ? "✓" : "✗"} ${c.step}${c.detail ? "  — " + c.detail : ""}`),
      ].join("\n");
    })
    .join("\n\n");
}
