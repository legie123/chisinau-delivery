import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { OrderTracking } from "@/components/customer/OrderTracking";
import type { DeliveryStatusEvent, Order, OrderItem } from "@/lib/types/domain";

export default async function OrderDetailPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const supabase = await createClient();

  const { data: order } = await supabase.from("orders").select("*").eq("id", orderId).single();
  if (!order) notFound();

  const [{ data: items }, { data: events }] = await Promise.all([
    supabase.from("order_items").select("*").eq("order_id", orderId),
    supabase.from("delivery_status_events").select("*").eq("order_id", orderId).order("created_at"),
  ]);

  const typedOrder = order as Order;

  return (
    <main className="flex-1 px-6 py-10">
      <h1 className="mb-6 text-2xl font-semibold">Comanda {typedOrder.order_number}</h1>
      <OrderTracking
        initialOrder={typedOrder}
        initialEvents={(events ?? []) as DeliveryStatusEvent[]}
        items={(items ?? []) as OrderItem[]}
      />
    </main>
  );
}
