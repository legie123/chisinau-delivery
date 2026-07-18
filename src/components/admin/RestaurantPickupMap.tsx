"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { subscribeTable } from "@/lib/realtime/subscribeTable";
import { useRoute } from "@/hooks/useRoute";
import { DeliveryMap, type MapPoint } from "@/components/shared/DeliveryMap";

// Restaurant-side pickup coordination: the assigned courier heading to the
// restaurant, live. RLS (courier_locations_partner_read) only exposes the courier
// while the order is courier_assigned, so this naturally clears after pickup.
export function RestaurantPickupMap({
  restaurant,
  courierId,
  courierName,
  initialCourier,
}: {
  restaurant: MapPoint;
  courierId: string;
  courierName: string | null;
  initialCourier: MapPoint | null;
}) {
  const [pos, setPos] = useState<MapPoint | null>(initialCourier);

  // Route the courier's approach to the restaurant. No courier fix yet → no route.
  const { line: routeLine, minutes } = useRoute(pos, restaurant);
  const etaLabel = pos && minutes != null ? `Curier la ridicare ~${minutes} min` : undefined;

  useEffect(() => {
    const supabase = createClient();
    const refetch = async () => {
      const { data } = await supabase
        .from("courier_locations")
        .select("lat, lng")
        .eq("courier_id", courierId)
        .maybeSingle();
      if (data?.lat != null && data?.lng != null) setPos({ lat: data.lat, lng: data.lng });
    };
    return subscribeTable(supabase, "rest-courier", "courier_locations", `courier_id=eq.${courierId}`, refetch);
  }, [courierId]);

  return (
    <section className="mb-5 flex flex-col gap-2 rounded-2xl bg-white/[0.04] p-4 ring-1 ring-white/[0.06]">
      <p className="text-sm font-semibold text-white">
        🛵 {courierName ?? "Curierul"} vine să ridice comanda
      </p>
      <DeliveryMap pickup={restaurant} courier={pos} routeLine={routeLine} etaLabel={etaLabel} heightClass="h-48" />
    </section>
  );
}
