import type { RestaurantWaitKpiRow } from "@/lib/types/domain";

// Order 4 — partner-facing KPI strip (restaurant_wait_kpis, has_restaurant_access
// scoped). Server-rendered, no client JS — just a snapshot on page load like the
// prep-estimate chip next to it.
//
// Aerisit 2026-08-16: erau patru pastile de lățimi diferite, într-un rând care se
// rupea neregulat pe desktop și se stivuia ca o scară pe telefon, fiecare
// repetând „(30z)" în etichetă. Acum perioada se spune O SINGURĂ dată deasupra,
// iar valorile stau într-o grilă aliniată (2 coloane pe telefon, 4 pe desktop) cu
// eticheta deasupra cifrei — aceleași date, aceeași sursă, doar citibile dintr-o
// privire de 20 de secunde la tejghea (rubrica de design §4).
function Kpi({
  label,
  value,
  hint,
  alert = false,
}: {
  label: string;
  value: string;
  hint?: string;
  alert?: boolean;
}) {
  return (
    <div
      className={`rounded-xl px-3 py-2.5 ring-1 ${
        alert ? "bg-gold/10 ring-gold/30" : "bg-white/[0.04] ring-white/10"
      }`}
    >
      <dt className="text-[11px] leading-tight text-white/55">
        {label}
        {hint && <span className="block text-[10px] text-white/35">{hint}</span>}
      </dt>
      <dd
        className={`mt-1 whitespace-nowrap text-base font-semibold tabular-nums ${
          alert ? "text-gold" : "text-white"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

export function RestaurantWaitKpiChips({ kpi }: { kpi: RestaurantWaitKpiRow }) {
  const grace = kpi.avoidable_wait_grace_minutes ?? null;
  return (
    <section aria-label="Indicatorii restaurantului, ultimele 30 de zile" className="mb-6">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.25em] text-white/35">
        Ultimele 30 de zile
      </p>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Kpi
          label="Refuzuri"
          value={kpi.reject_rate_pct === null ? "—" : `${kpi.reject_rate_pct}%`}
        />
        <Kpi
          label="Precizie pregătire"
          value={
            kpi.prep_accuracy_avg_minutes === null
              ? "—"
              : `${kpi.prep_accuracy_avg_minutes > 0 ? "+" : ""}${kpi.prep_accuracy_avg_minutes} min`
          }
        />
        <Kpi
          label="Așteptare curier"
          value={kpi.avg_courier_wait_minutes === null ? "—" : `${kpi.avg_courier_wait_minutes} min`}
        />
        <Kpi
          label="Așteptare evitabilă"
          hint={grace === null ? undefined : `peste ${grace} min`}
          value={
            kpi.avoidable_wait_orders > 0
              ? `⚠️ ${kpi.avoidable_wait_orders}`
              : String(kpi.avoidable_wait_orders)
          }
          alert={kpi.avoidable_wait_orders > 0}
        />
      </dl>
    </section>
  );
}
