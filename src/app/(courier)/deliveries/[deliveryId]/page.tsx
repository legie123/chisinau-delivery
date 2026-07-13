import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DeliveryStatusControls } from "@/components/courier/DeliveryStatusControls";
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
    supabase.from("restaurants").select("name, address, phone").eq("id", typedOrder.restaurant_id).single(),
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
  const destinationText = typedAddress?.street_address ?? catering?.event_address_text ?? null;
  const mapsUrl = typedAddress?.lat
    ? `https://www.google.com/maps/dir/?api=1&destination=${typedAddress.lat},${typedAddress.lng}`
    : destinationText
      ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${destinationText}, Chișinău`)}`
      : null;

  return (
    <main className="flex-1 px-6 py-10">
      <h1 className="mb-6 text-2xl font-semibold">Livrare {typedOrder.order_number}</h1>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <section className="rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800">
          <h2 className="mb-2 font-medium">Ridicare</h2>
          <p>{restaurant?.name}</p>
          <p className="text-zinc-500">{restaurant?.address}</p>
          {restaurant?.phone && (
            <a href={`tel:${restaurant.phone}`} className="text-xs underline underline-offset-4">
              {restaurant.phone}
            </a>
          )}
        </section>
        <section className="rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800">
          <h2 className="mb-2 font-medium">Livrare</h2>
          {typedAddress ? (
            <>
              <p>{typedAddress.street_address}</p>
              <p className="text-zinc-500">
                {[typedAddress.building && `bloc ${typedAddress.building}`, typedAddress.apartment && `ap. ${typedAddress.apartment}`]
                  .filter(Boolean)
                  .join(", ")}
              </p>
              {typedAddress.notes && <p className="text-xs text-zinc-500">{typedAddress.notes}</p>}
              {mapsUrl && (
                <a href={mapsUrl} target="_blank" rel="noreferrer" className="text-xs underline underline-offset-4">
                  Deschide în Google Maps
                </a>
              )}
            </>
          ) : catering ? (
            <>
              <p>{catering.event_address_text}</p>
              <p className="text-zinc-500">
                Eveniment {catering.event_date}
                {catering.event_time ? ` · ${String(catering.event_time).slice(0, 5)}` : ""}
              </p>
              <p className="text-zinc-500">
                {catering.contact_person} ·{" "}
                <a href={`tel:${catering.contact_phone}`} className="underline underline-offset-4">
                  {catering.contact_phone}
                </a>
              </p>
              {mapsUrl && (
                <a href={mapsUrl} target="_blank" rel="noreferrer" className="text-xs underline underline-offset-4">
                  Deschide în Google Maps
                </a>
              )}
            </>
          ) : (
            <p className="text-zinc-500">Fără adresă atașată.</p>
          )}
        </section>
      </div>

      <ul className="mb-6 flex flex-col gap-1 text-sm">
        {((items ?? []) as OrderItem[]).map((item) => (
          <li key={item.id} className="flex justify-between">
            <span>
              {item.quantity}× {item.item_name_snapshot}
            </span>
            <span>{item.line_total_mdl} MDL</span>
          </li>
        ))}
        <li className="flex justify-between border-t border-zinc-200 pt-1 font-medium dark:border-zinc-800">
          <span>De încasat ({typedOrder.payment_method === "cash" ? "cash" : "card la livrare"})</span>
          <span>{typedOrder.total_mdl} MDL</span>
        </li>
      </ul>

      <DeliveryStatusControls order={typedOrder} courierId={courier.id} />
    </main>
  );
}
