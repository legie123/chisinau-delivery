"use client";

import Link from "next/link";
import { ORDER_STATUS_LABEL, type AdminOrderBoardRow, type OrderStatus } from "@/lib/types/domain";

// Kanban columns = the active lifecycle states, left to right.
const COLUMNS: OrderStatus[] = [
  "pending_restaurant",
  "accepted",
  "ready_for_pickup",
  "courier_assigned",
  "picked_up",
  "en_route",
];

function ageChip(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const label = mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
  const tone =
    seconds > 15 * 60
      ? "bg-primary/15 text-primary ring-primary/30"
      : seconds > 5 * 60
        ? "bg-gold/15 text-gold ring-gold/40"
        : "bg-white/5 text-white/50 ring-white/10";
  return { label, tone };
}

export function OrdersBoard({ orders }: { orders: AdminOrderBoardRow[] }) {
  return (
    <div className="grid gap-3 overflow-x-auto pb-2 [grid-auto-columns:minmax(220px,1fr)] [grid-auto-flow:column]">
      {COLUMNS.map((col) => {
        const items = orders.filter((o) => o.status === col);
        return (
          <div key={col} className="min-w-[220px] rounded-2xl bg-white/[0.03] p-3 ring-1 ring-white/[0.06]">
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-white/60">
                {ORDER_STATUS_LABEL[col]}
              </span>
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-white/60">{items.length}</span>
            </div>
            <div className="flex flex-col gap-2">
              {items.map((o) => {
                const chip = ageChip(o.in_state_seconds);
                return (
                  <Link
                    key={o.id}
                    href="/platform/orders"
                    className="block rounded-xl bg-white/[0.04] p-3 ring-1 ring-white/[0.06] transition hover:ring-gold/30"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-white">{o.order_number}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${chip.tone}`}>
                        {chip.label}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-xs text-white/55">{o.restaurant_name}</p>
                    <div className="mt-1 flex items-center justify-between text-xs">
                      <span className="text-white/45">{o.courier_name ?? "—"}</span>
                      <span className="font-semibold text-white/80">{o.total_mdl} MDL</span>
                    </div>
                  </Link>
                );
              })}
              {items.length === 0 && <p className="px-1 py-2 text-xs text-white/25">—</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
