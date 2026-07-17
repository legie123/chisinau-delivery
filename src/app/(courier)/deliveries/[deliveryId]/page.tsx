import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DeliveryStatusControls } from "@/components/courier/DeliveryStatusControls";
import { DeliveryProgress } from "@/components/courier/DeliveryProgress";
import { CourierDeliveryMap } from "@/components/courier/CourierDeliveryMap";
import type { Address, Order, OrderItem } from "@/lib/types/domain";

export default async function DeliveryDetailPage({ params }: { params: Promise<{ deliveryId: string }> }) {
  const { deliveryId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: courier } = await supabase
    .from("couriers")
    .select("id")
    .eq("user_id", user?.id ?? "")
    .maybeSingle();
  if (!courier) notFound();

  const { data: order } = await supabase.from("orders").select("*").eq("id", deliveryId).single();
  if (!order) notFound();

  const typedOrder = order as Order;

  // Catering orders carry their destination in catering_details (event venue),
  // not in the customer's saved addresses — without this, the courier page
  // would show "Fără adresă atașată" for every catering delivery.
  const [{ data: items }, { data: restaurant }, { data: address }, { data: catering }] = await Promise.all([
    supabase.from("order_items").select("*").eq("order_id", deliveryId),
    supabase.from("restaurants").select("name, address, phone, lat, lng").eq("id", typedOrder.restaurant_id).single(),
    typedOrder.delivery_address_id
      ? supabase.from("addresses").select("*").eq("id", typedOrder.delivery_address_id).maybeSingle()
      : Promise.resolve({ data: null }),
    typedOrder.order_type === "catering"
      ? supabase
          .from("catering_details")
          .select("event_address_text, contact_person, contact_phone, event_date, event_time")
          .eq("order_id", deliveryId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const typedAddress = address as Address | null;
  const typedRestaurant = restaurant as { name: string; address: string; phone: string; lat: number | null; lng: number | null } | null;
  const pickupPoint = typedRestaurant?.lat != null && typedRestaurant?.lng != null
    ? { lat: typedRestaurant.lat, lng: typedRestaurant.lng }
    : null;
  const dropoffPoint = typedAddress?.lat != null && typedAddress?.lng != null
    ? { lat: typedAddress.lat, lng: typedAddress.lng }
    : null;
  const destinationText = typedAddress?.street_address ?? catering?.event_address_text ?? null;
  const mapsUrl = typedAddress?.lat
    ? `https://www.google.com/maps/dir/?api=1&destination=${typedAddress.lat},${typedAddress.lng}`
    : destinationText
      ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${destinationText}, Chișinău`)}`
      : null;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 pb-16 pt-6">
      <h1 className="mb-5 text-2xl font-bold text-white">Livrare {typedOrder.order_number}</h1>

      <DeliveryProgress status={typedOrder.status} />

      {/* Live GPS route map — your position, pickup, dropoff + one-tap navigation. */}
      <CourierDeliveryMap pickup={pickupPoint} dropoff={dropoffPoint} />

      {/* Route: pickup -> dropoff, Bolt driver two-stop card */}
      <div className="mb-4 flex flex-col gap-3">
        <section className="flex items-start gap-4 rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/[0.06]">
          <span className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gold/15 text-lg" aria-hidden>
            🏪
          </span>
          <div className="min-w-0 text-sm">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-white/50">Ridicare</h2>
            <p className="mt-1 font-semibold text-white">{restaurant?.name}</p>
            <p className="text-white/50">{restaurant?.address}</p>
            {restaurant?.phone && (
              <a href={`tel:${restaurant.phone}`} className="mt-1 inline-block text-primary underline underline-offset-4">
                {restaurant.phone}
              </a>
            )}
          </div>
        </section>

        <section className="flex items-start gap-4 rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/[0.06]">
          <span className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/15 text-lg" aria-hidden>
            📍
          </span>
          <div className="min-w-0 flex-1 text-sm">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-white/50">Livrare</h2>
            {typedAddress ? (
              <>
                <p className="mt-1 font-semibold text-white">{typedAddress.street_address}</p>
                <p className="text-white/50">
                  {[typedAddress.building && `bloc ${typedAddress.building}`, typedAddress.apartment && `ap. ${typedAddress.apartment}`]
                    .filter(Boolean)
                    .join(", ")}
                </p>
                {typedAddress.notes && <p className="mt-1 text-white/50">📝 {typedAddress.notes}</p>}
              </>
            ) : catering ? (
              <>
                <p className="mt-1 font-semibold text-white">{catering.event_address_text}</p>
                <p className="text-white/50">
                  Eveniment {catering.event_date}
                  {catering.event_time ? ` · ${String(catering.event_time).slice(0, 5)}` : ""}
                </p>
                <p className="text-white/50">
                  {catering.contact_person} ·{" "}
                  <a href={`tel:${catering.contact_phone}`} className="text-primary underline underline-offset-4">
                    {catering.contact_phone}
                  </a>
                </p>
              </>
            ) : (
              <p className="mt-1 text-white/50">Fără adresă atașată.</p>
            )}
            {mapsUrl && (
              <a
                href={mapsUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-2 text-xs font-semibold text-white transition hover:bg-white/20"
              >
                🗺️ Navighează cu Google Maps
              </a>
            )}
          </div>
        </section>
      </div>

      <section className="mb-4 rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/[0.06]">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-white/50">Comanda</h2>
        <ul className="flex flex-col gap-2 text-sm">
          {((items ?? []) as OrderItem[]).map((item) => (
            <li key={item.id} className="flex justify-between text-white/90">
              <span>
                {item.quantity}× {item.item_name_snapshot}
              </span>
              <span>{item.line_total_mdl} MDL</span>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex justify-between border-t border-white/10 pt-3 font-bold text-white">
          <span>De încasat ({typedOrder.payment_method === "cash" ? "cash" : "card POS"})</span>
          <span className="text-gold">{typedOrder.total_mdl} MDL</span>
        </div>
      </section>

      <DeliveryStatusControls order={typedOrder} courierId={courier.id} />
    </main>
  );
}
