import type { SupabaseClient } from "@supabase/supabase-js";

export type LatLng = { lat: number; lng: number };

function channelName(orderId: string) {
  return `order:${orderId}:location`;
}

// Courier side: broadcasts frequent raw pings over Realtime Broadcast rather
// than writing to courier_locations on every tick — avoids hammering the DB
// every ~10s. A separate low-frequency UPSERT into courier_locations (see
// lib/orders/courierTracking.ts) keeps a last-known position for page loads
// that missed the broadcast.
export function broadcastCourierLocation(supabase: SupabaseClient, orderId: string) {
  const channel = supabase.channel(channelName(orderId));
  channel.subscribe();

  return {
    send: (position: LatLng) => channel.send({ type: "broadcast", event: "location", payload: position }),
    stop: () => supabase.removeChannel(channel),
  };
}

// Customer side: listens for the courier's live position on the same channel.
export function subscribeCourierLocation(supabase: SupabaseClient, orderId: string, onUpdate: (position: LatLng) => void) {
  const channel = supabase
    .channel(channelName(orderId))
    .on("broadcast", { event: "location" }, ({ payload }) => onUpdate(payload as LatLng))
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
