"use client";

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import type { Map as LeafletMap, Marker } from "leaflet";

type Pin = { lat: number; lng: number };
const CHISINAU: [number, number] = [47.0245, 28.8322];
const round6 = (n: number) => Number(n.toFixed(6));

// The delivery pin (C1): place_order refuses an address without one. Click the map or drag the pin
// to the door; "Folosește locația mea" jumps to the browser's GPS. Same rule as the mobile PinPicker.
export function PinPickerMap({ value, onChange }: { value: Pin | null; onChange: (p: Pin) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const marker = useRef<Marker | null>(null);
  const leaflet = useRef<typeof import("leaflet") | null>(null);
  const onChangeRef = useRef(onChange);
  const [locating, setLocating] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const L = await import("leaflet");
      if (cancelled || !box.current || map.current) return;
      leaflet.current = L;
      const m = L.map(box.current, { zoomControl: true, attributionControl: true });
      // OSM standard tiles: CARTO basemaps now answer every request with an "API KEY REQUIRED"
      // image (HTTP 200), so the customer saw no streets to pin on. Attribution is mandatory.
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "© OpenStreetMap",
      }).addTo(m);
      m.setView(value ? [value.lat, value.lng] : CHISINAU, value ? 17 : 12);
      m.on("click", (e) => onChangeRef.current({ lat: round6(e.latlng.lat), lng: round6(e.latlng.lng) }));
      map.current = m;
    })();
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      marker.current = null;
    };
    // init once; the marker follows `value` below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const L = leaflet.current;
    const m = map.current;
    if (!L || !m || !value) return;
    if (!marker.current) {
      const icon = L.divIcon({
        className: "",
        html: '<div style="font-size:30px;line-height:30px;transform:translate(-2px,-26px)">📍</div>',
        iconSize: [30, 30],
        iconAnchor: [15, 4],
      });
      marker.current = L.marker([value.lat, value.lng], { draggable: true, icon }).addTo(m);
      marker.current.on("dragend", () => {
        const p = marker.current!.getLatLng();
        onChangeRef.current({ lat: round6(p.lat), lng: round6(p.lng) });
      });
    } else {
      marker.current.setLatLng([value.lat, value.lng]);
    }
  }, [value]);

  function useMyLocation() {
    setGpsError(null);
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGpsError("Locația nu este disponibilă pe acest dispozitiv — atinge harta.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const p = { lat: round6(pos.coords.latitude), lng: round6(pos.coords.longitude) };
        onChangeRef.current(p);
        map.current?.setView([p.lat, p.lng], 17);
      },
      () => {
        setLocating(false);
        setGpsError("Nu am putut obține locația — fixează pinul atingând harta.");
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div ref={box} className="h-56 w-full overflow-hidden rounded-xl ring-1 ring-white/10" aria-label="Harta pentru pinul de livrare" />
      <div className="flex items-center justify-between gap-2">
        <p className={`text-xs ${value ? "text-white/50" : "font-semibold text-gold"}`}>
          {value ? "Pin fixat ✓ — trage-l exact la intrare" : "Atinge harta unde e intrarea (obligatoriu)"}
        </p>
        <button
          type="button"
          onClick={useMyLocation}
          disabled={locating}
          className="shrink-0 rounded-xl bg-white/5 px-3 py-2 text-xs text-white/80 ring-1 ring-white/10 transition hover:bg-white/10 disabled:opacity-50"
        >
          {locating ? "Te localizăm…" : "📍 Locația mea"}
        </button>
      </div>
      {gpsError && <p className="text-xs text-primary">{gpsError}</p>}
    </div>
  );
}
