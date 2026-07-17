"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { subscribeTable } from "@/lib/realtime/subscribeTable";
import type { AdminFleetRow, AdminOrderBoardRow } from "@/lib/types/domain";
import { OrdersBoard } from "./OrdersBoard";
import { FleetPanel } from "./FleetPanel";
import { OpsMap } from "./OpsMap";

function Tile({ label, value, tone, href }: { label: string; value: number; tone: string; href?: string }) {
  const inner = (
    <div className={`rounded-2xl p-4 ring-1 ${tone}`}>
      <p className="text-3xl font-bold tabular-nums text-white">{value}</p>
      <p className="mt-0.5 text-xs text-white/60">{label}</p>
    </div>
  );
  return href ? (
    <Link href={href} className="transition hover:opacity-90">
      {inner}
    </Link>
  ) : (
    inner
  );
}

// Live ops center. Subscribes to orders + couriers + courier_locations whole-table
// (admin RLS scopes the rows; this is the sanctioned unfiltered case) and refetches
// the admin views on any event, debounced. Falls back to 30s polling if realtime
// degrades. ALL four KPI tiles derive from the live state (board/fleet + refetched
// stuck/payment counts) so they never drift from the kanban below.
export function OpsLive({
  initialBoard,
  initialFleet,
  initialStuck,
  initialPay,
}: {
  initialBoard: AdminOrderBoardRow[];
  initialFleet: AdminFleetRow[];
  initialStuck: number;
  initialPay: number;
}) {
  const [board, setBoard] = useState(initialBoard);
  const [fleet, setFleet] = useState(initialFleet);
  const [stuck, setStuck] = useState(initialStuck);
  const [pay, setPay] = useState(initialPay);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refetch = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const supabase = createClient();
      const [{ data: b }, { data: f }, { count: sc }, { count: pc }] = await Promise.all([
        supabase.from("admin_order_board").select("*").order("in_state_seconds", { ascending: false }),
        supabase.from("admin_fleet_status").select("*").order("full_name"),
        supabase.from("admin_stuck_orders").select("id", { count: "exact", head: true }),
        supabase.from("admin_payment_queue").select("id", { count: "exact", head: true }),
      ]);
      if (b) setBoard(b as AdminOrderBoardRow[]);
      if (f) setFleet(f as AdminFleetRow[]);
      if (sc !== null) setStuck(sc);
      if (pc !== null) setPay(pc);
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

  const couriersWorking = fleet.filter((c) => c.status === "online" || c.status === "on_delivery").length;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Comenzi active" value={board.length} tone="bg-white/[0.04] ring-white/[0.06]" />
        <Tile label="Curieri activi" value={couriersWorking} tone="bg-emerald-500/10 ring-emerald-500/20" />
        <Tile
          label="Comenzi blocate"
          value={stuck}
          tone={stuck ? "bg-primary/15 ring-primary/30" : "bg-white/[0.04] ring-white/[0.06]"}
          href="/platform/queues"
        />
        <Tile
          label="Dispute plăți"
          value={pay}
          tone={pay ? "bg-gold/15 ring-gold/30" : "bg-white/[0.04] ring-white/[0.06]"}
          href="/platform/queues"
        />
      </div>
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
