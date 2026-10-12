import { createClient } from "@/lib/supabase/server";
import { CateringQuoteCard } from "@/components/admin/CateringQuoteCard";
import { OrderQueueLive } from "@/components/admin/OrderQueueLive";
import type { CateringDetails, Order, OrderItem } from "@/lib/types/domain";

export default async function RestaurantCateringPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Multi-restaurant partner guard: .maybeSingle() throws on 2+ rows — take the
  // primary (oldest) link so the page never 500s.
  const { data: staffRows } = await supabase
    .from("restaurant_staff")
    .select("restaurant_id")
    .eq("user_id", user?.id ?? "")
    .order("created_at", { ascending: true })
    .limit(1);
  const staffRow = staffRows?.[0] ?? null;

  // RLS (orders_partner_scope) restricts everything to the caller's restaurant.
  const { data: orders } = await supabase
    .from("orders")
    // Only what CateringQuoteCard renders (it is a client component: `*` shipped customer_id,
    // payment internals and the idempotency key to the browser).
    .select("id, order_number, status, subtotal_mdl, notes, created_at")
    .eq("order_type", "catering")
    .order("created_at", { ascending: false })
    .limit(50);

  const orderList = (orders ?? []) as Order[];
  const orderIds = orderList.map((o) => o.id);

  const [{ data: allDetails }, { data: allItems }] = await Promise.all([
    orderIds.length > 0
      ? supabase.from("catering_details").select("*").in("order_id", orderIds)
      : Promise.resolve({ data: [] }),
    orderIds.length > 0
      ? supabase.from("order_items").select("*").in("order_id", orderIds)
      : Promise.resolve({ data: [] }),
  ]);

  const detailsByOrder = new Map(((allDetails ?? []) as CateringDetails[]).map((d) => [d.order_id, d]));
  const itemsByOrder = new Map<string, OrderItem[]>();
  for (const item of (allItems ?? []) as unknown as OrderItem[]) {
    const list = itemsByOrder.get(item.order_id) ?? [];
    list.push(item);
    itemsByOrder.set(item.order_id, list);
  }

  return (
    <main className="flex-1 px-6 py-10">
      {staffRow && <OrderQueueLive restaurantId={staffRow.restaurant_id} />}
      <h1 className="pg-gold-text mb-6 font-serif text-2xl font-semibold">Cereri de catering</h1>
      {orderList.length === 0 ? (
        <p className="pg-card rounded-2xl p-5 text-white/50">Nicio cerere de catering încă.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {orderList.map((order) => {
            const details = detailsByOrder.get(order.id);
            if (!details) return null;
            return (
              <CateringQuoteCard
                key={order.id}
                order={order}
                details={details}
                items={itemsByOrder.get(order.id) ?? []}
              />
            );
          })}
        </ul>
      )}
    </main>
  );
}
