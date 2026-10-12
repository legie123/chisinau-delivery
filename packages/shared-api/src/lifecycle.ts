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

/**
 * Order 3 (observe-only, no auto-compensation) — the assigned courier stamps
 * the moment they physically arrive at the restaurant. Idempotent (a retry is
 * a no-op) and only valid while status = 'courier_assigned'. Powers ops/partner
 * wait KPIs only; it never feeds courier_fee_mdl.
 */
export async function courierArrivedAtRestaurant(db: Db, orderId: OrderId): Promise<void> {
  const { error } = await db.rpc("courier_arrived_at_restaurant", { p_order_id: orderId });
  if (error) throw new RpcError(error);
}

export type GeofenceKind = "pickup" | "dropoff";

/**
 * Order 5 — PICKUP/DROP-OFF GEOFENCE HINT. A soft, discreet signal only —
 * NEVER delivery proof, and zero coupling to advance_delivery_status (this
 * call can fail silently from the UI's point of view without blocking any
 * status change). The assigned courier only; the RPC recomputes the distance
 * to the order's pickup/dropoff point server-side, so `lat`/`lng` are the
 * courier's own position — the UI's <=150m gate only decides whether to fire
 * the call at all.
 */
export async function recordGeofenceEvent(
  db: Db,
  orderId: OrderId,
  kind: GeofenceKind,
  lat: number,
  lng: number,
): Promise<void> {
  const { error } = await db.rpc("record_geofence_event", {
    p_order_id: orderId,
    p_kind: kind,
    p_lat: lat,
    p_lng: lng,
  });
  if (error) throw new RpcError(error);
}

/**
 * Directive 12 (web pilot, mobile excluded) — attach an optional proof-of-delivery
 * photo for a cash order. The assigned courier only; valid while en_route or
 * within 1h of delivered_at (idempotent-overwrite allowed in that window).
 * NEVER a delivery gate — advance_delivery_status has zero dependency on this.
 * `path` is the storage object path already uploaded to the private
 * 'delivery-proof' bucket (see uploadDeliveryProofPhoto in src/lib/storage).
 */
/**
 * The assigned courier reports a problem on an active delivery (courier_report_issue). Restaurant
 * kinds only before pickup, customer kinds only after; one per kind per order. Returns false when
 * the same kind was already reported (idempotent retry), true for a new report.
 */
export async function reportDeliveryIssue(
  db: Db,
  orderId: OrderId,
  kind: "running_late" | "restaurant_delayed" | "venue_not_found" | "customer_unreachable" | "address_wrong",
): Promise<boolean> {
  const { data, error } = await db.rpc("courier_report_issue", { p_order_id: orderId, p_kind: kind });
  if (error) throw new RpcError(error);
  return data === true;
}

/**
 * The assigned courier releases an accepted order BEFORE pickup (courier_release_order, daily cap from
 * courier_release_policy, no dispatch penalty). Returns how many releases are left today.
 */
export async function releaseOrder(
  db: Db,
  orderId: OrderId,
  reason: "vehicle_problem" | "personal_emergency" | "restaurant_delay" | "other",
): Promise<number> {
  const { data, error } = await db.rpc("courier_release_order", { p_order_id: orderId, p_reason: reason });
  if (error) throw new RpcError(error);
  return data as number;
}

export async function attachDeliveryProof(db: Db, orderId: OrderId, path: string): Promise<void> {
  const { error } = await db.rpc("attach_delivery_proof", { p_order_id: orderId, p_path: path });
  if (error) throw new RpcError(error);
}
