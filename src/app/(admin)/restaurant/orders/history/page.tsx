import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ORDER_STATUS_LABEL, type Order } from "@/lib/types/domain";

const FINISHED = ["delivered", "cancelled", "rejected"];
const DAYS = 30;

const formatDateTime = new Intl.DateTimeFormat("ro-RO", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Europe/Chisinau",
});

function sinceIso(days: number) {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

// Finished orders of the last 30 days for the tablet. RLS (orders_partner_scope)
// restricts the read to the caller's own restaurant(s); no customer PII is selected.
export default async function RestaurantOrderHistoryPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("orders")
    .select("id, order_number, order_type, status, total_mdl, created_at, cancellation_reason")
    .in("status", FINISHED)
    .gte("created_at", sinceIso(DAYS))
    .order("created_at", { ascending: false })
    .limit(500);
  const orders = (data ?? []) as Pick<
    Order,
    "id" | "order_number" | "order_type" | "status" | "total_mdl" | "created_at" | "cancellation_reason"
  >[];
  const delivered = orders.filter((o) => o.status === "delivered").length;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 pb-16 pt-6">
      <div className="mb-1">
        <Link href="/restaurant/orders" className="text-xs text-white/50 transition hover:text-gold hover:underline">
          ← Înapoi la comenzi
        </Link>
      </div>
      <h1 className="pg-gold-text mb-2 font-serif text-2xl font-bold">Istoric comenzi</h1>
      <p className="mb-6 text-sm text-white/55">
        Ultimele {DAYS} de zile · {orders.length} comenzi încheiate, dintre care {delivered} livrate.
      </p>
      {orders.length === 0 ? (
        <div className="pg-card py-14 text-center text-white/60">Nicio comandă încheiată în ultimele {DAYS} de zile.</div>
      ) : (
        <ul className="flex flex-col gap-2">
          {orders.map((o) => (
            <li key={o.id}>
              <Link
                href={`/restaurant/orders/${o.id}`}
                className="pg-card flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-2xl px-4 py-3 transition hover:bg-white/10"
              >
                <span className="min-w-0">
                  <span className="font-semibold text-white">{o.order_number}</span>
                  {o.order_type === "catering" && <span className="ml-2 text-xs text-gold">Catering</span>}
                  <span className="block text-xs text-white/45">{formatDateTime.format(new Date(o.created_at))}</span>
                </span>
                <span className="flex items-center gap-3 text-sm">
                  <span
                    className={
                      o.status === "delivered" ? "text-emerald-300" : "text-white/55"
                    }
                  >
                    {ORDER_STATUS_LABEL[o.status]}
                  </span>
                  <span className="pg-gold-text font-semibold">{o.total_mdl} MDL</span>
                </span>
                {o.cancellation_reason && (
                  <span className="w-full text-xs italic text-white/45">„{o.cancellation_reason}”</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
