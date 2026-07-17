"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { subscribeTable } from "@/lib/realtime/subscribeTable";
import type { Order } from "@/lib/types/domain";

// The courier dashboard promises "rămâi online, te anunțăm". A row-filtered
// postgres_changes on status=ready_for_pickup catches ARRIVALS, but Realtime
// evaluates the filter against the NEW row — a ready_for_pickup -> courier_assigned
// UPDATE no longer matches, so DEPARTURES (an order taken by another courier)
// never fire an event. A slow poll alongside the channel reconciles those.
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
    // Departure reconciliation: refresh every 30s so orders claimed by others
    // drop off the list even though their UPDATE doesn't match the filter.
    const poll = setInterval(() => router.refresh(), 30_000);
    return () => {
      unsub();
      clearInterval(poll);
    };
  }, [router]);

  return null;
}
