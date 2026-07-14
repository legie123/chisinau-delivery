import { createClient } from "@/lib/supabase/server";
import { ORDER_STATUS_LABEL, type Order } from "@/lib/types/domain";

// Global ops view — RLS (orders_admin_all) makes this platform_admin-only;
// any other role simply sees zero rows.
export default async function PlatformOrdersPage() {
  const supabase = await createClient();

  const [{ data: orders }, { data: restaurants }] = await Promise.all([
    supabase.from("orders").select("*").order("created_at", { ascending: false }).limit(100),
    supabase.from("restaurants").select("id, name"),
  ]);

  const orderList = (orders ?? []) as Order[];
  const restaurantName = new Map((restaurants ?? []).map((r) => [r.id, r.name]));

  return (
    <main className="flex-1 px-6 py-10">
      <h1 className="mb-6 text-2xl font-semibold">Toate comenzile</h1>
      {orderList.length === 0 ? (
        <p className="text-zinc-500">Nicio comandă încă.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-zinc-800">
                <th className="py-2 pr-4">Comandă</th>
                <th className="py-2 pr-4">Tip</th>
                <th className="py-2 pr-4">Restaurant</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Plată</th>
                <th className="py-2 pr-4">Total</th>
                <th className="py-2">Creată</th>
              </tr>
            </thead>
            <tbody>
              {orderList.map((order) => (
                <tr key={order.id} className="border-b border-zinc-100 dark:border-zinc-900">
                  <td className="py-2 pr-4">{order.order_number}</td>
                  <td className="py-2 pr-4">{order.order_type === "catering" ? "Catering" : "Standard"}</td>
                  <td className="py-2 pr-4">{restaurantName.get(order.restaurant_id) ?? "—"}</td>
                  <td className="py-2 pr-4">{ORDER_STATUS_LABEL[order.status]}</td>
                  <td className="py-2 pr-4">{order.payment_status === "paid" ? "Încasată" : "Neîncasată"}</td>
                  <td className="py-2 pr-4">{order.total_mdl} MDL</td>
                  <td className="py-2">{new Date(order.created_at).toLocaleString("ro-RO")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
