import { createClient } from "@/lib/supabase/server";
import { currentWeekRange, netForOrder, summarizeEarnings } from "@/app/(courier)/_lib/earnings";
import type { Order } from "@/lib/types/domain";

// "Istoric Livrări" — every delivered order, newest first. #3b/#3c: the
// headline uses the SAME net-after-commission model + calendar-week window as
// Câștiguri (no more "today, fee-only" number that disagreed with Earnings),
// and a delivered-but-unpaid ("neîncasat") order shows a distinct pending
// badge here too instead of quietly counting as credited earnings.
export default async function DeliveryHistoryPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: courier } = await supabase
    .from("couriers")
    .select("id")
    .eq("user_id", user?.id ?? "")
    .maybeSingle();

  if (!courier) {
    return (
      <main className="flex-1 px-5 py-16 text-center">
        <p className="text-white/60">Contul tău nu este înregistrat ca curier.</p>
      </main>
    );
  }

  const { data: delivered } = await supabase
    .from("orders")
    .select(
      "id, order_number, delivered_at, updated_at, delivery_fee_mdl, courier_fee_mdl, tip_mdl, payment_status, restaurant_id, restaurants(name)",
    )
    .eq("courier_id", courier.id)
    .eq("status", "delivered")
    .order("delivered_at", { ascending: false, nullsFirst: false })
    .limit(50);

  type HistoryRow = Pick<
    Order,
    "id" | "order_number" | "delivery_fee_mdl" | "courier_fee_mdl" | "tip_mdl" | "payment_status" | "restaurant_id"
  > & {
    delivered_at: string | null;
    updated_at: string;
    restaurants: { name: string } | null;
  };
  const orders = (delivered ?? []) as unknown as HistoryRow[];

  const { start: weekStart, end: weekEnd } = currentWeekRange();
  const weekOrders = orders.filter((o) => {
    const at = new Date(o.delivered_at ?? o.updated_at);
    return at >= weekStart && at < weekEnd;
  });
  const weekSummary = summarizeEarnings(weekOrders);

  const formatTime = new Intl.DateTimeFormat("ro-RO", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Chisinau",
  });
  const formatDay = new Intl.DateTimeFormat("ro-RO", { day: "numeric", month: "short", timeZone: "Europe/Chisinau" });

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 pb-16 pt-6">
      <h1 className="text-2xl font-bold text-white">Istoric Livrări</h1>
      <p className="mb-6 mt-1 text-sm text-white/50">
        Săptămâna aceasta · {weekSummary.ordersCount} {weekSummary.ordersCount === 1 ? "livrare încasată" : "livrări încasate"} ·{" "}
        <span className="font-semibold text-gold">{weekSummary.netMdl} MDL net</span>
        {weekSummary.pendingCount > 0 && (
          <span className="text-amber-400/90">
            {" "}
            · {weekSummary.pendingCount} {weekSummary.pendingCount === 1 ? "neîncasată" : "neîncasate"}
          </span>
        )}
      </p>

      {orders.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl bg-white/[0.04] py-14 text-center ring-1 ring-white/[0.06]">
          <span className="text-5xl" aria-hidden>🛵</span>
          <p className="text-white/60">Nicio livrare finalizată încă — prima e cea mai dulce.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {orders.map((order) => {
            const net = netForOrder(order);
            const at = new Date(order.delivered_at ?? order.updated_at);
            return (
              <li
                key={order.id}
                className="flex items-center justify-between gap-4 rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/[0.06]"
              >
                <div className="flex items-center gap-4">
                  <span
                    className={`flex h-11 w-11 items-center justify-center rounded-xl ${
                      net !== null ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-400"
                    }`}
                    aria-hidden
                  >
                    {net !== null ? (
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      "⏳"
                    )}
                  </span>
                  <div>
                    <p className="font-semibold text-white">{order.restaurants?.name ?? "Restaurant"}</p>
                    <p className="mt-0.5 text-sm text-white/50">
                      {formatDay.format(at)} · {formatTime.format(at)} · {order.order_number}
                    </p>
                  </div>
                </div>
                {net !== null ? (
                  <span className="font-bold text-gold">{net} MDL</span>
                ) : (
                  <span
                    className="rounded-full bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-400"
                    title="Livrat, neîncasat — plata nu a fost confirmată; taxa ta nu apare în Câștiguri până nu o rezolvă un administrator."
                  >
                    Neîncasat
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
