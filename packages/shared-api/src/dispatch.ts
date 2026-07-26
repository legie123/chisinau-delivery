import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, OfferId, OrderId } from "@chisinau/shared-types";
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
 * Courier SELF-claims an unassigned ready order from the pull feed.
 *
 * NOTE THE NAME: the underlying RPC is `assign_courier`, but it ONLY supports
 * self-claim (`where user_id = auth.uid()` inside) — there is NO admin
 * reassign-to-arbitrary-courier RPC in this codebase. Do not build a reassign UI
 * on top of this; that requires a new migration first. (Previously reported as
 * SKIPPED in the AdminOps session for exactly this reason.)
 */
export async function claimOrderAsCourier(db: Db, orderId: OrderId): Promise<void> {
  const { error } = await db.rpc("assign_courier", { p_order_id: orderId });
  if (error) throw new RpcError(error);
}
