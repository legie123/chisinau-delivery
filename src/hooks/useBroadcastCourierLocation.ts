"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { broadcastCourierLocation } from "@/lib/realtime/courierLocation";
import { trailingThrottle } from "@/lib/realtime/trailingThrottle";

const UPSERT_INTERVAL_MS = 45_000;
// One broadcast per 10s is plenty for a map pin; per-fix sends (~1/s) burn battery + Realtime quota.
const BROADCAST_INTERVAL_MS = 10_000;

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

    // Keep the screen on during a delivery: a locked screen suspends the page and freezes the pin.
    // Wake locks are released by the browser when the tab hides, so re-acquire on return.
    // A sentinel can resolve AFTER cleanup (fast unmount, StrictMode double-mount): release it
    // there, or it is held by a dead closure and the screen never sleeps again.
    let disposed = false;
    let wakeLock: WakeLockSentinel | null = null;
    const acquireWakeLock = () => {
      navigator.wakeLock
        ?.request("screen")
        .then((l) => {
          if (disposed) return void l.release().catch(() => {});
          void wakeLock?.release().catch(() => {});
          wakeLock = l;
        })
        .catch(() => {});
    };
    const onVisible = () => { if (document.visibilityState === "visible") acquireWakeLock(); };
    acquireWakeLock();
    document.addEventListener("visibilitychange", onVisible);

    // Scoped to this effect, so a new order never inherits the previous one's window.
    const broadcast = trailingThrottle(broadcaster.send, BROADCAST_INTERVAL_MS);

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const point = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        const now = Date.now();
        broadcast.push(point);

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
      disposed = true;
      broadcast.cancel();
      navigator.geolocation.clearWatch(watchId);
      document.removeEventListener("visibilitychange", onVisible);
      wakeLock?.release().catch(() => {});
      broadcaster.stop();
    };
  }, [orderId, courierId, active]);

  return { error };
}
