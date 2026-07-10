import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { OnlineToggle } from "@/components/courier/OnlineToggle";
import { AvailableOrderRow } from "@/components/courier/AvailableOrderRow";
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
      <main className="flex-1 px-6 py-10">
        <h1 className="mb-2 text-2xl font-semibold">Livrările tale</h1>
        <p className="text-zinc-500">Contul tău nu este înregistrat ca curier. Contactează un administrator.</p>
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
    <main className="flex-1 px-6 py-10">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Livrările tale</h1>
        <OnlineToggle initialStatus={courier.status} />
      </div>

      {active.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-2 text-sm font-semibold uppercase text-zinc-500">Livrare activă</h2>
          <ul className="flex flex-col gap-2">
            {active.map((order) => (
              <li key={order.id}>
                <Link
                  href={`/deliveries/${order.id}`}
                  className="flex items-center justify-between rounded-lg border border-zinc-200 px-4 py-3 text-sm transition hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600"
                >
                  <span>{order.order_number}</span>
                  <span className="text-zinc-500">{ORDER_STATUS_LABEL[order.status]}</span>
                  <span>{order.total_mdl} MDL</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase text-zinc-500">Comenzi disponibile</h2>
        {available.length === 0 ? (
          <p className="text-zinc-500">Nicio comandă disponibilă momentan.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {available.map((order) => (
              <AvailableOrderRow key={order.id} order={order} />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
