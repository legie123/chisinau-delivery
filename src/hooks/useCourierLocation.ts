"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { subscribeCourierLocation, type LatLng } from "@/lib/realtime/courierLocation";

// Live courier position for the customer tracking page. Seeds from the last
// UPSERTed courier_locations row (so a fresh page load isn't blank before the
// next broadcast tick), then follows the high-frequency broadcast channel.
export function useCourierLocation(orderId: string, courierId: string | null, active: boolean) {
  const [position, setPosition] = useState<LatLng | null>(null);

  useEffect(() => {
    if (!active || !courierId) return;
    const supabase = createClient();

    supabase
      .from("courier_locations")
      .select("lat, lng")
      .eq("courier_id", courierId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setPosition({ lat: data.lat, lng: data.lng });
      });

    return subscribeCourierLocation(supabase, orderId, setPosition);
  }, [orderId, courierId, active]);

  return position;
}
