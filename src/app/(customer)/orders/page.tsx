import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ORDER_STATUS_LABEL, type Order } from "@/lib/types/domain";

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
          <Link href="/login?next=/orders" className="text-primary underline underline-offset-4">
            Autentifică-te
          </Link>{" "}
          ca să vezi comenzile tale.
        </p>
      </main>
    );
  }

  const { data: orders } = await supabase
    .from("orders")
    .select("id, order_number, order_type, created_at, status, total_mdl")
    .eq("customer_id", user.id)
    .order("created_at", { ascending: false })
    .limit(30);

  const orderList = (orders ?? []) as Pick<Order, "id" | "order_number" | "order_type" | "created_at" | "status" | "total_mdl">[];
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
            className="rounded-full bg-primary px-6 py-3 text-sm font-semibold text-white transition hover:bg-primary-dark"
          >
            Comandă acum
          </Link>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {orderList.map((order) => (
            <li key={order.id}>
              <Link
                href={order.order_type === "catering" ? `/catering/${order.id}` : `/orders/${order.id}`}
                className="flex items-center justify-between gap-3 rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/[0.06] transition hover:ring-white/20"
              >
                <div>
                  <p className="font-semibold text-white">
                    {order.order_number}
                    {order.order_type === "catering" && <span className="ml-2 text-xs text-gold">CATERING</span>}
                  </p>
                  <p className="mt-0.5 text-sm text-white/50">{formatDate.format(new Date(order.created_at))}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ${statusTone(order.status)}`}>
                    {ORDER_STATUS_LABEL[order.status]}
                  </span>
                  <span className="font-bold text-white">{order.total_mdl} MDL</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
