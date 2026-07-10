import type { RealtimePostgresChangesPayload, SupabaseClient } from "@supabase/supabase-js";

// Wraps supabase.channel(...).on('postgres_changes', ...).subscribe() with a
// unique per-call channel name and cleanup — mirrors the pattern proven at
// La Fratii Bikes, where a *static* channel name broke on React re-mounts
// ("cannot add postgres_changes callbacks after subscribe()"). Filtered by
// row (not whole-table) since this app is customer-facing, not an internal
// admin tool.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function subscribeTable<T extends { [key: string]: any }>(
  supabase: SupabaseClient,
  purpose: string,
  table: string,
  filter: string,
  onChange: (payload: RealtimePostgresChangesPayload<T>) => void,
) {
  const channelName = `${purpose}:${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const channel = supabase
    .channel(channelName)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table, filter },
      (payload: RealtimePostgresChangesPayload<T>) => onChange(payload),
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
