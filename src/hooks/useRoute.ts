"use client";

import { useEffect, useRef, useState } from "react";
import { haversineM, straightLineFallback, type RoutePoint, type RouteResult } from "@/lib/routing/route";

export type UseRouteResult = {
  line: [number, number][];
  minutes: number | null;
  km: number | null;
  source: RouteResult["source"] | null;
  loading: boolean;
};

type State = {
  line: [number, number][];
  durationSec: number | null;
  distanceM: number | null;
  source: RouteResult["source"] | null;
  loading: boolean;
};

const EMPTY: State = { line: [], durationSec: null, distanceM: null, source: null, loading: false };

// Only refetch once an endpoint has drifted this far from the last-fetched
// position. Critical: a live-moving courier ticks every ~10s, and without this
// every tick would hammer /api/route (and OSRM behind it).
const REFETCH_MOVE_M = 150;

// Fetches a real road route (via /api/route → OSRM) for a from→to pair, with a
// client-side straight-line fallback so the UI always has something to draw.
// The previous line is kept while a refetch is in flight (no empty flash).
export function useRoute(
  from: RoutePoint | null | undefined,
  to: RoutePoint | null | undefined,
): UseRouteResult {
  const [state, setState] = useState<State>(EMPTY);
  const lastFetchedRef = useRef<{ from: RoutePoint; to: RoutePoint } | null>(null);

  // Depend on primitives so an equal-value object identity change doesn't refetch.
  const fLat = from?.lat;
  const fLng = from?.lng;
  const tLat = to?.lat;
  const tLng = to?.lng;

  useEffect(() => {
    if (fLat == null || fLng == null || tLat == null || tLng == null) return;
    const fromPt: RoutePoint = { lat: fLat, lng: fLng };
    const toPt: RoutePoint = { lat: tLat, lng: tLng };

    // Debounce by movement: skip unless this is the first fetch or an endpoint
    // has moved more than REFETCH_MOVE_M since we last fetched.
    const last = lastFetchedRef.current;
    const moved =
      !last || haversineM(fromPt, last.from) > REFETCH_MOVE_M || haversineM(toPt, last.to) > REFETCH_MOVE_M;
    if (!moved) return;
    lastFetchedRef.current = { from: fromPt, to: toPt };

    let cancelled = false;
    let raf = 0;
    // Defer state updates out of the effect/async path (rAF) so the react
    // compiler doesn't flag cascading setState — same pattern as PushOptIn.
    const apply = (next: Partial<State>) => {
      raf = requestAnimationFrame(() => {
        if (!cancelled) setState((s) => ({ ...s, ...next }));
      });
    };

    apply({ loading: true }); // keep existing line visible while we refetch

    void (async () => {
      try {
        const res = await fetch(`/api/route?from=${fLat},${fLng}&to=${tLat},${tLng}`);
        if (!res.ok) throw new Error(`route ${res.status}`);
        const data = (await res.json()) as RouteResult;
        if (cancelled) return;
        apply({
          line: data.line,
          durationSec: data.durationSec,
          distanceM: data.distanceM,
          source: data.source,
          loading: false,
        });
      } catch {
        // Network/endpoint failure → synthesize a straight line so the map still
        // shows a route and a rough ETA rather than nothing.
        if (cancelled) return;
        const fb = straightLineFallback(fromPt, toPt);
        apply({
          line: fb.line,
          durationSec: fb.durationSec,
          distanceM: fb.distanceM,
          source: fb.source,
          loading: false,
        });
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [fLat, fLng, tLat, tLng]);

  return {
    line: state.line,
    minutes: state.durationSec == null ? null : Math.round(state.durationSec / 60),
    km: state.distanceM == null ? null : state.distanceM / 1000,
    source: state.source,
    loading: state.loading,
  };
}
