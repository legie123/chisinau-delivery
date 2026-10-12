"use client";

import { useBroadcastCourierLocation } from "@/hooks/useBroadcastCourierLocation";

// Online and free: dispatch_order ranks couriers with a live position (<2 min) above a recent
// one (<10 min) above none, and a web courier used to send nothing until an order was assigned —
// so every web courier sat in the "no position" tier. Same 45s courier_locations upsert as the
// driver app's idle heartbeat (mobile/driver/src/lib/heartbeat.ts); no order, so no broadcast.
export function IdleLocationHeartbeat({ courierId, active }: { courierId: string; active: boolean }) {
  useBroadcastCourierLocation("", courierId, active ? "upsert" : null);
  return null;
}
