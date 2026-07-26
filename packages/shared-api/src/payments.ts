import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, OrderId } from "@chisinau/shared-types";
import { RpcError } from "./errors";

type Db = SupabaseClient<Database>;

// Payment RPCs. In the pilot online payment is a mock (the tile is hidden and
// confirm is DB-gated to service-role/admin), but the wrappers stay so a real
// gateway can be wired without re-deriving the contract.

/** Opens a payment intent for an unpaid order; returns the intent id. */
export async function startOnlinePayment(db: Db, orderId: OrderId): Promise<string> {
  const { data, error } = await db.rpc("start_online_payment", { p_order_id: orderId });
  if (error) throw new RpcError(error);
  return data as string;
}

/**
 * Settle (or fail) a payment intent. DB-gated: only a real gateway webhook
 * (service role) or a platform admin may call this — never the ordering customer.
 */
export async function confirmOnlinePayment(
  db: Db,
  intentId: string,
  success: boolean,
  providerRef?: string,
): Promise<void> {
  const { error } = await db.rpc("confirm_online_payment", {
    p_intent_id: intentId,
    p_success: success,
    p_provider_ref: providerRef,
  });
  if (error) throw new RpcError(error);
}

/** Admin moves an order's payment status along the guarded transition matrix. */
export async function adminUpdatePaymentStatus(
  db: Db,
  orderId: OrderId,
  newStatus: string,
  note?: string,
): Promise<void> {
  const { error } = await db.rpc("admin_update_payment_status", {
    p_order_id: orderId,
    p_new_status: newStatus,
    p_note: note,
  });
  if (error) throw new RpcError(error);
}
