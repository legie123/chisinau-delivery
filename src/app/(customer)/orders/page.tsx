import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ORDER_STATUS_LABEL, type Order } from "@/lib/types/domain";
import { ReorderButton } from "@/components/customer/ReorderButton";

type OrderRow = Pick<Order, "id" | "order_number" | "order_type" | "created_at" | "status" | "total_mdl"> & {
  restaurant_id: string;
  restaurants: { slug: string; name: string } | null;
  order_items: { menu_item_id: string | null; item_name_snapshot: string; unit_price_mdl: number; quantity: number }[];
};

function statusTone(status: Order["status"]): string {
  if (status === "delivered") return "bg-emerald-500/15 text-emerald-400 ring-emerald-500/30";
  if (status === "cancelled" || status === "rejected") return "bg-primary/15 text-primary ring-primary/30";
  return "bg-gold/15 text-gold ring-gold/30";
}

export default async function OrdersPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <main className="flex-1 px-5 py-16 text-center">
        <p className="text-white/60">
          <Link href="/" className="text-primary underline underline-offset-4">
            Intră din sectorul Clienți
          </Link>{" "}
          ca să vezi comenzile tale.
        </p>
      </main>
    );
  }

  const { data: orders } = await supabase
    .from("orders")
    .select(
      "id, order_number, order_type, created_at, status, total_mdl, restaurant_id, restaurants(slug, name), order_items(menu_item_id, item_name_snapshot, unit_price_mdl, quantity)",
    )
    .eq("customer_id", user.id)
    .order("created_at", { ascending: false })
    .limit(30);

  const orderList = (orders ?? []) as unknown as OrderRow[];
  const formatDate = new Intl.DateTimeFormat("ro-RO", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Chisinau",
  });

  return (
    <main className="flex-1 px-5 pb-24 pt-6">
      <h1 className="mb-6 text-2xl font-bold text-white">Comenzile mele</h1>
      {orderList.length === 0 ? (
        <div className="flex flex-col items-center gap-4 py-20 text-center">
          <span className="text-6xl" aria-hidden>🍣</span>
          <p className="text-white/60">Nu ai plasat nicio comandă încă.</p>
          <Link
            href="/restaurants"
            className="rounded-full bg-primary-dark px-6 py-3 text-sm font-semibold text-white transition hover:bg-primary-darker"
          >
            Comandă acum
          </Link>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {orderList.map((order) => {
            const reorderItems = order.order_items
              .filter((it) => it.menu_item_id)
              .map((it) => ({
                menuItemId: it.menu_item_id as string,
                name: it.item_name_snapshot,
                priceMdl: Number(it.unit_price_mdl),
                quantity: it.quantity,
              }));
            const canReorder =
              order.status === "delivered" &&
              order.order_type === "standard" &&
              order.restaurant_id != null &&
              reorderItems.length > 0;

            return (
              <li key={order.id} className="flex flex-col gap-2">
                <Link
                  href={order.order_type === "catering" ? `/catering/${order.id}` : `/orders/${order.id}`}
                  className="flex items-center justify-between gap-3 rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/[0.06] transition hover:ring-white/20"
                >
                  <div className="min-w-0">
                    {/* #7 — restaurant name + a short item summary so the row is
                        recognizable at a glance, not just an opaque order number. */}
                    <p className="truncate font-semibold text-white">
                      {order.restaurants?.name ?? "Restaurant"}
                      {order.order_type === "catering" && <span className="ml-2 text-xs text-gold">CATERING</span>}
                    </p>
                    {order.order_items.length > 0 && (
                      <p className="mt-0.5 truncate text-sm text-white/60">
                        {order.order_items.map((it) => `${it.quantity}× ${it.item_name_snapshot}`).join(", ")}
                      </p>
                    )}
                    <p className="mt-0.5 text-xs text-white/40">
                      {order.order_number} · {formatDate.format(new Date(order.created_at))}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ${statusTone(order.status)}`}>
                      {ORDER_STATUS_LABEL[order.status]}
                    </span>
                    <span className="font-bold text-white">{order.total_mdl} MDL</span>
                  </div>
                </Link>
                {canReorder && (
                  <ReorderButton
                    restaurantId={order.restaurant_id}
                    restaurantName={order.restaurants?.name ?? "Restaurant"}
                    items={reorderItems}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
