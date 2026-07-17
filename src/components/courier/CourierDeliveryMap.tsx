"use client";

import { useEffect, useState } from "react";
import { DeliveryMap, type MapPoint } from "@/components/shared/DeliveryMap";
import { NavigateButton } from "@/components/shared/NavigateButton";

// Courier's live route view: pickup (restaurant) + dropoff (customer) + the
// courier's OWN device position, watched directly here. Plus one-tap navigation
// to each stop. Renders nothing until there's at least one point to show.
export function CourierDeliveryMap({ pickup, dropoff }: { pickup: MapPoint | null; dropoff: MapPoint | null }) {
  const [me, setMe] = useState<MapPoint | null>(null);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (pos) => setMe({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {}, // denial/unavailable → map just omits the courier marker
      { enableHighAccuracy: true, maximumAge: 10_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  if (!pickup && !dropoff && !me) return null;

  return (
    <section className="mb-4 flex flex-col gap-2">
      <DeliveryMap pickup={pickup} dropoff={dropoff} courier={me} heightClass="h-56" />
      <div className="flex gap-2">
        {pickup && <NavigateButton lat={pickup.lat} lng={pickup.lng} label="🏪 Spre restaurant" className="flex-1" />}
        {dropoff && <NavigateButton lat={dropoff.lat} lng={dropoff.lng} label="📍 Spre client" className="flex-1" />}
      </div>
    </section>
  );
}
