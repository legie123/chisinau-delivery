"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/require";

export type ActionResult = { error: string | null };

// WS10 — mark a fraud flag reviewed. Plain RLS-guarded UPDATE (admin-only policy);
// no state machine, so no guarded RPC (project rule: simple toggles are direct writes).
export async function markFlagReviewed(flagId: string): Promise<ActionResult> {
  let supabase;
  let user;
  try {
    ({ supabase, user } = await requireUser());
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Neautentificat." };
  }

  const { error } = await supabase
    .from("fraud_flags")
    .update({ reviewed_at: new Date().toISOString(), reviewed_by: user.id })
    .eq("id", flagId);
  if (error) return { error: error.message };

  revalidatePath("/platform/fraud");
  return { error: null };
}
