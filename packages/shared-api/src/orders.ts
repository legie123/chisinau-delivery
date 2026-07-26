import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, OrderId } from "@chisinau/shared-types";
import { RpcError } from "./errors";

type Db = SupabaseClient<Database>;

// Restaurant-partner order-lifecycle + catering-quote RPCs. Each is the authority
// (transition matrix + caller authorization live in the security-definer function);
// these wrappers are the single typed call-site, shared with Expo, surfacing a
// uniform Romanian RpcError.userMessage on failure.

/** Partner accepts a pending order (→ accepted, stamps estimated_ready_at). */
export async function acceptOrder(db: Db, orderId: OrderId): Promise<void> {
  const { error } = await db.rpc("accept_order", { p_order_id: orderId });
  if (error) throw new RpcError(error);
}

/** Partner rejects a pending order with a required reason (→ rejected). */
export async function rejectOrder(db: Db, orderId: OrderId, reason: string): Promise<void> {
  const { error } = await db.rpc("reject_order", { p_order_id: orderId, p_reason: reason });
  if (error) throw new RpcError(error);
}

/** Partner marks an accepted order ready (→ ready_for_pickup, fires dispatch). */
export async function markReadyForPickup(db: Db, orderId: OrderId): Promise<void> {
  const { error } = await db.rpc("mark_ready_for_pickup", { p_order_id: orderId });
  if (error) throw new RpcError(error);
}

/** Partner submits a catering quote (catering_details.quote_status → quoted). */
export async function submitCateringQuote(db: Db, orderId: OrderId, quotedTotalMdl: number): Promise<void> {
  const { error } = await db.rpc("submit_catering_quote", { p_order_id: orderId, p_quoted_total_mdl: quotedTotalMdl });
  if (error) throw new RpcError(error);
}

/** Partner declines a catering request with a reason (→ declined). */
export async function declineCateringQuote(db: Db, orderId: OrderId, reason: string): Promise<void> {
  const { error } = await db.rpc("decline_catering_quote", { p_order_id: orderId, p_reason: reason });
  if (error) throw new RpcError(error);
}
