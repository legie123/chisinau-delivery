import { useEffect, useRef, useState } from "react";
import * as Location from "expo-location";
import { supabase } from "../lib/supabase";
import { broadcastCourierLocation } from "../lib/realtime/courierLocation";

const UPSERT_INTERVAL_MS = 45_000;
const BROADCAST_INTERVAL_MS = 10_000;

export interface DriverPosition {
  lat: number;
  lng: number;
}

// Courier-side live GPS tracking. Mirrors src/hooks/useBroadcastCourierLocation.ts
// on the web app: while `active`, watches the REAL device position and
// broadcasts it over Realtime (~10s ticks) + low-frequency UPSERTs to
// courier_locations (~45s) for last-known position. Permission denial surfaces
// as a Romanian error string instead of silently pretending tracking works.
export function useBroadcastCourierLocation(orderId: string | null, courierId: string | null, active: boolean) {
  const [position, setPosition] = useState<DriverPosition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastUpsertRef = useRef(0);

  useEffect(() => {
    if (!active || !orderId || !courierId) return;

    let subscription: Location.LocationSubscription | null = null;
    let cancelled = false;
    const broadcaster = broadcastCourierLocation(supabase, orderId);

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      if (status !== "granted") {
        setError("Permisiunea de localizare a fost refuzată — clientul nu îți vede poziția live.");
        return;
      }
      setError(null);

      subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: BROADCAST_INTERVAL_MS, distanceInterval: 0 },
        (loc) => {
          const point: DriverPosition = { lat: loc.coords.latitude, lng: loc.coords.longitude };
          setPosition(point);
          broadcaster.send(point);

          const now = Date.now();
          if (now - lastUpsertRef.current > UPSERT_INTERVAL_MS) {
            lastUpsertRef.current = now;
            supabase
              .from("courier_locations")
              // accuracy_m feeds the DB plausibility guard (WS3/WS10); the geo
              // column is generated server-side, so the upsert shape is otherwise
              // unchanged from the web app's.
              .upsert({ courier_id: courierId, lat: point.lat, lng: point.lng, accuracy_m: loc.coords.accuracy ?? null })
              .then(({ error: upsertError }) => {
                if (upsertError) {
                  // Retry on the next GPS tick instead of going stale for 45s.
                  lastUpsertRef.current = 0;
                  console.warn("[courier] last-known position upsert failed", upsertError.message);
                }
              });
          }
        },
      );
    })().catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : "Eroare la accesarea GPS-ului.");
    });

    return () => {
      cancelled = true;
      subscription?.remove();
      broadcaster.stop();
    };
  }, [orderId, courierId, active]);

  return { position, error };
}
