// Home KPIs shared by /restaurant/orders (strip above the queue) and
// /restaurant/earnings (hero card). ONE reducer so the two pages can never
// disagree on "Vânzări săptămâna aceasta".
export type WeekOrderRow = {
  order_type: string;
  subtotal_mdl: number;
  total_mdl: number;
  delivery_fee_mdl: number;
  tip_mdl: number | null;
};

/** Same columns both pages select for the week's delivered+paid orders. */
export const WEEK_ORDER_COLUMNS = "order_type, subtotal_mdl, total_mdl, delivery_fee_mdl, tip_mdl";

/** Restaurant food value: standard → subtotal; catering → total − fee − tip
 *  (the quoted food/service charge), matching admin_generate_payouts. Summed
 *  first, rounded once — the earnings page's historical basis. */
export function weekGrossMdl(rows: WeekOrderRow[]): number {
  const sum = rows.reduce(
    (s, o) =>
      s +
      (o.order_type === "standard"
        ? Number(o.subtotal_mdl)
        : Math.max(Number(o.total_mdl) - Number(o.delivery_fee_mdl) - Number(o.tip_mdl ?? 0), 0)),
    0,
  );
  return Math.round(sum * 100) / 100;
}

/** "4.97 ★ / din 31 evaluări"; no ratings → em dash, never a fake 0. */
export function ratingLabel(avg: number | null, count: number): { value: string; hint: string } {
  if (avg === null || count <= 0) return { value: "—", hint: "nicio evaluare încă" };
  return { value: `${Number(avg).toFixed(2)} ★`, hint: `din ${count} ${count === 1 ? "evaluare" : "evaluări"}` };
}
