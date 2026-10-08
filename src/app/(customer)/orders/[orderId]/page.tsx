import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { OrderTracking } from "@/components/customer/OrderTracking";
import type { DeliveryStatusEvent, Order, OrderItem, Rating } from "@/lib/types/domain";
import { SectorBackdrop } from "@/components/immersive/SectorBackdrop";

export default async function OrderDetailPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const supabase = await createClient();

  const [{ data: order }, { data: items }, { data: events }, { data: ratings }] = await Promise.all([
    supabase.from("orders").select("*, restaurants(name, accept_sla_minutes, lat, lng)").eq("id", orderId).single(),
    supabase.from("order_items").select("*").eq("order_id", orderId),
    supabase.from("delivery_status_events").select("*").eq("order_id", orderId).order("created_at"),
    supabase.from("ratings").select("*").eq("order_id", orderId),
  ]);
  if (!order) notFound();

  // Assigned courier's first name + phone for the live tracking card. Customers have no
  // read on `couriers`; order_courier_contact returns these two fields only for the
  // caller's own order while courier_assigned / picked_up / en_route (20261008000300).
  let courierFirstName: string | null = null;
  let courierPhone: string | null = null;
  if ((order as Order).courier_id) {
    const { data: courier } = await supabase.rpc("order_courier_contact", { p_order_id: orderId }).maybeSingle();
    if (courier) {
      courierFirstName = courier.first_name || null;
      courierPhone = courier.phone || null;
    }
  }

  const typedOrder = order as Order;
  const embedded = order as unknown as { restaurants: { name: string | null; accept_sla_minutes: number; lat: number | null; lng: number | null } | null };
  const acceptSlaMinutes = embedded.restaurants?.accept_sla_minutes ?? 7;
  const restaurantName = embedded.restaurants?.name ?? null;

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
    <main className="relative isolate flex-1 px-6 py-10">
      {/* Aici omul AȘTEAPTĂ — e cel mai lung moment din tot fluxul și singurul
          în care nu are ce face. `ambient` ține camera caldă cât se apropie
          curierul; nu e ecran de lucru, e răbdare. */}
      <SectorBackdrop sector="customer" intensity="ambient" />
      <div className="mb-6">
        {restaurantName && (
          <p className="text-sm font-medium uppercase tracking-wider text-white/50">{restaurantName}</p>
        )}
        <h1 className="text-2xl font-semibold">Comanda {typedOrder.order_number}</h1>
      </div>
      <OrderTracking
        initialOrder={typedOrder}
        initialEvents={(events ?? []) as DeliveryStatusEvent[]}
        items={(items ?? []) as unknown as OrderItem[]}
        acceptSlaMinutes={acceptSlaMinutes}
        initialRatings={(ratings ?? []) as Rating[]}
        pickup={pickup}
        dropoff={dropoff}
        courierFirstName={courierFirstName}
        courierPhone={courierPhone}
      />
    </main>
  );
}
