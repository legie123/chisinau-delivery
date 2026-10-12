import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json, OrderId } from "@chisinau/shared-types";
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

/** Partner bails out post-accept (out of stock etc.) — accepted/ready only,
 *  blocked once a courier picked up; notifies the customer via the outbox. */
export async function restaurantCancelOrder(db: Db, orderId: OrderId, reason: string): Promise<void> {
  const { error } = await db.rpc("restaurant_cancel_order", { p_order_id: orderId, p_reason: reason });
  if (error) throw new RpcError(error);
}

/** Partner marks an accepted order ready (→ ready_for_pickup, fires dispatch). */
export async function markReadyForPickup(db: Db, orderId: OrderId): Promise<void> {
  const { error } = await db.rpc("mark_ready_for_pickup", { p_order_id: orderId });
  if (error) throw new RpcError(error);
}

/**
 * Order 4 (Glovo model) — merchant overrides the prep-time estimate BEFORE
 * accepting. accept_order prefers this over the statistical get_prep_estimates()
 * when stamping estimated_ready_at. Rejected by the RPC once the order is no
 * longer pending_restaurant (no post-accept goalpost moves).
 */
export async function setPrepTimeEstimate(db: Db, orderId: OrderId, minutes: number): Promise<void> {
  const { error } = await db.rpc("set_prep_time_estimate", { p_order_id: orderId, p_minutes: minutes });
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

// ---- Customer order operations ----

export type PlaceOrderInput = {
  restaurantId: string;
  orderType: "standard" | "catering";
  paymentMethod: string;
  items: Array<{ menu_item_id: string; quantity: number; option_ids?: string[] }>;
  deliveryAddressId?: string;
  requestedFor?: string;
  notes?: string;
  catering?: Record<string, unknown>;
  idempotencyKey?: string;
  /** Subtotal + delivery fee as DISPLAYED; place_order refuses if its re-priced total differs. */
  expectedTotalMdl?: number;
};

/**
 * Place an order (standard or catering). The RPC recomputes every price + the
 * subtotal server-side, validates hours/min-order/item availability, snapshots
 * modifiers, and is idempotent on p_idempotency_key (a retry returns the same
 * order id, no duplicate). Returns the order id.
 */
export async function placeOrder(db: Db, input: PlaceOrderInput): Promise<OrderId> {
  const { data, error } = await db.rpc("place_order", {
    p_restaurant_id: input.restaurantId,
    p_order_type: input.orderType,
    p_payment_method: input.paymentMethod,
    p_items: input.items as unknown as Json,
    p_delivery_address_id: input.deliveryAddressId,
    p_requested_for: input.requestedFor,
    p_notes: input.notes,
    p_catering: (input.catering ?? undefined) as unknown as Json,
    p_idempotency_key: input.idempotencyKey,
    p_expected_total: input.expectedTotalMdl,
  });
  if (error) throw new RpcError(error);
  return data as OrderId;
}

/** Set/update the tip on an order (frozen after an online charge is captured). */
export async function setOrderTip(db: Db, orderId: OrderId, tipMdl: number): Promise<void> {
  const { error } = await db.rpc("set_order_tip", { p_order_id: orderId, p_tip_mdl: tipMdl });
  if (error) throw new RpcError(error);
}

/** Cancel an order with a reason (customer/admin, per the RPC's own auth). */
export async function cancelOrder(db: Db, orderId: OrderId, reason: string): Promise<void> {
  const { error } = await db.rpc("cancel_order", { p_order_id: orderId, p_reason: reason });
  if (error) throw new RpcError(error);
}

/** Customer confirms a catering quote (→ accepted, joins the standard pipeline). */
export async function confirmCateringQuote(db: Db, orderId: OrderId): Promise<void> {
  const { error } = await db.rpc("confirm_catering_quote", { p_order_id: orderId });
  if (error) throw new RpcError(error);
}

/** Customer rates the restaurant or the courier for a delivered order. */
export async function submitRating(
  db: Db,
  orderId: OrderId,
  target: "restaurant" | "courier",
  stars: number,
  comment?: string,
): Promise<void> {
  const { error } = await db.rpc("submit_rating", {
    p_order_id: orderId,
    p_target: target,
    p_stars: stars,
    p_comment: comment,
  });
  if (error) throw new RpcError(error);
}
