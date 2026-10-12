// Smoke against the REAL local API: a fresh customer signs up, deletes the account through the RPC the
// Profile screen calls (delete_my_account), and must not be able to sign in again. Leaves one
// anonymized user row ("sters-<uuid>@deleted.invalid"), which is the point.
// Run: node scripts/run-smoke.mjs delete-account-smoke.ts
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@chisinau/shared-types";

export async function main(env: { url: string; anonKey: string; password: string }) {
  const db = createClient<Database>(env.url, env.anonKey, { auth: { persistSession: false } });
  const email = `delete-smoke-${Date.now()}@test.md`;
  const password = env.password; // the documented local test password (run-smoke.mjs)
  const { data: up, error: upErr } = await db.auth.signUp({ email, password, options: { data: { full_name: "Smoke Ștergere" } } });
  if (upErr) throw new Error(`sign-up failed: ${upErr.message}`);
  const { error: inErr } = await db.auth.signInWithPassword({ email, password });
  if (inErr) throw new Error(`first sign-in failed: ${inErr.message}`);

  const { error: delErr } = await db.rpc("delete_my_account");
  await db.auth.signOut({ scope: "local" }).catch(() => {});
  const { error: againErr } = await db.auth.signInWithPassword({ email, password });

  const result = {
    userId: up.user?.id,
    deleteError: delErr?.message ?? null,
    signInAfterDelete: againErr ? `refused: ${againErr.message}` : "ALLOWED",
  };
  return { ok: !delErr && !!againErr, result };
}
