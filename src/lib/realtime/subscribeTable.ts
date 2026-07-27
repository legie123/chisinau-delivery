import type { RealtimeChannel, RealtimePostgresChangesPayload, SupabaseClient } from "@supabase/supabase-js";

// Wraps supabase.channel(...).on('postgres_changes', ...).subscribe() with a
// unique per-call channel name and cleanup — mirrors the pattern proven at
// La Fratii Bikes, where a *static* channel name broke on React re-mounts
// ("cannot add postgres_changes callbacks after subscribe()"). Filtered by
// row (not whole-table) since this app is customer-facing, not an internal
// admin tool.
//
// Also pauses/resumes the channel across bfcache-relevant lifecycle events: an
// open WebSocket (or its Web Worker heartbeat) makes a page ineligible for the
// back/forward cache, so on `pagehide`/tab-hidden we deliberately unsubscribe,
// and on `pageshow` (bfcache restore) / tab-visible we resubscribe with a
// fresh channel. The resulting CLOSED from our own deliberate pause is
// swallowed rather than forwarded to `onDegraded` — it isn't a real
// degradation and shouldn't spin up a caller's polling fallback while the tab
// is backgrounded.
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
  let channel: RealtimeChannel;
  let pausedForLifecycle = false;
  let torndown = false;

  function attach() {
    const channelName = `${purpose}:${Date.now()}-${Math.random().toString(36).slice(2)}`;
    channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table, ...(filter ? { filter } : {}) },
        (payload: RealtimePostgresChangesPayload<T>) => onChange(payload),
      )
      .subscribe((status, err) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          if (pausedForLifecycle) return; // our own deliberate pause, not a real degradation
          // Without this callback CHANNEL_ERROR/TIMED_OUT are swallowed and a
          // "live" page silently freezes on stale data.
          console.error(`[realtime] ${purpose} ${status}`, err ?? "");
          onDegraded?.();
        } else if (status === "SUBSCRIBED") {
          onHealthy?.(); // recovery signal — lets a caller stop its polling fallback
        }
      });
  }

  function pause() {
    if (pausedForLifecycle || torndown) return;
    pausedForLifecycle = true;
    supabase.removeChannel(channel);
  }

  function resume() {
    if (!pausedForLifecycle || torndown) return;
    pausedForLifecycle = false;
    attach();
  }

  function handleVisibilityChange() {
    if (document.visibilityState === "hidden") pause();
    else resume();
  }
  function handlePageHide() {
    pause();
  }
  function handlePageShow(event: PageTransitionEvent) {
    if (event.persisted) resume();
  }

  attach();
  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("pagehide", handlePageHide);
  window.addEventListener("pageshow", handlePageShow);

  return () => {
    torndown = true;
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    window.removeEventListener("pagehide", handlePageHide);
    window.removeEventListener("pageshow", handlePageShow);
    supabase.removeChannel(channel);
  };
}
