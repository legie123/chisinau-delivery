import { Kpi } from "@/components/admin/RestaurantWaitKpiChips";
import { ratingLabel } from "@/lib/kitchen/homeKpis";

// Home KPI strip above the queue on /restaurant/orders: this week's gross sales
// (same reducer as /restaurant/earnings), delivered count, rating. Server-rendered
// snapshot, same Kpi cells as the 30-day strip below. No promo tile — there is no
// promo subsystem, so there is nothing honest to show.
export function OrderQueueHomeKpis({
  weekGross,
  weekCount,
  ratingAvg,
  ratingCount,
}: {
  weekGross: number;
  weekCount: number;
  ratingAvg: number | null;
  ratingCount: number;
}) {
  const rating = ratingLabel(ratingAvg, ratingCount);
  return (
    <section aria-label="Indicatorii restaurantului, săptămâna aceasta" className="mb-4">
      <dl className="grid grid-cols-3 gap-2">
        <Kpi label="Vânzări săptămâna aceasta" value={`${weekGross.toFixed(2)} MDL`} hint="înainte de comision" />
        <Kpi label="Comenzi livrate" value={String(weekCount)} hint="săptămâna aceasta" />
        <Kpi label="Rating" value={rating.value} hint={rating.hint} />
      </dl>
    </section>
  );
}
