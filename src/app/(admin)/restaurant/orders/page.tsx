import { createClient } from "@/lib/supabase/server";
import { OrderQueueRow } from "@/components/admin/OrderQueueRow";
import { OrderQueueLive } from "@/components/admin/OrderQueueLive";
import { RestaurantPickupMap } from "@/components/admin/RestaurantPickupMap";
import type { Order, PrepEstimate } from "@/lib/types/domain";

const QUEUE_STATUSES = ["pending_restaurant", "accepted", "ready_for_pickup", "courier_assigned", "picked_up", "en_route"];

export default async function RestaurantOrdersPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: staffRow } = await supabase
    .from("restaurant_staff")
    .select("restaurant_id, restaurants(accept_sla_minutes, lat, lng)")
    .eq("user_id", user?.id ?? "")
    .maybeSingle();

  // restaurant_staff.restaurant_id -> restaurants is a to-ONE FK, so PostgREST
  // embeds an object, not an array.
  const rest = staffRow?.restaurants as unknown as { accept_sla_minutes: number; lat: number | null; lng: number | null } | null;
  const acceptSlaMinutes = rest?.accept_sla_minutes ?? 7;
  const restaurantPoint = rest?.lat != null && rest?.lng != null ? { lat: rest.lat, lng: rest.lng } : null;

  // WS4 — the restaurant's own live prep estimate (drives the kitchen header chip).
  let prepEstimate: PrepEstimate | null = null;
  if (staffRow?.restaurant_id) {
    const { data: prepRows } = await supabase.rpc("get_prep_estimates", {
      p_restaurant_ids: [staffRow.restaurant_id],
    });
    prepEstimate = ((prepRows ?? []) as PrepEstimate[])[0] ?? null;
  }

  // RLS (orders_partner_scope) already restricts this to the caller's own
  // restaurant. Catering orders are excluded — accepting one here would skip
  // the quote flow entirely; they live in /restaurant/catering.
  const { data: orders } = await supabase
    .from("orders")
    .select("*")
    .eq("order_type", "standard")
    .in("status", QUEUE_STATUSES)
    .order("created_at");

  const orderList = (orders ?? []) as Order[];
  const pendingCount = orderList.filter((o) => o.status === "pending_restaurant").length;

  // Pickup coordination: a courier assigned to one of our orders is heading here.
  const assigned = orderList.find((o) => o.status === "courier_assigned" && o.courier_id);
  let pickupCourier: { id: string; name: string | null; pos: { lat: number; lng: number } | null } | null = null;
  if (assigned?.courier_id && restaurantPoint) {
    const [{ data: cl }, { data: c }] = await Promise.all([
      supabase.from("courier_locations").select("lat, lng").eq("courier_id", assigned.courier_id).maybeSingle(),
      supabase.from("couriers").select("full_name").eq("id", assigned.courier_id).maybeSingle(),
    ]);
    pickupCourier = {
      id: assigned.courier_id,
      name: (c as { full_name: string } | null)?.full_name ?? null,
      pos: cl?.lat != null && cl?.lng != null ? { lat: cl.lat, lng: cl.lng } : null,
    };
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 pb-16 pt-6">
      {staffRow && <OrderQueueLive restaurantId={staffRow.restaurant_id} pendingCount={pendingCount} />}
      {restaurantPoint && pickupCourier && (
        <RestaurantPickupMap
          restaurant={restaurantPoint}
          courierId={pickupCourier.id}
          courierName={pickupCourier.name}
          initialCourier={pickupCourier.pos}
        />
      )}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-white">Comenzi</h1>
        {prepEstimate && (
          <span className="rounded-full bg-white/5 px-3 py-1.5 text-xs font-medium text-white/70 ring-1 ring-white/10">
            ⏱ Timp de pregătire estimat:{" "}
            <span className="font-semibold text-white">~{prepEstimate.prep_minutes} min</span>
            <span className="ml-1 text-white/40">
              {prepEstimate.source === "static"
                ? "(valoare implicită)"
                : prepEstimate.source === "hourly"
                  ? "(medie pentru ora curentă)"
                  : "(medie ultimele 28 zile)"}
            </span>
          </span>
        )}
      </div>
      {orderList.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl bg-white/[0.04] py-14 text-center ring-1 ring-white/[0.06]">
          <span className="text-5xl" aria-hidden>🍱</span>
          <p className="text-white/60">Nicio comandă activă — cele noi apar aici instant.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {orderList.map((order) => (
            <OrderQueueRow key={order.id} order={order} acceptSlaMinutes={acceptSlaMinutes} />
          ))}
        </ul>
      )}
    </main>
  );
}
