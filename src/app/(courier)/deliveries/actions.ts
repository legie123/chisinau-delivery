"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/require";

export type ActionResult = { error: string | null };

export async function setOnlineStatus(online: boolean): Promise<ActionResult> {
  let supabase;
  try {
    ({ supabase } = await requireUser());
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Neautentificat." };
  }

  const { error } = await supabase.rpc("set_courier_online_status", { p_status: online ? "online" : "offline" });
  if (error) return { error: error.message };

  revalidatePath("/deliveries");
  return { error: null };
}

export async function acceptDelivery(orderId: string): Promise<ActionResult> {
  let supabase;
  try {
    ({ supabase } = await requireUser());
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Neautentificat." };
  }

  const { error } = await supabase.rpc("assign_courier", { p_order_id: orderId });
  if (error) return { error: error.message };

  revalidatePath("/deliveries");
  return { error: null };
}

export async function advanceStatus(
  orderId: string,
  newStatus: string,
  paymentConfirmed?: boolean,
): Promise<ActionResult> {
  let supabase;
  try {
    ({ supabase } = await requireUser());
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Neautentificat." };
  }

  const { error } = await supabase.rpc("advance_delivery_status", {
    p_order_id: orderId,
    p_new_status: newStatus,
    p_payment_confirmed: paymentConfirmed ?? null,
  });
  if (error) return { error: error.message };

  revalidatePath("/deliveries");
  revalidatePath(`/deliveries/${orderId}`);
  return { error: null };
}
