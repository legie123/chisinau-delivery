"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import type { Map as LeafletMap, Marker, Polyline } from "leaflet";

export type MapPoint = { lat: number; lng: number };

// Chișinău center — fallback when we have no points yet.
const CHISINAU: [number, number] = [47.0245, 28.8322];

// Road route polyline styling — gold, matching the Dragons theme.
const ROUTE_STYLE = { color: "#f5a623", weight: 4, opacity: 0.7 } as const;

// Emoji pin as a Leaflet divIcon (avoids the classic webpack marker-image path
// break, and matches the Dragons dark/gold theme better than default markers).
function pin(L: typeof import("leaflet"), emoji: string, ring: string) {
  return L.divIcon({
    className: "",
    html: `<div style="display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:9999px;background:#0d0d1f;border:2px solid ${ring};box-shadow:0 2px 8px rgba(0,0,0,.5);font-size:17px">${emoji}</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

// Real interactive map: pickup (restaurant), dropoff (customer address), and the
// courier's LIVE position. Optionally draws a road route polyline and an ETA
// chip. Vanilla Leaflet, imported dynamically so it never runs during SSR. The
// courier marker and the route polyline both move in place as their props update.
export function DeliveryMap({
  pickup,
  dropoff,
  courier,
  routeLine,
  etaLabel,
  heightClass = "h-64",
}: {
  pickup?: MapPoint | null;
  dropoff?: MapPoint | null;
  courier?: MapPoint | null;
  routeLine?: [number, number][];
  etaLabel?: string;
  heightClass?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const courierMarkerRef = useRef<Marker | null>(null);
  const routeLineRef = useRef<Polyline | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const moveAnimRef = useRef<number | null>(null);

  // Init once.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const L = await import("leaflet");
      if (cancelled || !containerRef.current || mapRef.current) return;
      leafletRef.current = L;

      const map = L.map(containerRef.current, { zoomControl: false, attributionControl: true });
      // OSM standard tiles: CARTO basemaps now answer every request with an "API KEY REQUIRED"
      // image (HTTP 200), so the maps showed no streets. Attribution is mandatory.
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "© OpenStreetMap",
      }).addTo(map);
      mapRef.current = map;

      const bounds: [number, number][] = [];
      // Draw the route first so the pins render above it.
      if (routeLine && routeLine.length > 1) {
        routeLineRef.current = L.polyline(routeLine, ROUTE_STYLE).addTo(map);
        for (const pt of routeLine) bounds.push(pt);
      }
      if (pickup) {
        L.marker([pickup.lat, pickup.lng], { icon: pin(L, "🏪", "#f5a623") }).addTo(map);
        bounds.push([pickup.lat, pickup.lng]);
      }
      if (dropoff) {
        L.marker([dropoff.lat, dropoff.lng], { icon: pin(L, "📍", "#e94560") }).addTo(map);
        bounds.push([dropoff.lat, dropoff.lng]);
      }
      if (courier) {
        courierMarkerRef.current = L.marker([courier.lat, courier.lng], { icon: pin(L, "🛵", "#34d399") }).addTo(map);
        bounds.push([courier.lat, courier.lng]);
      }

      if (bounds.length > 1) map.fitBounds(bounds, { padding: [42, 42], maxZoom: 16 });
      else if (bounds.length === 1) map.setView(bounds[0], 15);
      else map.setView(CHISINAU, 12);
    })();

    return () => {
      cancelled = true;
      if (moveAnimRef.current) cancelAnimationFrame(moveAnimRef.current);
      moveAnimRef.current = null;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        courierMarkerRef.current = null;
        routeLineRef.current = null;
      }
    };
    // Init with the first props; live movement is handled by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live courier movement: move the existing marker (or create it) without
  // re-initialising the map. Depend on the primitives only, so an equal-value
  // object identity change doesn't re-run it.
  const cLat = courier?.lat;
  const cLng = courier?.lng;
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map || cLat == null || cLng == null) return;

    // First fix: just place the marker.
    if (!courierMarkerRef.current) {
      courierMarkerRef.current = L.marker([cLat, cLng], { icon: pin(L, "🛵", "#34d399") }).addTo(map);
      return;
    }

    const marker = courierMarkerRef.current;
    const from = marker.getLatLng();
    const dLat = cLat - from.lat;
    const dLng = cLng - from.lng;

    // GPS ticks arrive ~every 10s. Snapping setLatLng() made the courier visibly
    // teleport each tick (audit #12). Glide from the last position to the new one
    // so it reads as movement — unless the user prefers reduced motion, or the move
    // is negligible/huge (jitter or a re-anchor), in which case snap.
    const reduce =
      typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const tiny = Math.abs(dLat) < 1e-6 && Math.abs(dLng) < 1e-6;
    if (reduce || tiny) {
      if (moveAnimRef.current) cancelAnimationFrame(moveAnimRef.current);
      moveAnimRef.current = null;
      marker.setLatLng([cLat, cLng]);
      return;
    }

    if (moveAnimRef.current) cancelAnimationFrame(moveAnimRef.current);
    const fromLat = from.lat;
    const fromLng = from.lng;
    const DURATION = 1200; // ms — smooth glide, completes well before the next tick
    const easeOutCubic = (p: number) => 1 - Math.pow(1 - p, 3);
    let t0: number | null = null;
    const step = (ts: number) => {
      if (t0 == null) t0 = ts;
      const p = Math.min((ts - t0) / DURATION, 1);
      const e = easeOutCubic(p);
      marker.setLatLng([fromLat + dLat * e, fromLng + dLng * e]);
      if (p < 1) {
        moveAnimRef.current = requestAnimationFrame(step);
      } else {
        moveAnimRef.current = null;
      }
    };
    moveAnimRef.current = requestAnimationFrame(step);
  }, [cLat, cLng]);

  // Live route re-draw: update the polyline in place when the route changes,
  // without re-initialising the map. Keyed on a stable serialization (length +
  // endpoints) rather than the array identity, which churns every render.
  const routeKey =
    routeLine && routeLine.length > 1
      ? `${routeLine.length}:${routeLine[0][0]},${routeLine[0][1]}:${routeLine[routeLine.length - 1][0]},${routeLine[routeLine.length - 1][1]}`
      : "";
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map || !routeLine || routeLine.length < 2) return;
    if (routeLineRef.current) {
      routeLineRef.current.setLatLngs(routeLine);
    } else {
      routeLineRef.current = L.polyline(routeLine, ROUTE_STYLE).addTo(map);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey]);

  return (
    <div className="relative">
      <div
        ref={containerRef}
        role="img"
        aria-label="Hartă live cu poziția curierului, punctul de ridicare și adresa de livrare"
        className={`z-0 w-full overflow-hidden rounded-2xl ring-1 ring-white/10 ${heightClass}`}
      />
      {etaLabel && (
        <div className="pointer-events-none absolute bottom-2 left-2 z-10 rounded-full bg-[#0d0d1f] px-3 py-1 text-xs font-semibold text-[#f5a623] shadow ring-1 ring-white/10">
          {etaLabel}
        </div>
      )}
    </div>
  );
}
