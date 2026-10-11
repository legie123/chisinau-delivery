// When must the kitchen tablet ring? Derived from the queue itself, not from realtime
// events: an INSERT event is lost when the socket is down, and a reloaded page has no
// event at all, so an order could sit on screen in silence (measured 2026-10-12, gate G2).
import { isScheduledStillAhead } from "@/lib/orders/scheduled";

export type PendingOrder = { id: string; created_at: string; requested_for: string | null };

/** Orders whose accept clock is running — same rule as expire_stale_orders: a scheduled
 *  order becomes due 60 min before its window. These ring until accepted or rejected. */
export function duePending(pending: PendingOrder[], now: number): PendingOrder[] {
  return pending.filter((o) => !isScheduledStillAhead(o.requested_for, now));
}

/** Ids not seen in an earlier render: a new arrival rings even if it is scheduled for
 *  later (until the partner taps); on the first render nothing counts as new. */
export function newArrivals(pending: PendingOrder[], seen: Set<string> | null): string[] {
  if (!seen) return [];
  return pending.filter((o) => !seen.has(o.id)).map((o) => o.id);
}
