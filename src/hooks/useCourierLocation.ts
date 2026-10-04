"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { subscribeCourierLocation, type LatLng } from "@/lib/realtime/courierLocation";

// Live courier position for the customer tracking page. Seeds from the last
// UPSERTed courier_locations row (so a fresh page load isn't blank before the
// next broadcast tick), then follows the high-frequency broadcast channel.
const FRESH_MS = 120_000;

export function useCourierLocation(orderId: string, courierId: string | null, active: boolean) {
  const [position, setPosition] = useState<LatLng | null>(null);
  // When the last real point arrived: the pin expires 2 min after it (a courier whose GPS
  // stopped used to stay frozen on the map, looking live), like the RLS bound on the seed.
  const [seenAt, setSeenAt] = useState<number | null>(null);

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
        // broadcast position that may have arrived first. WS3: mirror the 2-min
        // DB TTL so a customer never sees a pin from a previous shift.
        if (cancelled || !data) return;
        const at = Date.parse(data.updated_at);
        if (Date.now() - at >= FRESH_MS) return;
        setPosition((p) => p ?? { lat: data.lat, lng: data.lng });
        setSeenAt((t) => t ?? at);
      });

    const unsubscribe = subscribeCourierLocation(supabase, orderId, (p) => {
      setPosition(p);
      setSeenAt(Date.now());
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [orderId, courierId, active]);

  useEffect(() => {
    if (seenAt == null) return;
    const id = setTimeout(() => setPosition(null), Math.max(0, seenAt + FRESH_MS - Date.now()));
    return () => clearTimeout(id);
  }, [seenAt]);

  return position;
}
