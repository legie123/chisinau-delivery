import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SectionTabs, ordersTabs } from "@/components/admin/SectionTabs";
import { ORDER_STATUS_LABEL, type Order, type OrderStatus, type PaymentStatus } from "@/lib/types/domain";

const PAYMENT_LABEL: Record<PaymentStatus, string> = {
  unpaid: "Neîncasată",
  pending_capture: "În curs de încasare",
  paid: "Încasată",
  refund_pending: "Rambursare în curs",
  refunded: "Rambursată",
  failed: "Eșuată",
};

const PAGE_SIZE = 50;

function isOrderStatus(value: string): value is OrderStatus {
  return value in ORDER_STATUS_LABEL;
}

function buildHref(q: string, status: string, page: number) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (status) params.set("status", status);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/platform/orders?${qs}` : "/platform/orders";
}

// Global ops view. proxy.ts gates /platform/* to platform_admin; RLS scopes
// rows regardless (a non-admin who somehow reached this would only see rows
// their own policies allow — partner/courier scoped reads, not everything).
// #17: was an unsearchable flat 100-row cap — now search by order number,
// filter by status, and paginate instead of silently truncating.
export default async function PlatformOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const { q: rawQ, status: rawStatus, page: rawPage } = await searchParams;
  const q = (rawQ ?? "").trim();
  const status = rawStatus && isOrderStatus(rawStatus) ? rawStatus : "";
  const page = Math.max(1, Math.floor(Number(rawPage)) || 1);

  const supabase = await createClient();

  let query = supabase.from("orders").select("*, restaurants(name)", { count: "exact" });
  if (q) query = query.ilike("order_number", `%${q}%`);
  if (status) query = query.eq("status", status);

  const from = (page - 1) * PAGE_SIZE;
  const [ordersRes, { count: stuckCount }] = await Promise.all([
    query.order("created_at", { ascending: false }).range(from, from + PAGE_SIZE - 1),
    supabase.from("admin_stuck_orders").select("id", { count: "exact", head: true }),
  ]);

  if (ordersRes.error) {
    return (
      <main className="flex-1 px-6 py-10">
        <h1 className="mb-6 text-2xl font-semibold">Toate comenzile</h1>
        <p className="text-red-400">Nu am putut încărca comenzile: {ordersRes.error.message}</p>
      </main>
    );
  }

  const orderList = (ordersRes.data ?? []) as unknown as (Order & { restaurants: { name: string } | null })[];
  const total = ordersRes.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const formatDate = new Intl.DateTimeFormat("ro-RO", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Chisinau",
  });

  return (
    <main className="flex-1 px-6 py-10">
      <h1 className="mb-4 text-2xl font-semibold">Comenzi</h1>
      <SectionTabs tabs={ordersTabs(stuckCount ?? 0)} current="/platform/orders" />

      <form method="GET" className="mb-6 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-white/50">
          Nr. comandă
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="ex: ORD-1234"
            className="w-48 rounded-lg bg-white/5 px-3 py-2 text-sm text-white placeholder-white/35 ring-1 ring-white/10 outline-none focus:ring-primary/60"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-white/50">
          Status
          <select
            name="status"
            defaultValue={status}
            className="rounded-lg bg-white/5 px-3 py-2 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-primary/60"
          >
            <option value="">Toate</option>
            {Object.entries(ORDER_STATUS_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="rounded-full bg-primary-dark px-5 py-2 text-sm font-semibold text-white transition hover:bg-primary-darker"
        >
          Caută
        </button>
        {(q || status) && (
          <Link href="/platform/orders" className="text-sm text-white/50 underline underline-offset-4">
            Resetează
          </Link>
        )}
      </form>

      <p className="mb-3 text-xs text-white/40">
        {total} {total === 1 ? "comandă" : "comenzi"} găsite
      </p>

      {orderList.length === 0 ? (
        <p className="text-white/50">Nicio comandă găsită.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-white/10">
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
                <tr key={order.id} className="border-b border-white/5">
                  <td className="py-2 pr-4">
                    <Link href={`/platform/orders/${order.id}`} className="text-gold hover:underline">
                      {order.order_number}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">{order.order_type === "catering" ? "Catering" : "Standard"}</td>
                  <td className="py-2 pr-4">{order.restaurants?.name ?? "—"}</td>
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

      {totalPages > 1 && (
        <div className="mt-6 flex items-center justify-center gap-3 text-sm">
          <Link
            href={buildHref(q, status, Math.max(1, page - 1))}
            aria-disabled={page <= 1}
            className={`rounded-full px-4 py-1.5 ring-1 ring-white/10 ${
              page <= 1 ? "pointer-events-none text-white/25" : "text-white/70 hover:bg-white/10"
            }`}
          >
            ← Anterior
          </Link>
          <span className="text-white/50">
            Pagina {page} din {totalPages}
          </span>
          <Link
            href={buildHref(q, status, Math.min(totalPages, page + 1))}
            aria-disabled={page >= totalPages}
            className={`rounded-full px-4 py-1.5 ring-1 ring-white/10 ${
              page >= totalPages ? "pointer-events-none text-white/25" : "text-white/70 hover:bg-white/10"
            }`}
          >
            Următor →
          </Link>
        </div>
      )}
    </main>
  );
}
