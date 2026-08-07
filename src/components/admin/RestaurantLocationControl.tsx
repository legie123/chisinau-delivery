"use client";

import { useState, useTransition } from "react";
import { setRestaurantLocation } from "@/app/(admin)/platform/restaurants/actions";

// Admin control to set a restaurant's real coordinates — geocode from the stored
// address (Nominatim) or paste lat/lng from Google Maps. Restaurants onboarded via
// self-signup land with NULL coords; without this, dispatch/ETA use a 6 km fallback
// and an operator would need SQL. Missing coords are flagged so they can't slip live.
export function RestaurantLocationControl({
  restaurantId,
  lat,
  lng,
}: {
  restaurantId: string;
  lat: number | null;
  lng: number | null;
}) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [manual, setManual] = useState(false);
  const [latIn, setLatIn] = useState(lat != null ? String(lat) : "");
  const [lngIn, setLngIn] = useState(lng != null ? String(lng) : "");
  const has = lat != null && lng != null;

  function geocode() {
    setMsg(null);
    startTransition(async () => {
      const r = await setRestaurantLocation(restaurantId);
      setMsg({ text: r.error ?? r.notice ?? "Gata.", ok: !r.error });
    });
  }

  function saveManual() {
    setMsg(null);
    const la = Number(latIn);
    const ln = Number(lngIn);
    if (!Number.isFinite(la) || !Number.isFinite(ln)) {
      setMsg({ text: "Lat/lng invalide.", ok: false });
      return;
    }
    startTransition(async () => {
      const r = await setRestaurantLocation(restaurantId, { lat: la, lng: ln });
      setMsg({ text: r.error ?? r.notice ?? "Gata.", ok: !r.error });
    });
  }

  return (
    <div className="flex flex-col gap-1 text-xs">
      <span className={has ? "text-white/70" : "font-medium text-amber-300"}>
        {has ? `${lat!.toFixed(4)}, ${lng!.toFixed(4)}` : "⚠ lipsă — dispatch pe 6 km"}
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={geocode}
          disabled={pending}
          className="rounded-full bg-white/10 px-2.5 py-0.5 text-white/70 transition hover:text-white disabled:opacity-50"
        >
          {pending ? "…" : "Geolocalizează"}
        </button>
        <button type="button" onClick={() => setManual((m) => !m)} className="text-white/40 underline underline-offset-2">
          manual
        </button>
      </div>
      {manual && (
        <div className="flex items-center gap-1">
          <input
            value={latIn}
            onChange={(e) => setLatIn(e.target.value)}
            placeholder="lat"
            className="w-20 rounded bg-white/5 px-1.5 py-0.5 text-white ring-1 ring-white/10 outline-none focus:ring-gold/50"
          />
          <input
            value={lngIn}
            onChange={(e) => setLngIn(e.target.value)}
            placeholder="lng"
            className="w-20 rounded bg-white/5 px-1.5 py-0.5 text-white ring-1 ring-white/10 outline-none focus:ring-gold/50"
          />
          <button
            type="button"
            onClick={saveManual}
            disabled={pending}
            className="rounded-full bg-gold/20 px-2.5 py-0.5 text-gold transition hover:bg-gold/30 disabled:opacity-50"
          >
            Salvează
          </button>
        </div>
      )}
      {msg && <span className={msg.ok ? "text-emerald-400" : "text-red-400"}>{msg.text}</span>}
    </div>
  );
}
