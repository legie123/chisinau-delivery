"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { subscribeTable } from "@/lib/realtime/subscribeTable";
import type { AdminFleetRow, AdminOrderBoardRow } from "@/lib/types/domain";
import { OrdersBoard } from "./OrdersBoard";
import { FleetPanel } from "./FleetPanel";
import { OpsMap } from "./OpsMap";

// Live ops center. Subscribes to orders + couriers + courier_locations whole-table
// (admin RLS scopes the rows; this is the sanctioned unfiltered case) and refetches
// the two admin views on any event, debounced. Falls back to 30s polling if realtime
// degrades. The count tiles derive from the same live board so they stay in sync.
export function OpsLive({
  initialBoard,
  initialFleet,
}: {
  initialBoard: AdminOrderBoardRow[];
  initialFleet: AdminFleetRow[];
}) {
  const [board, setBoard] = useState(initialBoard);
  const [fleet, setFleet] = useState(initialFleet);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refetch = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const supabase = createClient();
      const [{ data: b }, { data: f }] = await Promise.all([
        supabase.from("admin_order_board").select("*").order("in_state_seconds", { ascending: false }),
        supabase.from("admin_fleet_status").select("*").order("full_name"),
      ]);
      if (b) setBoard(b as AdminOrderBoardRow[]);
      if (f) setFleet(f as AdminFleetRow[]);
    }, 400);
  }, []);

  useEffect(() => {
    const supabase = createClient();
    let stopped = false;
    let poll: ReturnType<typeof setInterval> | null = null;
    const degraded = new Set<string>();

    const startPolling = (key: string) => {
      degraded.add(key);
      // #7: a CLOSED ack that arrives after unmount must not resurrect the interval.
      if (stopped || poll) return;
      poll = setInterval(refetch, 30_000);
    };
    const stopPollingIfHealthy = (key: string) => {
      degraded.delete(key);
      // #9: only stop the shared poll once EVERY channel has recovered.
      if (degraded.size === 0 && poll) {
        clearInterval(poll);
        poll = null;
      }
    };

    const channels: [string, string][] = [
      ["ops-orders", "orders"],
      ["ops-couriers", "couriers"],
      ["ops-locations", "courier_locations"],
    ];
    const unsubs = channels.map(([purpose, table]) =>
      subscribeTable(
        supabase,
        purpose,
        table,
        undefined,
        refetch,
        () => startPolling(purpose),
        () => stopPollingIfHealthy(purpose),
      ),
    );

    return () => {
      stopped = true;
      unsubs.forEach((u) => u());
      if (poll) clearInterval(poll);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [refetch]);

  return (
    <div className="flex flex-col gap-5">
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/50">Comenzi active</h2>
        <OrdersBoard orders={board} />
      </section>
      <div className="grid gap-5 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/50">Flotă</h2>
          <FleetPanel fleet={fleet} />
        </div>
        <OpsMap fleet={fleet} orders={board} />
      </div>
    </div>
  );
}
