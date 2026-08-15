"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { declineVenueBooking, quoteVenueBooking } from "@chisinau/shared-api";
import { createClient } from "@/lib/supabase/client";

// Partenerul are exact două mișcări pe o cerere: pune un preț sau refuză cu
// motiv. Refuzul e reason-first, ca la anularea comenzii — clientul primește
// exact textul scris aici, nu un „nu" sec.
export function VenueBookingControl({ bookingId, status }: { bookingId: string; status: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "quote" | "decline">("idle");
  const [price, setPrice] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (["confirmed", "cancelled", "declined", "completed"].includes(status)) return null;

  function submit(action: "quote" | "decline") {
    setError(null);
    startTransition(async () => {
      try {
        const supabase = createClient();
        if (action === "quote") await quoteVenueBooking(supabase, bookingId, Number(price));
        else await declineVenueBooking(supabase, bookingId, reason.trim());
        setMode("idle");
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "A apărut o eroare.");
      }
    });
  }

  const field =
    "rounded-lg bg-white/5 px-3 py-1.5 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-gold/50";

  if (mode === "quote") {
    const value = Number(price);
    const invalid = !Number.isFinite(value) || value <= 0;
    return (
      <div className="mt-3 flex flex-col gap-2 rounded-xl bg-white/[0.04] p-3 ring-1 ring-gold/20">
        <label className="text-xs text-white/50" htmlFor={`price-${bookingId}`}>
          Prețul intervalului (MDL)
        </label>
        <input
          id={`price-${bookingId}`}
          type="number"
          inputMode="decimal"
          min={1}
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          className={`w-32 ${field}`}
        />
        {error && <p className="text-xs text-primary">{error}</p>}
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={pending || invalid}
            onClick={() => submit("quote")}
            className="rounded-full bg-gold px-4 py-1.5 text-xs font-bold text-zinc-900 transition hover:bg-gold-light disabled:opacity-40"
          >
            {pending ? "Se trimite…" : "Trimite oferta"}
          </button>
          <button type="button" onClick={() => setMode("idle")} className="text-xs text-white/40 underline underline-offset-2">
            Renunță
          </button>
        </div>
      </div>
    );
  }

  if (mode === "decline") {
    return (
      <div className="mt-3 flex flex-col gap-2 rounded-xl bg-primary/5 p-3 ring-1 ring-primary/25">
        <label className="text-xs text-white/60" htmlFor={`reason-${bookingId}`}>
          De ce nu se poate? Clientul primește exact acest motiv.
        </label>
        <input
          id={`reason-${bookingId}`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="ex. Sala e ocupată la ora aceea"
          className={field}
        />
        {error && <p className="text-xs text-primary">{error}</p>}
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={pending || reason.trim().length < 5}
            onClick={() => submit("decline")}
            className="rounded-full bg-primary-dark px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-primary-darker disabled:opacity-40"
          >
            {pending ? "Se trimite…" : "Refuză"}
          </button>
          <button type="button" onClick={() => setMode("idle")} className="text-xs text-white/40 underline underline-offset-2">
            Renunță
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={() => setMode("quote")}
        className="rounded-full bg-gold/15 px-4 py-1.5 text-xs font-semibold text-gold ring-1 ring-gold/30 transition hover:bg-gold/25"
      >
        {status === "quoted" ? "Schimbă prețul" : "Trimite ofertă"}
      </button>
      <button
        type="button"
        onClick={() => setMode("decline")}
        className="text-xs text-white/40 underline underline-offset-4 transition hover:text-primary"
      >
        Nu putem prelua
      </button>
    </div>
  );
}
