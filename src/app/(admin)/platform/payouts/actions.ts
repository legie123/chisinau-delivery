"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/auth/require";
import { adminGeneratePayouts, mapPgError, RpcError } from "@chisinau/shared-api";

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

    const count = await adminGeneratePayouts(supabase, startISO, endISO);

    revalidatePath("/platform/payouts");
    return { error: null, count };
  } catch (err) {
    return {
      error:
        err instanceof RpcError
          ? err.userMessage
          : err instanceof Error
            ? err.message
            : "A apărut o eroare.",
    };
  }
}

// A payee is paid its NET pending balance (payouts minus pending clawbacks) — the same number the
// bank CSV exported; admin_settle_payee refuses if it moved since (20261012000409).
export async function settlePayee(
  recipientType: "courier" | "restaurant",
  recipientId: string,
  expectedNetMdl: number,
): Promise<MarkPaidResult> {
  try {
    const { supabase } = await requirePlatformAdmin();
    const { error } = await supabase.rpc("admin_settle_payee", {
      p_recipient_type: recipientType,
      p_recipient_id: recipientId,
      p_expected_net: expectedNetMdl,
    });
    if (error) return { error: mapPgError(error) };
    revalidatePath("/platform/payouts");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "A apărut o eroare." };
  }
}
