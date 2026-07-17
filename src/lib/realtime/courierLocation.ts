import type { SupabaseClient } from "@supabase/supabase-js";

export type LatLng = { lat: number; lng: number };

function channelName(orderId: string) {
  return `order:${orderId}:location`;
}

// PRIVATE channel: Realtime Authorization enforces the realtime.messages RLS
// policies (migration 20260717002100) so only the order's customer, the assigned
// courier, and platform admins can join/receive, and only the assigned courier
// can broadcast. setAuth() proactively hands the user's JWT to the socket;
// createBrowserClient also refreshes it per join, so subscribe() need not await it.
function makeChannel(supabase: SupabaseClient, orderId: string) {
  return supabase.channel(channelName(orderId), { config: { private: true } });
}

// Courier side: broadcasts frequent raw pings over Realtime Broadcast rather
// than writing to courier_locations on every tick — avoids hammering the DB
// every ~10s. A separate low-frequency UPSERT into courier_locations keeps a
// last-known position for page loads that missed the broadcast.
export function broadcastCourierLocation(supabase: SupabaseClient, orderId: string) {
  const channel = makeChannel(supabase, orderId);
  void supabase.realtime.setAuth();
  channel.subscribe();

  return {
    send: (position: LatLng) => channel.send({ type: "broadcast", event: "location", payload: position }),
    stop: () => supabase.removeChannel(channel),
  };
}

// Customer side: listens for the courier's live position on the same channel.
export function subscribeCourierLocation(supabase: SupabaseClient, orderId: string, onUpdate: (position: LatLng) => void) {
  const channel = makeChannel(supabase, orderId).on(
    "broadcast",
    { event: "location" },
    ({ payload }) => onUpdate(payload as LatLng),
  );
  void supabase.realtime.setAuth();
  channel.subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
