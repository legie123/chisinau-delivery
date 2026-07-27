"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { subscribeTable } from "@/lib/realtime/subscribeTable";
import { startJitteredPoll, type JitteredPoll } from "@/lib/realtime/pollJitter";
import type { AdminDispatchMetricsRow, AdminFleetRow, AdminOrderBoardRow, AdminWaitMetricsRow } from "@/lib/types/domain";
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

// Vetted order 10 #1 — dispatch metric tiles show a formatted string (not a
// bare number, unlike Tile above) plus a Romanian one-line explanation.
function DispatchTile({ label, display, subtitle }: { label: string; display: string; subtitle: string }) {
  return (
    <div className="rounded-2xl bg-white/[0.04] p-4 ring-1 ring-white/[0.06]" title={subtitle}>
      <p className="text-2xl font-bold tabular-nums text-white">{display}</p>
      <p className="mt-0.5 text-xs text-white/60">{label}</p>
      <p className="mt-1 text-[11px] leading-snug text-white/40">{subtitle}</p>
    </div>
  );
}

function formatSecondsAsMinutes(seconds: number | null): string {
  if (seconds === null) return "—";
  const minutes = seconds / 60;
  return `${minutes.toFixed(1)} min`;
}

function formatPercent(rate: number | null): string {
  if (rate === null) return "—";
  return `${Math.round(rate * 100)}%`;
}

function formatWaves(depth: number | null): string {
  if (depth === null) return "—";
  return `${depth.toFixed(1)} valuri`;
}

function formatMinutes(minutes: number | null): string {
  if (minutes === null) return "—";
  return `${minutes.toFixed(0)} min`;
}

// Live ops center. Subscribes to orders + couriers + courier_locations whole-table
// (admin RLS scopes the rows; this is the sanctioned unfiltered case) and refetches
// the admin views on any event, debounced. Falls back to 30s polling if realtime
// degrades. ALL five KPI tiles derive from the live state (board/fleet + refetched
// stuck/payment/wait counts) so they never drift from the kanban below.
export function OpsLive({
  initialBoard,
  initialFleet,
  initialStuck,
  initialPay,
  initialWait,
  initialDispatch,
}: {
  initialBoard: AdminOrderBoardRow[];
  initialFleet: AdminFleetRow[];
  initialStuck: number;
  initialPay: number;
  initialWait: AdminWaitMetricsRow | null;
  initialDispatch: AdminDispatchMetricsRow | null;
}) {
  const [board, setBoard] = useState(initialBoard);
  const [fleet, setFleet] = useState(initialFleet);
  const [stuck, setStuck] = useState(initialStuck);
  const [pay, setPay] = useState(initialPay);
  const [wait, setWait] = useState(initialWait);
  const [dispatch, setDispatch] = useState(initialDispatch);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Undebounced fetch — used directly by the jittered poll fallback (which
  // already self-paces) and wrapped by `refetch` below for realtime bursts.
  const fetchLatest = useCallback(async () => {
    const supabase = createClient();
    const [{ data: b }, { data: f }, { count: sc }, { count: pc }, { data: w }, { data: d }] = await Promise.all([
      supabase.from("admin_order_board").select("*").order("in_state_seconds", { ascending: false }),
      supabase.from("admin_fleet_status").select("*").order("full_name"),
      supabase.from("admin_stuck_orders").select("id", { count: "exact", head: true }),
      supabase.from("admin_payment_queue").select("id", { count: "exact", head: true }),
      supabase.from("admin_wait_metrics").select("*").maybeSingle(),
      supabase.from("admin_dispatch_metrics").select("*").maybeSingle(),
    ]);
    if (b) setBoard(b as AdminOrderBoardRow[]);
    if (f) setFleet(f as AdminFleetRow[]);
    if (sc !== null) setStuck(sc);
    if (pc !== null) setPay(pc);
    if (w) setWait(w as AdminWaitMetricsRow);
    if (d) setDispatch(d as AdminDispatchMetricsRow);
  }, []);

  const refetch = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void fetchLatest(), 400);
  }, [fetchLatest]);

  useEffect(() => {
    const supabase = createClient();
    let stopped = false;
    // Jittered (base 30s ± 0-10s, exponential backoff on consecutive failures)
    // — prevents every degraded admin tab from hammering Supabase in lockstep.
    let poll: JitteredPoll | null = null;
    const degraded = new Set<string>();

    const startPolling = (key: string) => {
      degraded.add(key);
      // #7: a CLOSED ack that arrives after unmount must not resurrect the poll.
      if (stopped || poll) return;
      poll = startJitteredPoll(fetchLatest);
    };
    const stopPollingIfHealthy = (key: string) => {
      degraded.delete(key);
      // #9: only stop the shared poll once EVERY channel has recovered.
      if (degraded.size === 0 && poll) {
        poll.stop();
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
      if (poll) poll.stop();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [refetch, fetchLatest]);

  const couriersWorking = fleet.filter((c) => c.status === "online" || c.status === "on_delivery").length;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Tile label="Comenzi active" value={board.length} tone="bg-white/[0.04] ring-white/[0.06]" />
        <Tile label="Curieri activi" value={couriersWorking} tone="bg-emerald-500/10 ring-emerald-500/20" />
        <Tile
          label="Comenzi blocate"
          value={stuck}
          tone={stuck ? "bg-primary/15 ring-primary/30" : "bg-white/[0.04] ring-white/[0.06]"}
          href="/platform/queues"
        />
        {/* Order 3/4 — observe-only wait KPI (arrival clock → pickup, avoidable
            beyond the admin-tunable grace). No auto-compensation attached. */}
        <Tile
          label={`Așteptare evitabilă (7z) · medie ${wait?.avg_wait_minutes_7d ?? "—"} min`}
          value={wait?.avoidable_wait_orders_7d ?? 0}
          tone={
            (wait?.avoidable_wait_orders_7d ?? 0) > 0
              ? "bg-gold/15 ring-gold/30"
              : "bg-white/[0.04] ring-white/[0.06]"
          }
        />
        <Tile
          label="Dispute plăți"
          value={pay}
          tone={pay ? "bg-gold/15 ring-gold/30" : "bg-white/[0.04] ring-white/[0.06]"}
          href="/platform/queues"
        />
      </div>
      {/* Vetted order 10 #1 — Dispatch metrics row, rolling 7 days. Each tile
          carries its Romanian explanation both as a hover tooltip and inline
          subtitle text (KPI tile pattern extended, not replaced). */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/50">Dispatch (7 zile)</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
          <DispatchTile
            label="Timp mediu alocare"
            display={formatSecondsAsMinutes(dispatch?.time_to_assign_avg_seconds ?? null)}
            subtitle="De la 'gata de ridicare' până la alocarea unui curier."
          />
          <DispatchTile
            label="Acceptare prima ofertă"
            display={formatPercent(dispatch?.first_offer_acceptance_rate ?? null)}
            subtitle="Procent din ofertele de val 1 acceptate de curier."
          />
          <DispatchTile
            label="Adâncime cascadă refuzuri"
            display={formatWaves(dispatch?.decline_cascade_depth_avg ?? null)}
            subtitle="Numărul mediu de valuri de ofertă până la alocare."
          />
          <DispatchTile
            label="Predare restaurant → curier"
            display={formatSecondsAsMinutes(dispatch?.restaurant_handover_avg_seconds ?? null)}
            subtitle="De la 'gata de ridicare' până la ridicare efectivă — INCLUDE deplasarea curierului, deci e o limită superioară a așteptării reale (vezi Așteptare evitabilă mai sus)."
          />
          <DispatchTile
            label="Livrare totală medie"
            display={formatMinutes(dispatch?.total_delivery_avg_minutes ?? null)}
            subtitle="De la plasarea comenzii până la livrare."
          />
          <DispatchTile
            label="Comenzi neonorate"
            display={formatPercent(dispatch?.unfinished_order_rate ?? null)}
            subtitle="Procent din comenzile acceptate care au fost anulate ulterior."
          />
        </div>
      </section>
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
