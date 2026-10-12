"use client";

import { useState, useTransition } from "react";
import { confirmRestaurantPin } from "@/app/(admin)/restaurant/hours/actions";

const fmt = new Intl.DateTimeFormat("ro-RO", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Chisinau" });

// The courier navigates to this pin and is paid on the distance from it, so the partner
// confirms it is the pickup door. Required before the restaurant is activated (rule A).
export function PinConfirmCard({ lat, lng, confirmedAt }: { lat: number | null; lng: number | null; confirmedAt: string | null }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (lat == null || lng == null) {
    return (
      <p className="text-sm text-amber-200">
        Localul nu are încă pin pe hartă. Echipa Dragons îl fixează la înscriere; după aceea îl confirmi aici.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-white">Pinul de ridicare</span>
        <span className={confirmedAt ? "text-emerald-300" : "text-amber-200"}>
          {confirmedAt ? `Confirmat ${fmt.format(new Date(confirmedAt))}` : "Neconfirmat — necesar pentru activare"}
        </span>
      </div>
      <p className="text-white/60">
        Curierul vine exact la acest punct și e plătit pe distanța de aici. Verifică pe hartă că e ușa pe unde predai
        comenzile.{" "}
        <a
          href={`https://www.google.com/maps?q=${lat},${lng}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-gold underline"
        >
          Deschide pe hartă ({lat.toFixed(5)}, {lng.toFixed(5)})
        </a>
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const r = await confirmRestaurantPin();
              setError(r.error);
            })
          }
          className="pg-cta min-h-11 rounded-full px-5 text-sm disabled:opacity-50"
        >
          {confirmedAt ? "Confirmă din nou" : "Da, aici e ușa de ridicare"}
        </button>
        <span className="text-xs text-white/45">Dacă pinul e greșit, scrie echipei Dragons — doar ei îl pot muta.</span>
      </div>
      {error && <p className="text-xs text-primary">{error}</p>}
    </div>
  );
}
