import { createClient } from "@/lib/supabase/server";
import { ORDER_STATUS_LABEL, type Order, type PaymentStatus } from "@/lib/types/domain";

const PAYMENT_LABEL: Record<PaymentStatus, string> = {
  unpaid: "Neîncasată",
  pending_capture: "În curs de încasare",
  paid: "Încasată",
  refund_pending: "Rambursare în curs",
  refunded: "Rambursată",
  failed: "Eșuată",
};

// Global ops view. proxy.ts gates /platform/* to platform_admin; RLS scopes
// rows regardless (a non-admin who somehow reached this would only see rows
// their own policies allow — partner/courier scoped reads, not everything).
export default async function PlatformOrdersPage() {
  const supabase = await createClient();

  const [ordersRes, restaurantsRes] = await Promise.all([
    supabase.from("orders").select("*").order("created_at", { ascending: false }).limit(100),
    supabase.from("restaurants").select("id, name"),
  ]);

  if (ordersRes.error || restaurantsRes.error) {
    return (
      <main className="flex-1 px-6 py-10">
        <h1 className="mb-6 text-2xl font-semibold">Toate comenzile</h1>
        <p className="text-red-600">
          Nu am putut încărca comenzile: {ordersRes.error?.message ?? restaurantsRes.error?.message}
        </p>
      </main>
    );
  }

  const orderList = (ordersRes.data ?? []) as Order[];
  const restaurantName = new Map((restaurantsRes.data ?? []).map((r) => [r.id, r.name]));
  const formatDate = new Intl.DateTimeFormat("ro-RO", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Chisinau",
  });

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
                  <td className="py-2 pr-4">{PAYMENT_LABEL[order.payment_status]}</td>
                  <td className="py-2 pr-4">{order.total_mdl} MDL</td>
                  <td className="py-2">{formatDate.format(new Date(order.created_at))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
