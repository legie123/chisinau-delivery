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
    let cancelled = false;

    supabase
      .from("courier_locations")
      .select("lat, lng, updated_at")
      .eq("courier_id", courierId)
      .maybeSingle()
      .then(({ data }) => {
        // Seed only fills the blank-map gap — never overwrite a fresher
        // broadcast position that may have arrived first. RLS returns only points
        // recorded since this order's pickup (20261004000800), so it can never be a
        // pin from a previous delivery or shift; a courier stopped in traffic keeps his.
        if (cancelled || !data) return;
        setPosition((p) => p ?? { lat: data.lat, lng: data.lng });
      });

    const unsubscribe = subscribeCourierLocation(supabase, orderId, setPosition);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [orderId, courierId, active]);

  return position;
}
