import { createClient } from "@/lib/supabase/server";
import type { Order } from "@/lib/types/domain";

// "Istoric Livrări" from the courier video reference: green check cards,
// restaurant name, time · order number, earnings (delivery fee) in gold.
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
    .select("id, order_number, updated_at, delivery_fee_mdl, restaurant_id, restaurants(name)")
    .eq("courier_id", courier.id)
    .eq("status", "delivered")
    .order("updated_at", { ascending: false })
    .limit(50);

  type HistoryRow = Pick<Order, "id" | "order_number" | "updated_at" | "delivery_fee_mdl" | "restaurant_id"> & {
    restaurants: { name: string } | null;
  };
  const orders = (delivered ?? []) as unknown as HistoryRow[];

  const todayStr = new Date().toLocaleDateString("ro-RO", { timeZone: "Europe/Chisinau" });
  const isToday = (iso: string) =>
    new Date(iso).toLocaleDateString("ro-RO", { timeZone: "Europe/Chisinau" }) === todayStr;
  const todayOrders = orders.filter((o) => isToday(o.updated_at));
  const todayEarnings = todayOrders.reduce((sum, o) => sum + Number(o.delivery_fee_mdl), 0);

  const formatTime = new Intl.DateTimeFormat("ro-RO", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Chisinau",
  });

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 pb-16 pt-6">
      <h1 className="text-2xl font-bold text-white">Istoric Livrări</h1>
      <p className="mb-6 mt-1 text-sm text-white/50">
        Azi · {todayOrders.length} {todayOrders.length === 1 ? "livrare completată" : "livrări completate"} ·{" "}
        <span className="font-semibold text-gold">{todayEarnings} MDL câștigați</span>
      </p>

      {orders.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl bg-white/[0.04] py-14 text-center ring-1 ring-white/[0.06]">
          <span className="text-5xl" aria-hidden>🛵</span>
          <p className="text-white/60">Nicio livrare finalizată încă — prima e cea mai dulce.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {orders.map((order) => (
            <li
              key={order.id}
              className="flex items-center justify-between gap-4 rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/[0.06]"
            >
              <div className="flex items-center gap-4">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400" aria-hidden>
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </span>
                <div>
                  <p className="font-semibold text-white">{order.restaurants?.name ?? "Restaurant"}</p>
                  <p className="mt-0.5 text-sm text-white/50">
                    {formatTime.format(new Date(order.updated_at))} · {order.order_number}
                  </p>
                </div>
              </div>
              <span className="font-bold text-gold">{order.delivery_fee_mdl} MDL</span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
