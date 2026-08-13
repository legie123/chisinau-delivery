import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type {
  AdminDispatchMetricsRow,
  AdminFleetRow,
  AdminOrderBoardRow,
  AdminWaitMetricsRow,
} from "@/lib/types/domain";
import { OpsLive } from "./OpsLive";

export default async function PlatformOpsPage() {
  const supabase = await createClient();

  const [
    { data: board },
    { data: fleet },
    { count: stuckCount },
    { count: payCount },
    { count: unpaidCount },
    { data: waitMetrics },
    { data: dispatchMetrics },
  ] = await Promise.all([
    supabase.from("admin_order_board").select("*").order("in_state_seconds", { ascending: false }),
    supabase.from("admin_fleet_status").select("*").order("full_name"),
    supabase.from("admin_stuck_orders").select("id", { count: "exact", head: true }),
    supabase.from("admin_payment_queue").select("id", { count: "exact", head: true }),
    supabase.from("admin_unpaid_delivered_orders").select("id", { count: "exact", head: true }),
    supabase.from("admin_wait_metrics").select("*").maybeSingle(),
    supabase.from("admin_dispatch_metrics").select("*").maybeSingle(),
  ]);

  const orders = (board ?? []) as AdminOrderBoardRow[];
  const fleetRows = (fleet ?? []) as AdminFleetRow[];
  const wait = (waitMetrics as AdminWaitMetricsRow | null) ?? null;
  const dispatch = (dispatchMetrics as AdminDispatchMetricsRow | null) ?? null;

  return (
    <main className="flex-1 px-6 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Centru operațional</h1>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/platform/queues"
            className="rounded-full bg-white/5 px-4 py-2 text-sm text-white/70 ring-1 ring-white/10 transition hover:bg-white/10"
          >
            Atenție acum →
          </Link>
          {/* Pilot go/no-go trăiește aici, nu ca secțiune de top (consolidare
              2026-08-14) — e un scorecard read-only consultat rar. */}
          <Link
            href="/platform/pilot"
            className="rounded-full bg-white/5 px-4 py-2 text-sm text-white/70 ring-1 ring-white/10 transition hover:bg-white/10"
          >
            Pilot go/no-go →
          </Link>
        </div>
      </div>

      {(unpaidCount ?? 0) > 0 && (
        <Link
          href="/platform/payouts"
          className="mb-4 flex items-center justify-between rounded-xl bg-amber-500/10 px-4 py-3 text-sm text-amber-300 ring-1 ring-amber-500/30 transition hover:bg-amber-500/15"
        >
          <span>
            💸 {unpaidCount} {unpaidCount === 1 ? "livrare finalizată neacoperită" : "livrări finalizate neacoperite"} de niciun payout — banii datorați așteaptă o rulare
          </span>
          <span aria-hidden>→</span>
        </Link>
      )}

      <OpsLive
        initialBoard={orders}
        initialFleet={fleetRows}
        initialStuck={stuckCount ?? 0}
        initialPay={payCount ?? 0}
        initialWait={wait}
        initialDispatch={dispatch}
      />
    </main>
  );
}
