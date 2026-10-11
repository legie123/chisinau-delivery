import { currentWeekRange } from "@chisinau/shared-domain";
import { requireOwnRestaurant } from "@/lib/auth/require";
import { dayRange, weekCsv, type CsvOrder } from "../csv";

// GET /restaurant/earnings/export?week=YYYY-MM-DD → CSV of the delivered orders
// in the Chișinău week (Mon–Sun) containing that date; default: current week.
// ?day=YYYY-MM-DD → the same for one Chișinău day (the daily settlement).
// Same basis as the payouts: delivered_at in the week, paid, own restaurant.
export async function GET(request: Request) {
  let ctx;
  try {
    ctx = await requireOwnRestaurant();
  } catch {
    return new Response("Neautentificat.", { status: 401 });
  }
  const params = new URL(request.url).searchParams;
  const ymd = /^\d{4}-\d{2}-\d{2}$/;
  const day = params.get("day");
  const week = params.get("week");
  let start: Date, end: Date, filename: string;
  if (day) {
    if (!ymd.test(day) || Number.isNaN(Date.parse(`${day}T12:00:00Z`))) return new Response("Zi invalidă.", { status: 400 });
    ({ start, end } = dayRange(day));
    filename = `vanzari-zi-${day}.csv`;
  } else {
    const anchor = week && ymd.test(week) ? new Date(`${week}T12:00:00Z`) : new Date();
    if (Number.isNaN(anchor.getTime())) return new Response("Săptămână invalidă.", { status: 400 });
    const w = currentWeekRange(anchor);
    ({ start, end } = w);
    filename = `vanzari-${w.startDate}.csv`;
  }

  const { data, error } = await ctx.supabase
    .from("orders")
    .select("order_number, delivered_at, order_type, payment_method, subtotal_mdl, total_mdl, delivery_fee_mdl, tip_mdl")
    .eq("restaurant_id", ctx.restaurantId)
    .eq("status", "delivered")
    .eq("payment_status", "paid")
    .gte("delivered_at", start.toISOString())
    .lt("delivered_at", end.toISOString())
    .order("delivered_at");
  if (error) return new Response("Raportul nu a putut fi generat.", { status: 500 });

  return new Response(weekCsv((data ?? []) as CsvOrder[]), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
