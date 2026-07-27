import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { AdminFleetRow, AdminOrderBoardRow, AdminWaitMetricsRow } from "@/lib/types/domain";
import { OpsLive } from "./OpsLive";

export default async function PlatformOpsPage() {
  const supabase = await createClient();

  const [{ data: board }, { data: fleet }, { count: stuckCount }, { count: payCount }, { data: waitMetrics }] =
    await Promise.all([
      supabase.from("admin_order_board").select("*").order("in_state_seconds", { ascending: false }),
      supabase.from("admin_fleet_status").select("*").order("full_name"),
      supabase.from("admin_stuck_orders").select("id", { count: "exact", head: true }),
      supabase.from("admin_payment_queue").select("id", { count: "exact", head: true }),
      supabase.from("admin_wait_metrics").select("*").maybeSingle(),
    ]);

  const orders = (board ?? []) as AdminOrderBoardRow[];
  const fleetRows = (fleet ?? []) as AdminFleetRow[];
  const wait = (waitMetrics as AdminWaitMetricsRow | null) ?? null;

  return (
    <main className="flex-1 px-6 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Centru operațional</h1>
        <Link
          href="/platform/queues"
          className="rounded-full bg-white/5 px-4 py-2 text-sm text-white/70 ring-1 ring-white/10 transition hover:bg-white/10"
        >
          Cozi & dispute →
        </Link>
      </div>

      <OpsLive
        initialBoard={orders}
        initialFleet={fleetRows}
        initialStuck={stuckCount ?? 0}
        initialPay={payCount ?? 0}
        initialWait={wait}
      />
    </main>
  );
}
