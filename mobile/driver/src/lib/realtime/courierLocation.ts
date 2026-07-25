import type { SupabaseClient } from "@supabase/supabase-js";

export type LatLng = { lat: number; lng: number };

function channelName(orderId: string) {
  return `order:${orderId}:location`;
}

// PRIVATE channel — mirrors src/lib/realtime/courierLocation.ts on the web app.
// Realtime Authorization (migration 20260717002100) enforces the
// realtime.messages RLS policies so only the order's own customer, the
// assigned courier, and platform admins can join/receive, and only the
// assigned courier can broadcast. setAuth() proactively hands the courier's
// JWT to the socket before subscribe().
function makeChannel(supabase: SupabaseClient, orderId: string) {
  return supabase.channel(channelName(orderId), { config: { private: true } });
}

// Courier side: broadcasts the device's real GPS position over Realtime
// Broadcast (~10s ticks — see useBroadcastCourierLocation) instead of writing
// to courier_locations on every tick. A separate low-frequency UPSERT into
// courier_locations keeps a last-known position for page loads that missed
// the broadcast.
export function broadcastCourierLocation(supabase: SupabaseClient, orderId: string) {
  const channel = makeChannel(supabase, orderId);
  void supabase.realtime.setAuth();
  channel.subscribe();

  return {
    send: (position: LatLng) => channel.send({ type: "broadcast", event: "location", payload: position }),
    stop: () => supabase.removeChannel(channel),
  };
}
