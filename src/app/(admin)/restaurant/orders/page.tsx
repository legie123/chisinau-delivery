import { createClient } from "@/lib/supabase/server";
import { OrderQueueRow } from "@/components/admin/OrderQueueRow";
import { OrderQueueLive } from "@/components/admin/OrderQueueLive";
import type { Order, PrepEstimate } from "@/lib/types/domain";

const QUEUE_STATUSES = ["pending_restaurant", "accepted", "ready_for_pickup", "courier_assigned", "picked_up", "en_route"];

export default async function RestaurantOrdersPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: staffRow } = await supabase
    .from("restaurant_staff")
    .select("restaurant_id, restaurants(accept_sla_minutes)")
    .eq("user_id", user?.id ?? "")
    .maybeSingle();

  const acceptSlaMinutes =
    (staffRow?.restaurants as unknown as { accept_sla_minutes: number }[] | null)?.[0]?.accept_sla_minutes ?? 7;

  // WS4 — the restaurant's own live prep estimate (drives the kitchen header chip).
  let prepEstimate: PrepEstimate | null = null;
  if (staffRow?.restaurant_id) {
    const { data: prepRows } = await supabase.rpc("get_prep_estimates", {
      p_restaurant_ids: [staffRow.restaurant_id],
    });
    prepEstimate = ((prepRows ?? []) as PrepEstimate[])[0] ?? null;
  }

  // RLS (orders_partner_scope) already restricts this to the caller's own
  // restaurant. Catering orders are excluded — accepting one here would skip
  // the quote flow entirely; they live in /restaurant/catering.
  const { data: orders } = await supabase
    .from("orders")
    .select("*")
    .eq("order_type", "standard")
    .in("status", QUEUE_STATUSES)
    .order("created_at");

  const orderList = (orders ?? []) as Order[];

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 pb-16 pt-6">
      {staffRow && <OrderQueueLive restaurantId={staffRow.restaurant_id} />}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-white">Comenzi</h1>
        {prepEstimate && (
          <span className="rounded-full bg-white/5 px-3 py-1.5 text-xs font-medium text-white/70 ring-1 ring-white/10">
            ⏱ Timp de pregătire estimat:{" "}
            <span className="font-semibold text-white">~{prepEstimate.prep_minutes} min</span>
            <span className="ml-1 text-white/40">
              {prepEstimate.source === "static"
                ? "(valoare implicită)"
                : prepEstimate.source === "hourly"
                  ? "(medie pentru ora curentă)"
                  : "(medie ultimele 28 zile)"}
            </span>
          </span>
        )}
      </div>
      {orderList.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl bg-white/[0.04] py-14 text-center ring-1 ring-white/[0.06]">
          <span className="text-5xl" aria-hidden>🍱</span>
          <p className="text-white/60">Nicio comandă activă — cele noi apar aici instant.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {orderList.map((order) => (
            <OrderQueueRow key={order.id} order={order} acceptSlaMinutes={acceptSlaMinutes} />
          ))}
        </ul>
      )}
    </main>
  );
}
