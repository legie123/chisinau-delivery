"use client";

import { useEffect, useState } from "react";
import { useRoute } from "@/hooks/useRoute";
import { DeliveryMap, type MapPoint } from "@/components/shared/DeliveryMap";
import { NavigateButton } from "@/components/shared/NavigateButton";
import type { OrderStatus } from "@/lib/types/domain";

// Courier's live route view: pickup (restaurant) + dropoff (customer) + the
// courier's OWN device position, watched here. Draws the real road route and a
// travel-time ETA toward the current leg — the restaurant before pickup, the
// customer after — plus one-tap navigation to each stop. Renders nothing until
// there's at least one point to show.
export function CourierRouteMap({
  pickup,
  dropoff,
  status,
}: {
  pickup: MapPoint | null;
  dropoff: MapPoint | null;
  status: OrderStatus;
}) {
  const [me, setMe] = useState<MapPoint | null>(null);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (pos) => setMe({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {}, // denial/unavailable → map just omits the courier marker + route
      { enableHighAccuracy: true, maximumAge: 10_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  // Once the food is picked up the active leg is toward the customer; before
  // that, toward the restaurant.
  const pickedUp = status === "picked_up" || status === "en_route" || status === "delivered";
  const target = pickedUp ? dropoff : pickup;
  const { line: routeLine, minutes } = useRoute(me, target);
  const etaLabel =
    minutes == null || !me
      ? undefined
      : pickedUp
        ? `Sosire ~${minutes} min`
        : `Ridicare ~${minutes} min`;

  if (!pickup && !dropoff && !me) return null;

  return (
    <section className="mb-4 flex flex-col gap-2">
      <DeliveryMap
        pickup={pickup}
        dropoff={dropoff}
        courier={me}
        routeLine={routeLine}
        etaLabel={etaLabel}
        heightClass="h-56"
      />
      <div className="flex gap-2">
        {pickup && <NavigateButton lat={pickup.lat} lng={pickup.lng} label="🏪 Spre restaurant" className="flex-1" />}
        {dropoff && <NavigateButton lat={dropoff.lat} lng={dropoff.lng} label="📍 Spre client" className="flex-1" />}
      </div>
    </section>
  );
}
