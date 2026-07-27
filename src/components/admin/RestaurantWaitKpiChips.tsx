import type { RestaurantWaitKpiRow } from "@/lib/types/domain";

// Order 4 — partner-facing KPI chip row (restaurant_wait_kpis, has_restaurant_access
// scoped). Server-rendered, no client JS — just a snapshot on page load like the
// prep-estimate chip next to it.
export function RestaurantWaitKpiChips({ kpi }: { kpi: RestaurantWaitKpiRow }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
      <span className="rounded-full bg-white/5 px-3 py-1.5 text-white/70 ring-1 ring-white/10">
        📉 Refuzuri (30z):{" "}
        <span className="font-semibold text-white">
          {kpi.reject_rate_pct === null ? "—" : `${kpi.reject_rate_pct}%`}
        </span>
      </span>
      <span className="rounded-full bg-white/5 px-3 py-1.5 text-white/70 ring-1 ring-white/10">
        🎯 Precizie pregătire (30z):{" "}
        <span className="font-semibold text-white">
          {kpi.prep_accuracy_avg_minutes === null
            ? "—"
            : `${kpi.prep_accuracy_avg_minutes > 0 ? "+" : ""}${kpi.prep_accuracy_avg_minutes} min`}
        </span>
      </span>
      <span className="rounded-full bg-white/5 px-3 py-1.5 text-white/70 ring-1 ring-white/10">
        ⏳ Așteptare curier (30z):{" "}
        <span className="font-semibold text-white">
          {kpi.avg_courier_wait_minutes === null ? "—" : `${kpi.avg_courier_wait_minutes} min`}
        </span>
      </span>
      <span
        className={`rounded-full px-3 py-1.5 ring-1 ${
          kpi.avoidable_wait_orders > 0
            ? "bg-gold/15 text-gold ring-gold/30"
            : "bg-white/5 text-white/70 ring-white/10"
        }`}
      >
        ⚠️ Așteptare evitabilă (30z, peste {kpi.avoidable_wait_grace_minutes ?? "—"} min):{" "}
        <span className="font-semibold">{kpi.avoidable_wait_orders}</span>
      </span>
    </div>
  );
}
