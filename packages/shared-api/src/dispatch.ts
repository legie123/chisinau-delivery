import type { SupabaseClient } from "@supabase/supabase-js";
import type { CourierId, Database, OfferId, OrderId } from "@chisinau/shared-types";
import { RpcError } from "./errors";

type Db = SupabaseClient<Database>;

// Typed wrappers over the dispatch RPCs. The client is ALWAYS passed in — this
// package never creates one (Next uses cookie auth via @supabase/ssr, Expo uses
// SecureStore; instantiating here would contaminate the package with platform
// deps and can duplicate the client → two parallel auth sessions).

/** Courier accepts their live push offer (atomic compare-and-set claim in the RPC). */
export async function acceptDispatchOffer(db: Db, offerId: OfferId): Promise<void> {
  const { error } = await db.rpc("accept_dispatch_offer", { p_offer_id: offerId });
  if (error) throw new RpcError(error);
}

/** Courier declines their live offer; the RPC cascades to the next candidate. */
export async function declineDispatchOffer(db: Db, offerId: OfferId): Promise<void> {
  const { error } = await db.rpc("decline_dispatch_offer", { p_offer_id: offerId });
  if (error) throw new RpcError(error);
}

/**
 * Courier toggles their availability (online ↔ offline) for dispatch.
 * Also opens/closes the courier_shifts log ("tura") server-side — the
 * earnings-per-shift KPI instrument (Faza 5 #5) has no separate write path.
 */
export async function setCourierOnlineStatus(db: Db, online: boolean): Promise<void> {
  const { error } = await db.rpc("set_courier_online_status", { p_status: online ? "online" : "offline" });
  if (error) throw new RpcError(error);
}

/**
 * Weekly 1-5 courier satisfaction pulse (Faza 5 #5, go/no-go target >=4.5,
 * Wolt benchmark 4.57). Idempotent identical retry; a DIFFERENT value for a
 * week already answered is rejected (immutable trend series, not a profile field).
 */
export async function submitCourierSatisfaction(db: Db, stars: number, comment?: string): Promise<void> {
  const { error } = await db.rpc("submit_courier_satisfaction", { p_stars: stars, p_comment: comment });
  if (error) throw new RpcError(error);
}

/**
 * Courier SELF-claims an unassigned ready order from the pull feed.
 *
 * NOTE THE NAME: the underlying RPC is `assign_courier`, but it ONLY supports
 * self-claim (`where user_id = auth.uid()` inside). For admin reassign-to-arbitrary
 * -courier use `adminReassignCourier` below (its own migration + RPC).
 */
export async function claimOrderAsCourier(db: Db, orderId: OrderId): Promise<void> {
  const { error } = await db.rpc("assign_courier", { p_order_id: orderId });
  if (error) throw new RpcError(error);
}

/**
 * Platform admin reassigns a stuck in-flight order from a ghosting courier to
 * another available one (Wave D). The new courier is freshly assigned from the
 * restaurant (status → courier_assigned); the RPC releases the old courier,
 * cancels dangling offers, and logs the move. Admin-only (checks has_role).
 */
export async function adminReassignCourier(db: Db, orderId: OrderId, newCourierId: CourierId): Promise<void> {
  const { error } = await db.rpc("admin_reassign_courier", { p_order_id: orderId, p_new_courier_id: newCourierId });
  if (error) throw new RpcError(error);
}

/**
 * Suspend a courier — HUMAN admin only, mandatory reason (EU 2024/2831 Art 10(5)+11).
 * Records who decided + a contest window and deactivates the courier. There is NO
 * automated suspension path; fraud_flags stay signal-only.
 */
export async function suspendCourier(db: Db, courierId: CourierId, reason: string): Promise<void> {
  const { error } = await db.rpc("suspend_courier", { p_courier_id: courierId, p_reason: reason });
  if (error) throw new RpcError(error);
}

/** Reinstate a suspended courier (appeal upheld) — human admin only. */
export async function reinstateCourier(db: Db, courierId: CourierId, note?: string): Promise<void> {
  const { error } = await db.rpc("reinstate_courier", { p_courier_id: courierId, p_note: note });
  if (error) throw new RpcError(error);
}
