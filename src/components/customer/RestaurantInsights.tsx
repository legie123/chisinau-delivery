import { SvgBars, type SvgBarDatum } from "@/components/charts/SvgBars";
import { PremiumReveal } from "@/components/admin/premium/PremiumReveal";
import type { PopularHourRow, RatingBreakdownRow } from "@/lib/types/domain";

// Discreet customer-facing info section for the restaurant detail page —
// "Ore populare" (Google-"popular times" style) + a rating breakdown, both
// fed by the anon-reachable SOFT-FAIL RPCs in migration 20260728000000
// (getPopularHours/getRatingBreakdown already return [] on any hiccup, so
// this component only needs to decide what to render for an empty result,
// never handle an error itself). Server component — SvgBars needs no
// client JS and neither does this, so the reveal timing comes from
// <PremiumReveal>, not from any state here.

// "Now" hour-of-day (0-23) in Europe/Chisinau service time — matches the
// hour_of_day bucketing done server-side by popular_hours() (extract(hour
// from created_at), also implicitly Postgres session time). en-GB 24h
// formatting can print midnight as "24"; % 24 folds that back to 0.
function chisinauCurrentHour(): number {
  const hour = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Chisinau",
    hour: "2-digit",
    hour12: false,
  }).format(new Date());
  return Number(hour) % 24;
}

export function RestaurantInsights({
  popularHours,
  ratingBreakdown,
  ratingAvg,
  ratingCount,
}: {
  popularHours: PopularHourRow[];
  ratingBreakdown: RatingBreakdownRow[];
  ratingAvg: number;
  ratingCount: number;
}) {
  const hasPopularHours = popularHours.some((r) => r.orders_count > 0);
  const hasRatings = ratingCount > 0 && ratingBreakdown.length > 0;

  // Both soft-failed / genuinely empty (new restaurant, zero delivered
  // orders, zero ratings) → the whole info section is absent, not an empty
  // shell — matches the getPrepEstimates/getPopularHours soft-fail contract.
  if (!hasPopularHours && !hasRatings) return null;

  const currentHour = chisinauCurrentHour();
  const popularBars: SvgBarDatum[] = popularHours.map((r) => ({
    key: String(r.hour_of_day),
    label: String(r.hour_of_day),
    value: r.orders_count,
    highlight: r.hour_of_day === currentHour,
    tooltip: `${String(r.hour_of_day).padStart(2, "0")}:00 — ${r.orders_count} ${r.orders_count === 1 ? "comandă" : "comenzi"}`,
  }));

  const ratingBars: SvgBarDatum[] = [...ratingBreakdown]
    .sort((a, b) => b.stars - a.stars)
    .map((r) => ({
      key: String(r.stars),
      label: `${r.stars} ★`,
      value: r.rating_count,
      secondaryLabel: String(r.rating_count),
      tooltip: `${r.stars} stele — ${r.rating_count} ${r.rating_count === 1 ? "evaluare" : "evaluări"}`,
    }));

  return (
    <PremiumReveal as="section" className="pg-card mt-8 rounded-2xl p-5 sm:p-6">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-white/60">Informații restaurant</h2>

      {hasRatings && (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="flex shrink-0 flex-col items-start sm:w-28">
            <span className="pg-gold-text font-serif text-3xl font-bold">{ratingAvg.toFixed(1)}</span>
            <span className="mt-0.5 text-xs text-white/45">
              {ratingCount} {ratingCount === 1 ? "evaluare" : "evaluări"}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <SvgBars
              data={ratingBars}
              orientation="horizontal"
              width={480}
              height={110}
              gradientId="restaurant-rating-breakdown"
              ariaLabel={`Distribuția evaluărilor pentru acest restaurant, medie ${ratingAvg.toFixed(1)} din 5`}
            />
          </div>
        </div>
      )}

      {hasRatings && hasPopularHours && <div className="pg-hairline-divider" aria-hidden />}

      {hasPopularHours && (
        <div>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-white/45">Ore populare</h3>
          <SvgBars
            data={popularBars}
            orientation="vertical"
            width={640}
            height={140}
            gradientId="restaurant-popular-hours"
            theme="muted"
            axisLabelEvery={4}
            ariaLabel="Ore populare — distribuția comenzilor pe ore din zi"
          />
          <p className="mt-2 text-xs text-white/40">Bazat pe comenzile din ultimele 4 săptămâni</p>
        </div>
      )}
    </PremiumReveal>
  );
}
