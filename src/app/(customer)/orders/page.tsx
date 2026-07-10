import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ORDER_STATUS_LABEL, type Order } from "@/lib/types/domain";

export default async function OrdersPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <main className="flex-1 px-6 py-10">
        <h1 className="mb-2 text-2xl font-semibold">Comenzile mele</h1>
        <p className="text-zinc-500">
          <a href="/login?next=/orders" className="underline underline-offset-4">
            Autentifică-te
          </a>{" "}
          ca să vezi comenzile tale.
        </p>
      </main>
    );
  }

  const { data: orders } = await supabase
    .from("orders")
    .select("*")
    .eq("customer_id", user.id)
    .order("created_at", { ascending: false });

  const orderList = (orders ?? []) as Order[];

  return (
    <main className="flex-1 px-6 py-10">
      <h1 className="mb-6 text-2xl font-semibold">Comenzile mele</h1>
      {orderList.length === 0 ? (
        <p className="text-zinc-500">Nu ai plasat nicio comandă încă.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {orderList.map((order) => (
            <li key={order.id}>
              <Link
                href={`/orders/${order.id}`}
                className="flex items-center justify-between rounded-lg border border-zinc-200 px-4 py-3 text-sm transition hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600"
              >
                <span>{order.order_number}</span>
                <span className="text-zinc-500">{ORDER_STATUS_LABEL[order.status]}</span>
                <span>{order.total_mdl} MDL</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
