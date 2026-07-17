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
  // Row filter (e.g. `id=eq.X`). Omit ONLY for the sanctioned admin ops surface,
  // where platform_admin RLS already scopes the whole table — never on
  // customer/courier/partner surfaces (those must stay row-filtered).
  filter: string | undefined,
  onChange: (payload: RealtimePostgresChangesPayload<T>) => void,
  onDegraded?: () => void,
  onHealthy?: () => void,
) {
  const channelName = `${purpose}:${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const channel = supabase
    .channel(channelName)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table, ...(filter ? { filter } : {}) },
      (payload: RealtimePostgresChangesPayload<T>) => onChange(payload),
    )
    .subscribe((status, err) => {
      // Without this callback CHANNEL_ERROR/TIMED_OUT are swallowed and a
      // "live" page silently freezes on stale data.
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        console.error(`[realtime] ${purpose} ${status}`, err ?? "");
        onDegraded?.();
      } else if (status === "SUBSCRIBED") {
        onHealthy?.(); // recovery signal — lets a caller stop its polling fallback
      }
    });

  return () => {
    supabase.removeChannel(channel);
  };
}
