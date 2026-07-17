"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";
import type { Map as LeafletMap, Marker } from "leaflet";

export type MapPoint = { lat: number; lng: number };

// Chișinău center — fallback when we have no points yet.
const CHISINAU: [number, number] = [47.0245, 28.8322];

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
// courier's LIVE position. Vanilla Leaflet, imported dynamically so it never runs
// during SSR. The courier marker moves in place as the `courier` prop updates.
export function DeliveryMap({
  pickup,
  dropoff,
  courier,
  heightClass = "h-64",
}: {
  pickup?: MapPoint | null;
  dropoff?: MapPoint | null;
  courier?: MapPoint | null;
  heightClass?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const courierMarkerRef = useRef<Marker | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);

  // Init once.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const L = await import("leaflet");
      if (cancelled || !containerRef.current || mapRef.current) return;
      leafletRef.current = L;

      const map = L.map(containerRef.current, { zoomControl: false, attributionControl: false });
      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        subdomains: "abcd",
        maxZoom: 19,
      }).addTo(map);
      mapRef.current = map;

      const bounds: [number, number][] = [];
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
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        courierMarkerRef.current = null;
      }
    };
    // Init with the first props; live movement is handled by the effect below.
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
    if (courierMarkerRef.current) {
      courierMarkerRef.current.setLatLng([cLat, cLng]);
    } else {
      courierMarkerRef.current = L.marker([cLat, cLng], { icon: pin(L, "🛵", "#34d399") }).addTo(map);
    }
  }, [cLat, cLng]);

  return <div ref={containerRef} className={`z-0 w-full overflow-hidden rounded-2xl ring-1 ring-white/10 ${heightClass}`} />;
}
