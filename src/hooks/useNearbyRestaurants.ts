"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
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
        const supabase = createClient();
        const { data, error } = await supabase.rpc("nearby_restaurants", {
          p_lat: pos.coords.latitude,
          p_lng: pos.coords.longitude,
          p_radius_km: 15,
          p_limit: 50,
        });
        if (cancelled) return;
        setLocating(false);
        if (error || !data) return;
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
