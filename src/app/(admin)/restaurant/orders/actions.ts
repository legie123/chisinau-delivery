"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/require";

export type ActionResult = { error: string | null };

// The restaurant-partner order-lifecycle RPCs this helper dispatches. Typed as a
// literal union so the schema-typed client verifies the call (Master Council Phase 1).
type OrderRpc = "accept_order" | "reject_order" | "mark_ready_for_pickup";
type OrderRpcArgs = { p_order_id: string; p_reason?: string };

async function callOrderRpc(rpc: OrderRpc, args: OrderRpcArgs): Promise<ActionResult> {
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

// Customer status pushes are now enqueued durably by the delivery_status_events
// trigger (enqueue_customer_status_push) — uniform across every path that advances
// an order, with drain-with-retry — so these actions no longer fire-and-forget them.
export async function acceptOrder(orderId: string): Promise<ActionResult> {
  return callOrderRpc("accept_order", { p_order_id: orderId });
}

export async function rejectOrder(orderId: string, reason: string): Promise<ActionResult> {
  return callOrderRpc("reject_order", { p_order_id: orderId, p_reason: reason });
}

export async function markReadyForPickup(orderId: string): Promise<ActionResult> {
  return callOrderRpc("mark_ready_for_pickup", { p_order_id: orderId });
}
