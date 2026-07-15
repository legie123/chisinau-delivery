import { createClient } from "@/lib/supabase/server";
import { OrderQueueRow } from "@/components/admin/OrderQueueRow";
import { OrderQueueLive } from "@/components/admin/OrderQueueLive";
import type { Order } from "@/lib/types/domain";

const QUEUE_STATUSES = ["pending_restaurant", "accepted", "ready_for_pickup", "courier_assigned", "picked_up", "en_route"];

export default async function RestaurantOrdersPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: staffRow } = await supabase
    .from("restaurant_staff")
    .select("restaurant_id")
    .eq("user_id", user?.id ?? "")
    .maybeSingle();

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
      <h1 className="mb-6 text-2xl font-bold text-white">Comenzi</h1>
      {orderList.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl bg-white/[0.04] py-14 text-center ring-1 ring-white/[0.06]">
          <span className="text-5xl" aria-hidden>🍱</span>
          <p className="text-white/60">Nicio comandă activă — cele noi apar aici instant.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {orderList.map((order) => (
            <OrderQueueRow key={order.id} order={order} />
          ))}
        </ul>
      )}
    </main>
  );
}
