"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { error: string | null };

async function callOrderRpc(rpc: string, args: Record<string, unknown>): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Neautentificat." };

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
