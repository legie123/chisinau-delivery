"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { broadcastCourierLocation } from "@/lib/realtime/courierLocation";
import { trailingThrottle } from "@/lib/realtime/trailingThrottle";

const UPSERT_INTERVAL_MS = 45_000;
// One broadcast per 10s is plenty for a map pin; per-fix sends (~1/s) burn battery + Realtime quota.
const BROADCAST_INTERVAL_MS = 10_000;

// What the courier's GPS feeds, by order status — the same split as the courier app (gpsGate):
// heading to pickup only the 45s courier_locations upsert, which RLS shows to the restaurant alone
// (its pickup map); from pickup also the live broadcast to the customer. The customer never sees
// the courier before pickup. The web used to send nothing before pickup (verifier, 2026-10-04).
export type CourierGpsMode = "broadcast" | "upsert" | null;

export function courierGpsMode(status: string): CourierGpsMode {
  if (status === "picked_up" || status === "en_route") return "broadcast";
  if (status === "courier_assigned") return "upsert";
  return null;
}

// Courier-side: while `mode` is set, watches GPS position. "broadcast" sends every change over
// Realtime Broadcast (customer's map pin updates live); both modes UPSERT courier_locations every
// ~45s, so a page that loads between broadcasts still sees a recent last-known position.
export function useBroadcastCourierLocation(orderId: string, courierId: string | null, mode: CourierGpsMode) {
  const [error, setError] = useState<string | null>(null);
  const lastUpsertRef = useRef(0);

  useEffect(() => {
    if (!mode || !courierId || typeof navigator === "undefined" || !navigator.geolocation) return;

    const supabase = createClient();
    const broadcaster = mode === "broadcast" ? broadcastCourierLocation(supabase, orderId) : null;

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
    const broadcast = broadcaster ? trailingThrottle(broadcaster.send, BROADCAST_INTERVAL_MS) : null;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const point = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        const now = Date.now();
        broadcast?.push(point);

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
      broadcast?.cancel();
      navigator.geolocation.clearWatch(watchId);
      document.removeEventListener("visibilitychange", onVisible);
      wakeLock?.release().catch(() => {});
      broadcaster?.stop();
    };
  }, [orderId, courierId, mode]);

  return { error };
}
