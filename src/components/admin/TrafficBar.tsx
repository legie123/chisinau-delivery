"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { startJitteredPoll } from "@/lib/realtime/pollJitter";

type Traffic = {
  active: number | null;
  couriersOnline: number | null;
  ordersToday: number | null;
  deliveredToday: number | null;
  cancelledToday: number | null;
};

const EMPTY: Traffic = {
  active: null,
  couriersOnline: null,
  ordersToday: null,
  deliveredToday: null,
  cancelledToday: null,
};

// Local (browser) midnight — "azi" as the admin perceives it, not UTC.
function startOfTodayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function Stat({ label, value, tone }: { label: string; value: number | null; tone?: string }) {
  return (
    <span className="flex shrink-0 items-baseline gap-1.5 whitespace-nowrap">
      <span className={`font-semibold tabular-nums ${tone ?? "text-white"}`}>{value ?? "—"}</span>
      <span className="text-white/45">{label}</span>
    </span>
  );
}

// Persistent traffic strip pinned to the bottom of every /platform page —
// head-only count queries (cheap) against the admin views/tables, refreshed on
// a jittered ~30s cadence like the other degraded-realtime surfaces. Signal
// only: it links nowhere and mutates nothing.
export function TrafficBar() {
  const [traffic, setTraffic] = useState<Traffic>(EMPTY);

  const fetchTraffic = useCallback(async () => {
    const supabase = createClient();
    const today = startOfTodayIso();
    const [{ count: active }, { count: online }, { count: placed }, { count: delivered }, { count: cancelled }] =
      await Promise.all([
        supabase.from("admin_order_board").select("id", { count: "exact", head: true }),
        supabase
          .from("admin_fleet_status")
          .select("id", { count: "exact", head: true })
          .in("status", ["online", "on_delivery"]),
        supabase.from("orders").select("id", { count: "exact", head: true }).gte("created_at", today),
        supabase
          .from("orders")
          .select("id", { count: "exact", head: true })
          .eq("status", "delivered")
          .gte("delivered_at", today),
        supabase
          .from("orders")
          .select("id", { count: "exact", head: true })
          .eq("status", "cancelled")
          .gte("created_at", today),
      ]);
    setTraffic((prev) => ({
      active: active ?? prev.active,
      couriersOnline: online ?? prev.couriersOnline,
      ordersToday: placed ?? prev.ordersToday,
      deliveredToday: delivered ?? prev.deliveredToday,
      cancelledToday: cancelled ?? prev.cancelledToday,
    }));
  }, []);

  useEffect(() => {
    // Initial fetch deferred a tick — keeps setState out of the effect's own
    // synchronous run (react-hooks/set-state-in-effect).
    const initial = setTimeout(() => void fetchTraffic(), 0);
    const poll = startJitteredPoll(fetchTraffic);
    return () => {
      clearTimeout(initial);
      poll.stop();
    };
  }, [fetchTraffic]);

  return (
    <>
      {/* Spacer keeps the last row of page content clear of the fixed strip. */}
      <div aria-hidden className="h-10" />
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#0d0d1f]/95 backdrop-blur">
        <div className="no-scrollbar flex items-center gap-5 overflow-x-auto px-4 py-2 text-xs sm:px-6">
          <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap font-semibold uppercase tracking-wide text-white/35">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
            </span>
            Trafic
          </span>
          <Stat label="comenzi active" value={traffic.active} tone="text-gold" />
          <Stat label="curieri online" value={traffic.couriersOnline} tone="text-emerald-300" />
          <Stat label="comenzi azi" value={traffic.ordersToday} />
          <Stat label="livrate azi" value={traffic.deliveredToday} />
          <Stat
            label="anulate azi"
            value={traffic.cancelledToday}
            tone={(traffic.cancelledToday ?? 0) > 0 ? "text-primary" : "text-white"}
          />
        </div>
      </div>
    </>
  );
}
