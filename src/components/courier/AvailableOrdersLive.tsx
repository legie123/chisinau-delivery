"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { subscribeTable } from "@/lib/realtime/subscribeTable";
import { startJitteredPoll, type JitteredPoll } from "@/lib/realtime/pollJitter";
import type { Order } from "@/lib/types/domain";

// The courier dashboard promises "rămâi online, te anunțăm". A row-filtered
// postgres_changes on status=ready_for_pickup catches ARRIVALS, but Realtime
// evaluates the filter against the NEW row — a ready_for_pickup -> courier_assigned
// UPDATE no longer matches, so DEPARTURES (an order taken by another courier)
// never fire an event. A slow poll alongside the channel reconciles those —
// jittered (base 30s ± 0-10s, backoff on failures) so a fleet of courier tabs
// doesn't all poll in lockstep. `subscribeTable()` already pauses/resumes its
// own channel on pagehide/visibilitychange for bfcache eligibility; this
// mirrors that for the reconciliation poll so a backgrounded tab doesn't keep
// refreshing (or hold a timer open) needlessly.
export function AvailableOrdersLive() {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    const unsub = subscribeTable<Order>(
      supabase,
      "courier-feed",
      "orders",
      "status=eq.ready_for_pickup",
      () => router.refresh(),
    );

    let poll: JitteredPoll | null = startJitteredPoll(() => router.refresh());

    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") {
        poll?.stop();
        poll = null;
      } else if (!poll) {
        poll = startJitteredPoll(() => router.refresh());
      }
    }
    function handlePageHide() {
      poll?.stop();
      poll = null;
    }
    function handlePageShow(event: PageTransitionEvent) {
      if (event.persisted && !poll) poll = startJitteredPoll(() => router.refresh());
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("pageshow", handlePageShow);

    return () => {
      unsub();
      poll?.stop();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, [router]);

  return null;
}
