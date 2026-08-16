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
  note,
  alert = false,
}: {
  label: string;
  value: string;
  hint?: string;
  note?: string;
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
        {/* Sensul stă sub cifră, nu lipit de ea: numărul rămâne mare și
            aliniat, iar rândul de dedesubt poate să curgă pe două linii pe
            telefon fără să taie nimic (lecția valului V1). */}
        {note && (
          <span className="mt-0.5 block text-[10px] font-normal leading-tight whitespace-normal text-white/45">
            {note}
          </span>
        )}
      </dd>
    </div>
  );
}

// „-24.9 min" nu spune nimănui ce înseamnă minusul. Semnul are sens — sub
// estimare = bucătăria e gata mai devreme decât a promis — și sensul ăla se
// scrie în cuvinte, nu se ascunde. Media lipsește deliberat sub 5 comenzi
// (migrația 20260816000000, aceeași regulă ca get_prep_estimates), iar atunci
// spunem DE CE lipsește în loc să lăsăm o liniuță mută.
function prepAccuracy(minutes: number | null, orders: number) {
  if (minutes === null) {
    return {
      value: "—",
      hint: orders === 0 ? "nicio comandă măsurată" : `doar ${orders} comenzi măsurate`,
      note: "prea puține comenzi pentru o medie",
    };
  }
  const rounded = Math.round(Math.abs(minutes) * 10) / 10;
  if (rounded === 0) return { value: "La fix", hint: `din ${orders} comenzi`, note: undefined };
  return {
    value: `${rounded} min`,
    hint: `din ${orders} comenzi`,
    note: minutes < 0 ? "mai devreme decât estimarea" : "peste estimare",
  };
}

export function RestaurantWaitKpiChips({ kpi }: { kpi: RestaurantWaitKpiRow }) {
  const grace = kpi.avoidable_wait_grace_minutes ?? null;
  const prep = prepAccuracy(kpi.prep_accuracy_avg_minutes, kpi.prep_accuracy_orders);
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
        <Kpi label="Precizie pregătire" value={prep.value} hint={prep.hint} note={prep.note} />
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
