// Smoke against the REAL local API: the test customer reports a problem on one of their delivered
// orders through the same calls the order screen uses (customer_report_problem, then the RLS read).
// Leaves one complaint + one ops alert tagged "SMOKE"; remove them afterwards.
// Run: node scripts/run-smoke.mjs report-problem-smoke.ts
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@chisinau/shared-types";

export async function main(env: { url: string; anonKey: string; email: string; password: string }) {
  const db = createClient<Database>(env.url, env.anonKey, { auth: { persistSession: false } });
  const { error: inErr } = await db.auth.signInWithPassword({ email: env.email, password: env.password });
  if (inErr) throw new Error(`sign-in failed: ${inErr.message}`);
  const { data: orders } = await db.from("orders").select("id, order_number").eq("status", "delivered").order("created_at", { ascending: false }).limit(20);
  let target: { id: string; order_number: string } | null = null;
  for (const o of orders ?? []) {
    const { data: c } = await db.from("order_complaints").select("id").eq("order_id", o.id).eq("status", "open").limit(1);
    if (!c?.length) { target = o; break; }
  }
  if (!target) throw new Error("no delivered order without an open complaint");
  const { error: repErr } = await db.rpc("customer_report_problem", { p_order_id: target.id, p_kind: "missing_item", p_note: "SMOKE: lipsea sosul" });
  const { data: mine } = await db.from("order_complaints").select("status, note").eq("order_id", target.id).order("created_at", { ascending: false }).limit(1);
  const { error: againErr } = await db.rpc("customer_report_problem", { p_order_id: target.id, p_kind: "late", p_note: "SMOKE: a doua" });
  const result = { order: target.order_number, reportError: repErr?.message ?? null, readBack: mine?.[0] ?? null, secondRefused: againErr?.message ?? "ALLOWED" };
  return { ok: !repErr && mine?.[0]?.status === "open" && !!againErr, result };
}
