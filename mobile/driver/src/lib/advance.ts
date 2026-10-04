import type { SupabaseClient } from "@supabase/supabase-js";
import { advanceDeliveryStatus } from "@chisinau/shared-api";
import { nextAdvanceStatus, type Database, type OrderId, type OrderStatus } from "@chisinau/shared-types";
import { isNetworkError, type AdvanceFn } from "@chisinau/shared-domain";

type Db = SupabaseClient<Database>;

// The courier's swipe expresses a TARGET ("am ridicat" = en_route, "am livrat" =
// delivered), and the offline queue keeps ONE entry per order (a newer tap
// supersedes an older unsent one). So a replay must walk every hop from the
// order's CURRENT status to the target — otherwise "pickup, then deliver, both
// offline" replays courier_assigned -> delivered, gets "invalid transition",
// and the whole delivery is silently dropped.
//
// Each hop is advance_delivery_status (idempotent, RPC-validated). A target the
// order can no longer reach (cancelled, already past it) comes back as an
// "invalid transition" error, which the queue treats as resolved.
export async function advanceThrough(
  db: Db,
  orderId: string,
  target: OrderStatus,
  paymentConfirmed?: boolean,
): Promise<void> {
  const { data, error } = await db.from("orders").select("status").eq("id", orderId).single();
  if (error) throw new Error(error.message);
  let current = data.status as OrderStatus;
  if (current === target) return;

  const hops: OrderStatus[] = [];
  while (current !== target) {
    const next = nextAdvanceStatus(current);
    if (!next) throw new Error(`invalid transition ${data.status} -> ${target}`);
    hops.push(next);
    current = next;
  }
  for (const hop of hops) {
    await advanceDeliveryStatus(db, orderId as OrderId, hop, hop === "delivered" ? paymentConfirmed : undefined);
  }
}

// AdvanceFn for the shared status queue: business rejections resolve with
// {error} (kept or dropped by the queue's rules); network failures THROW so the
// entry stays queued for the next drain.
export function makeQueueAdvance(db: Db): AdvanceFn {
  return async (orderId, newStatus, paymentConfirmed) => {
    try {
      await advanceThrough(db, orderId, newStatus as OrderStatus, paymentConfirmed);
      return { error: null };
    } catch (err) {
      if (isNetworkError(err)) throw err;
      return { error: err instanceof Error ? err.message : String(err) };
    }
  };
}
