import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, OrderId, OrderStatus } from "@chisinau/shared-types";
import { RpcError } from "./errors";

type Db = SupabaseClient<Database>;

/**
 * Advance an order along the courier delivery hops
 * (courier_assigned → picked_up → en_route → delivered).
 *
 * The RPC is the authority: it enforces the transition matrix (see
 * ADVANCE_TRANSITIONS in @chisinau/shared-types — contract-tested against it),
 * caller authorization, the online-payment money gate, and stamps delivered_at.
 * Idempotent on same-status retries (safe for the offline queue's double-sends).
 */
export async function advanceDeliveryStatus(
  db: Db,
  orderId: OrderId,
  newStatus: OrderStatus,
  paymentConfirmed?: boolean,
): Promise<void> {
  const { error } = await db.rpc("advance_delivery_status", {
    p_order_id: orderId,
    p_new_status: newStatus,
    ...(paymentConfirmed === undefined ? {} : { p_payment_confirmed: paymentConfirmed }),
  });
  if (error) throw new RpcError(error);
}
