import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CateringTracking } from "@/components/customer/CateringTracking";
import type { CateringDetails, Order, OrderItem } from "@/lib/types/domain";

export default async function CateringOrderPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const supabase = await createClient();

  const [{ data: order }, { data: details }, { data: items }] = await Promise.all([
    supabase.from("orders").select("*").eq("id", orderId).single(),
    supabase.from("catering_details").select("*").eq("order_id", orderId).maybeSingle(),
    supabase.from("order_items").select("*").eq("order_id", orderId),
  ]);
  if (!order || order.order_type !== "catering" || !details) notFound();

  return (
    <main className="flex-1 px-6 py-10">
      <h1 className="mb-6 text-2xl font-semibold">Catering {order.order_number}</h1>
      <CateringTracking
        initialOrder={order as Order}
        initialDetails={details as CateringDetails}
        items={(items ?? []) as OrderItem[]}
      />
    </main>
  );
}
