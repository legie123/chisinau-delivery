import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { AdminFleetRow, AdminOrderBoardRow } from "@/lib/types/domain";
import { OpsLive } from "./OpsLive";

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

export default async function PlatformOpsPage() {
  const supabase = await createClient();

  const [{ data: board }, { data: fleet }, { count: stuckCount }, { count: payCount }] = await Promise.all([
    supabase.from("admin_order_board").select("*").order("in_state_seconds", { ascending: false }),
    supabase.from("admin_fleet_status").select("*").order("full_name"),
    supabase.from("admin_stuck_orders").select("id", { count: "exact", head: true }),
    supabase.from("admin_payment_queue").select("id", { count: "exact", head: true }),
  ]);

  const orders = (board ?? []) as AdminOrderBoardRow[];
  const fleetRows = (fleet ?? []) as AdminFleetRow[];
  const activeOrders = orders.length;
  const couriersWorking = fleetRows.filter((c) => c.status === "online" || c.status === "on_delivery").length;

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

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Comenzi active" value={activeOrders} tone="bg-white/[0.04] ring-white/[0.06]" />
        <Tile label="Curieri activi" value={couriersWorking} tone="bg-emerald-500/10 ring-emerald-500/20" />
        <Tile
          label="Comenzi blocate"
          value={stuckCount ?? 0}
          tone={stuckCount ? "bg-primary/15 ring-primary/30" : "bg-white/[0.04] ring-white/[0.06]"}
          href="/platform/queues"
        />
        <Tile
          label="Dispute plăți"
          value={payCount ?? 0}
          tone={payCount ? "bg-gold/15 ring-gold/30" : "bg-white/[0.04] ring-white/[0.06]"}
          href="/platform/queues"
        />
      </div>

      <OpsLive initialBoard={orders} initialFleet={fleetRows} />
    </main>
  );
}
