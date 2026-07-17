import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { OrderTracking } from "@/components/customer/OrderTracking";
import type { DeliveryStatusEvent, Order, OrderItem, Rating } from "@/lib/types/domain";

export default async function OrderDetailPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const supabase = await createClient();

  const [{ data: order }, { data: items }, { data: events }, { data: ratings }] = await Promise.all([
    supabase.from("orders").select("*, restaurants(accept_sla_minutes, lat, lng)").eq("id", orderId).single(),
    supabase.from("order_items").select("*").eq("order_id", orderId),
    supabase.from("delivery_status_events").select("*").eq("order_id", orderId).order("created_at"),
    supabase.from("ratings").select("*").eq("order_id", orderId),
  ]);
  if (!order) notFound();

  const typedOrder = order as Order;
  const embedded = order as unknown as { restaurants: { accept_sla_minutes: number; lat: number | null; lng: number | null } | null };
  const acceptSlaMinutes = embedded.restaurants?.accept_sla_minutes ?? 7;

  // Map endpoints for the live tracker: pickup (restaurant) + dropoff (address).
  const rest = embedded.restaurants;
  const pickup = rest?.lat != null && rest?.lng != null ? { lat: rest.lat, lng: rest.lng } : null;
  let dropoff: { lat: number; lng: number } | null = null;
  if (typedOrder.delivery_address_id) {
    const { data: addr } = await supabase
      .from("addresses")
      .select("lat, lng")
      .eq("id", typedOrder.delivery_address_id)
      .maybeSingle();
    if (addr?.lat != null && addr?.lng != null) dropoff = { lat: addr.lat, lng: addr.lng };
  }

  return (
    <main className="flex-1 px-6 py-10">
      <h1 className="mb-6 text-2xl font-semibold">Comanda {typedOrder.order_number}</h1>
      <OrderTracking
        initialOrder={typedOrder}
        initialEvents={(events ?? []) as DeliveryStatusEvent[]}
        items={(items ?? []) as OrderItem[]}
        acceptSlaMinutes={acceptSlaMinutes}
        initialRatings={(ratings ?? []) as Rating[]}
        pickup={pickup}
        dropoff={dropoff}
      />
    </main>
  );
}
