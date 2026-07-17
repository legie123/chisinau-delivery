"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/require";

export type ActionResult = { error: string | null };

async function client() {
  const { supabase } = await requireUser();
  return supabase;
}

// All three are thin wrappers over EXISTING guarded RPCs (cancel_order and
// advance_delivery_status already allow platform_admin) plus the WS7 payment RPC.
// RLS/RPC authorization is the real boundary; these just surface errors to the UI.
export async function cancelStuckOrder(orderId: string, reason: string): Promise<ActionResult> {
  let supabase;
  try {
    supabase = await client();
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Neautentificat." };
  }
  const { error } = await supabase.rpc("cancel_order", { p_order_id: orderId, p_reason: reason });
  if (error) return { error: error.message };
  revalidatePath("/platform/queues");
  return { error: null };
}

export async function forceAdvance(orderId: string, newStatus: string): Promise<ActionResult> {
  let supabase;
  try {
    supabase = await client();
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Neautentificat." };
  }
  const { error } = await supabase.rpc("advance_delivery_status", {
    p_order_id: orderId,
    p_new_status: newStatus,
    p_payment_confirmed: null,
  });
  if (error) return { error: error.message };
  revalidatePath("/platform/queues");
  return { error: null };
}

export async function resolvePayment(orderId: string, newStatus: string, note?: string): Promise<ActionResult> {
  let supabase;
  try {
    supabase = await client();
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Neautentificat." };
  }
  const { error } = await supabase.rpc("admin_update_payment_status", {
    p_order_id: orderId,
    p_new_status: newStatus,
    p_note: note ?? null,
  });
  if (error) return { error: error.message };
  revalidatePath("/platform/queues");
  return { error: null };
}
