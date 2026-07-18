"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/require";
import { notifyOrderCustomer } from "@/lib/push/notify";

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
  const result = await callOrderRpc("accept_order", { p_order_id: orderId });
  if (!result.error) {
    void notifyOrderCustomer(orderId, {
      title: "Comandă acceptată ✅",
      body: "Restaurantul a acceptat comanda ta și o pregătește.",
      url: `/orders/${orderId}`,
      tag: `order-${orderId}`,
    });
  }
  return result;
}

export async function rejectOrder(orderId: string, reason: string): Promise<ActionResult> {
  const result = await callOrderRpc("reject_order", { p_order_id: orderId, p_reason: reason });
  if (!result.error) {
    void notifyOrderCustomer(orderId, {
      title: "Comandă refuzată",
      body: `Restaurantul nu a putut prelua comanda: ${reason}`,
      url: `/orders/${orderId}`,
      tag: `order-${orderId}`,
    });
  }
  return result;
}

export async function markReadyForPickup(orderId: string): Promise<ActionResult> {
  const result = await callOrderRpc("mark_ready_for_pickup", { p_order_id: orderId });
  if (!result.error) {
    // Courier offer pushes are owned by the dispatch_offers outbox trigger now —
    // uniform across the initial dispatch AND both cascade paths (decline + the
    // pg_cron expiry sweeper). Here we only tell the customer their food is ready.
    void notifyOrderCustomer(orderId, {
      title: "Comanda e gata 🥡",
      body: "Comanda ta e gata și așteaptă curierul.",
      url: `/orders/${orderId}`,
      tag: `order-${orderId}`,
    });
  }
  return result;
}
