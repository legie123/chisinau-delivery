import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@chisinau/shared-types";

// Typed with the generated Database schema so every .from()/.rpc() call is
// schema-checked at build time — a renamed column, RPC arg, or status enum breaks
// typecheck instead of drifting silently (Master Council Phase 1).
//
// `realtime.worker: true` runs the heartbeat/timeout timers inside a Web
// Worker instead of the main thread — background-tab timer throttling (Chrome
// clamps setInterval/setTimeout to ~1/min in inactive tabs) otherwise starves
// the heartbeat and the socket silently dies, which for a courier means their
// GPS broadcast (order:{id}:location) and offer feed go dark the moment they
// switch apps mid-delivery. `heartbeatCallback` is log-only — it doesn't
// change behavior, it just gives us a signal (console) when a heartbeat is
// missed/times out instead of that failure being invisible.
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      realtime: {
        worker: true,
        heartbeatCallback: (status) => {
          if (status !== "ok" && status !== "sent") {
            console.warn(`[realtime] heartbeat ${status}`);
          }
        },
      },
    },
  );
}
