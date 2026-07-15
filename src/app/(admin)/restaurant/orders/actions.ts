"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/require";

export type ActionResult = { error: string | null };

async function callOrderRpc(rpc: string, args: Record<string, unknown>): Promise<ActionResult> {
  let supabase;
  try {
    ({ supabase } = await requireUser());
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Neautentificat." };
  }

  const { error } = await supabase.rpc(rpc, args);
  if (error) return { error: error.message };

  revalidatePath("/restaurant/orders");
  return { error: null };
}

export async function acceptOrder(orderId: string): Promise<ActionResult> {
  return callOrderRpc("accept_order", { p_order_id: orderId });
}

export async function rejectOrder(orderId: string, reason: string): Promise<ActionResult> {
  return callOrderRpc("reject_order", { p_order_id: orderId, p_reason: reason });
}

export async function markReadyForPickup(orderId: string): Promise<ActionResult> {
  return callOrderRpc("mark_ready_for_pickup", { p_order_id: orderId });
}
