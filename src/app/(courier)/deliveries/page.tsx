import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { OnlineToggle } from "@/components/courier/OnlineToggle";
import { AvailableOrderRow } from "@/components/courier/AvailableOrderRow";
import { AvailableOrdersLive } from "@/components/courier/AvailableOrdersLive";
import { ORDER_STATUS_LABEL, type Order } from "@/lib/types/domain";

export default async function DeliveriesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: courier } = await supabase
    .from("couriers")
    .select("*")
    .eq("user_id", user?.id ?? "")
    .maybeSingle();

  if (!courier) {
    return (
      <main className="flex-1 px-5 py-16 text-center">
        <span className="text-5xl" aria-hidden>🛵</span>
        <p className="mt-3 text-white/60">Contul tău nu este înregistrat ca curier. Contactează un administrator.</p>
      </main>
    );
  }

  const [{ data: activeOrders }, { data: availableOrders }] = await Promise.all([
    supabase
      .from("orders")
      .select("*")
      .eq("courier_id", courier.id)
      .in("status", ["courier_assigned", "picked_up", "en_route"]),
    supabase.from("orders").select("*").eq("status", "ready_for_pickup").is("courier_id", null).order("created_at"),
  ]);

  const active = (activeOrders ?? []) as Order[];
  const available = (availableOrders ?? []) as Order[];

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 pb-16 pt-6">
      <AvailableOrdersLive />
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Salut, {courier.full_name.split(" ")[0]} 👋</h1>
          <p className="mt-0.5 text-sm text-white/50">
            {available.length === 0 ? "Nicio comandă disponibilă acum" : `${available.length} comenzi disponibile`}
          </p>
        </div>
        <OnlineToggle initialStatus={courier.status} />
      </div>

      {active.length > 0 && (
        <section className="mb-7">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/50">Livrarea ta activă</h2>
          {active.map((order) => (
            <Link
              key={order.id}
              href={`/deliveries/${order.id}`}
              className="flex items-center justify-between gap-4 rounded-2xl bg-primary p-5 text-white shadow-lg shadow-primary/25 transition hover:bg-primary-dark"
            >
              <div className="flex items-center gap-4">
                <span className="flex h-12 w-12 animate-pulse items-center justify-center rounded-full bg-white/20 text-xl" aria-hidden>
                  🛵
                </span>
                <div>
                  <p className="font-bold">{order.order_number}</p>
                  <p className="text-sm text-white/80">{ORDER_STATUS_LABEL[order.status]}</p>
                </div>
              </div>
              <span className="text-sm font-semibold">Continuă →</span>
            </Link>
          ))}
        </section>
      )}

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/50">Comenzi disponibile</h2>
        {available.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl bg-white/[0.04] py-14 text-center ring-1 ring-white/[0.06]">
            <span className="text-5xl" aria-hidden>🧘</span>
            <p className="text-white/60">Nimic momentan — rămâi online, te anunțăm.</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {available.map((order) => (
              <AvailableOrderRow key={order.id} order={order} />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
