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

// Settlement is bound to a FROZEN export batch (20261012000411): exactly the payout rows that were in
// the bank file are marked paid; a clawback that arrived after the export is netted next time.
export async function settleExportLine(
  exportId: string,
  recipientType: "courier" | "restaurant",
  recipientId: string,
  ibanConfirmed: boolean,
): Promise<MarkPaidResult> {
  try {
    const { supabase } = await requirePlatformAdmin();
    const { error } = await supabase.rpc("admin_settle_export_line", {
      p_export_id: exportId,
      p_recipient_type: recipientType,
      p_recipient_id: recipientId,
      p_iban_confirmed: ibanConfirmed,
    });
    if (error) return { error: mapPgError(error) };
    revalidatePath("/platform/payouts");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "A apărut o eroare." };
  }
}

/** A batch that was not sent to the bank: release its open lines so they can be exported again. */
export async function voidExport(exportId: string): Promise<MarkPaidResult> {
  try {
    const { supabase } = await requirePlatformAdmin();
    const { error } = await supabase.rpc("admin_void_payout_export", { p_export_id: exportId });
    if (error) return { error: mapPgError(error) };
    revalidatePath("/platform/payouts");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "A apărut o eroare." };
  }
}
