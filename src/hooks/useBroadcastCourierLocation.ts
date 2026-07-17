"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { broadcastCourierLocation } from "@/lib/realtime/courierLocation";

const UPSERT_INTERVAL_MS = 45_000;

// Courier-side: while `active`, watches GPS position and broadcasts every
// change over Realtime Broadcast (customer's map pin updates live), while
// separately UPSERTing courier_locations every ~45s so a customer whose page
// loads between broadcasts still sees a recent last-known position.
export function useBroadcastCourierLocation(orderId: string, courierId: string | null, active: boolean) {
  const [error, setError] = useState<string | null>(null);
  const lastUpsertRef = useRef(0);

  useEffect(() => {
    if (!active || !courierId || typeof navigator === "undefined" || !navigator.geolocation) return;

    const supabase = createClient();
    const broadcaster = broadcastCourierLocation(supabase, orderId);

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const point = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        broadcaster.send(point);

        const now = Date.now();
        if (now - lastUpsertRef.current > UPSERT_INTERVAL_MS) {
          lastUpsertRef.current = now;
          supabase
            .from("courier_locations")
            // WS3: accuracy_m feeds the DB plausibility guard; the geo column is
            // generated server-side, so the upsert shape is otherwise unchanged.
            .upsert({ courier_id: courierId, ...point, accuracy_m: pos.coords.accuracy })
            .then(({ error: upsertError }) => {
              if (upsertError) {
                // Retry on the next GPS tick instead of going stale for 45s.
                lastUpsertRef.current = 0;
                console.warn("[courier] last-known position upsert failed", upsertError.message);
              }
            });
        }
      },
      (err) => setError(err.message),
      { enableHighAccuracy: true, maximumAge: 10_000 },
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
      broadcaster.stop();
    };
  }, [orderId, courierId, active]);

  return { error };
}
