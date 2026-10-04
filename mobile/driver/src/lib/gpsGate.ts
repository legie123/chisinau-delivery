// When may the courier's live position reach the customer? Exactly the web's
// window (DeliveryStatusControls → useBroadcastCourierLocation `active`):
// picked_up and en_route. Not on accept (courier_assigned), never after the
// order ends — and not while "am livrat" sits in the offline queue.
export const BROADCAST_STATUSES: readonly string[] = ["picked_up", "en_route"];

export type GpsDecision = "send" | "hold" | "stop";

/**
 * serverStatus: the order's status as last read from the server — `null` when
 * the row is gone or no longer assigned to this courier, `undefined` when it
 * could not be read yet (no signal). queuedTarget: the offline queue's pending
 * target for this order, if any.
 */
export function gpsDecision(serverStatus: string | null | undefined, queuedTarget: string | null): GpsDecision {
  if (queuedTarget === "delivered") return "stop"; // delivered on the phone, just not synced yet
  if (serverStatus === undefined) return "hold"; // unknown: send nothing, keep the task alive
  if (serverStatus !== null && BROADCAST_STATUSES.includes(serverStatus)) return "send";
  // Pickup swiped offline: the server catches up when the queue drains.
  if (serverStatus === "courier_assigned" && queuedTarget === "en_route") return "hold";
  return "stop";
}
