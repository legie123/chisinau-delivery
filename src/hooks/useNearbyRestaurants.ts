"use client";

import { useEffect, useMemo, useState } from "react";
import { nearbyRestaurants } from "@chisinau/shared-api";
import type { Restaurant } from "@/lib/types/domain";

export type RestaurantWithDistance = Restaurant & { distance_m: number | null };

// WS3 — soft geolocation → nearby_restaurants RPC, merged onto the SSR fallback list.
// Fail-open: on denial/error/timeout the alphabetical fallback stays, nothing breaks.
// The display list is DERIVED during render from the fallback + a distance map, so no
// synchronous setState-in-effect (which would cascade renders) is needed.
export function useNearbyRestaurants(fallback: Restaurant[]) {
  const [dist, setDist] = useState<Record<string, number> | null>(null);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    let cancelled = false;
    const raf = requestAnimationFrame(() => setLocating(true)); // deferred → not sync-in-effect

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        if (cancelled) return;
        // Lazy: supabase-js only after a position arrives, not in /restaurants' first-load JS.
        // A failed chunk load is fail-open like a denied permission.
        let data: Awaited<ReturnType<typeof nearbyRestaurants>> | null = null;
        try {
          const { createClient } = await import("@/lib/supabase/client");
          data = await nearbyRestaurants(createClient(), pos.coords.latitude, pos.coords.longitude, 15, 50);
        } catch {
          data = null;
        }
        if (cancelled) return;
        setLocating(false);
        if (!data || data.length === 0) return;
        setDist(
          Object.fromEntries((data as { id: string; distance_m: number }[]).map((d) => [d.id, d.distance_m])),
        );
      },
      () => {
        if (!cancelled) setLocating(false); // denied / unavailable → keep fallback
      },
      { timeout: 5000, maximumAge: 60_000 },
    );

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, []);

  const restaurants = useMemo<RestaurantWithDistance[]>(() => {
    const merged = fallback.map((r) => ({ ...r, distance_m: dist?.[r.id] ?? null }));
    if (!dist) return merged;
    return merged.sort((a, b) => {
      if (a.distance_m == null && b.distance_m == null) return 0;
      if (a.distance_m == null) return 1;
      if (b.distance_m == null) return -1;
      return a.distance_m - b.distance_m;
    });
  }, [fallback, dist]);

  return { restaurants, locating, located: dist !== null };
}
