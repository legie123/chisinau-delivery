"use server";

import { revalidatePath } from "next/cache";
import { mapPgError } from "@chisinau/shared-api";
import { requirePlatformAdmin } from "@/lib/auth/require";

// Support log on an order — thin wrappers over admin_open_complaint / admin_resolve_complaint,
// which check platform_admin themselves.
export async function openComplaintAction(orderId: string, kind: string, note: string): Promise<{ error: string | null }> {
  try {
    const { supabase } = await requirePlatformAdmin();
    if (note.trim().length < 3) return { error: "Descrie reclamația (minim 3 caractere)." };
    const { error } = await supabase.rpc("admin_open_complaint", { p_order_id: orderId, p_kind: kind, p_note: note });
    if (error) return { error: mapPgError(error) };
    revalidatePath(`/platform/orders/${orderId}`);
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "A apărut o eroare." };
  }
}

// Case-by-case compensation: a signed amount for the order's restaurant or courier, paid (or
// deducted) in the next payout run. The RPC takes the payee from the order and bounds the amount.
export async function addAdjustmentAction(
  orderId: string,
  complaintId: string,
  recipientType: "restaurant" | "courier",
  amountMdl: number,
  reason: string,
): Promise<{ error: string | null }> {
  try {
    const { supabase } = await requirePlatformAdmin();
    if (!Number.isFinite(amountMdl) || amountMdl === 0) return { error: "Introdu o sumă nenulă (minus = reținere)." };
    if (reason.trim().length < 3) return { error: "Scrie motivul ajustării." };
    const { error } = await supabase.rpc("admin_add_payout_adjustment", {
      p_complaint_id: complaintId,
      p_recipient_type: recipientType,
      p_amount_mdl: amountMdl,
      p_reason: reason,
    });
    if (error) return { error: mapPgError(error) };
    revalidatePath(`/platform/orders/${orderId}`);
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "A apărut o eroare." };
  }
}

export async function resolveComplaintAction(
  orderId: string,
  complaintId: string,
  resolution: string,
): Promise<{ error: string | null }> {
  try {
    const { supabase } = await requirePlatformAdmin();
    if (resolution.trim().length < 3) return { error: "Scrie cum a fost rezolvată reclamația." };
    const { error } = await supabase.rpc("admin_resolve_complaint", { p_complaint_id: complaintId, p_resolution: resolution });
    if (error) return { error: mapPgError(error) };
    revalidatePath(`/platform/orders/${orderId}`);
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "A apărut o eroare." };
  }
}
