"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/auth/require";

// Payout settlement actions — thin wrappers over the admin-only RPCs
// (admin_generate_payouts / admin_mark_payout_paid). The RPCs enforce
// platform_admin themselves; requirePlatformAdmin fails fast with a friendly
// message before we ever hit Postgres.
export type GeneratePayoutsResult = { error: string | null; count?: number };
export type MarkPaidResult = { error: string | null };

export async function generatePayouts(startISO: string, endISO: string): Promise<GeneratePayoutsResult> {
  try {
    const { supabase } = await requirePlatformAdmin();

    if (!startISO || !endISO) return { error: "Selectează perioada (început și sfârșit)." };
    if (startISO > endISO) return { error: "Data de început nu poate fi după data de sfârșit." };

    const { data, error } = await supabase.rpc("admin_generate_payouts", {
      p_start: startISO,
      p_end: endISO,
    });
    if (error) return { error: error.message };

    revalidatePath("/platform/payouts");
    return { error: null, count: typeof data === "number" ? data : Number(data ?? 0) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "A apărut o eroare." };
  }
}

export async function markPaid(payoutId: string): Promise<MarkPaidResult> {
  try {
    const { supabase } = await requirePlatformAdmin();

    const { error } = await supabase.rpc("admin_mark_payout_paid", { p_payout_id: payoutId });
    if (error) return { error: error.message };

    revalidatePath("/platform/payouts");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "A apărut o eroare." };
  }
}
