"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelVenueBooking, confirmVenueBooking, RpcError } from "@chisinau/shared-api";
import { createClient } from "@/lib/supabase/client";
import { markBookingConfirmed } from "@/components/customer/BookingConfirmedFocus";

// Cele două decizii ale clientului pe o rezervare: accept oferta sau renunț.
// Confirmarea e disponibilă doar când există ofertă (DB-ul refuză altfel, iar
// butonul nu se afișează degeaba).
export function BookingActions({
  bookingId,
  status,
  priceMdl,
  venueType,
}: {
  bookingId: string;
  status: string;
  priceMdl: number | null;
  /** lumea locului, pentru momentul de confirmare (§5 din rubrică) */
  venueType?: string | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const closed = ["cancelled", "declined", "completed"].includes(status);
  if (closed) return null;

  function run(action: "confirm" | "cancel") {
    setError(null);
    startTransition(async () => {
      try {
        const supabase = createClient();
        if (action === "confirm") {
          await confirmVenueBooking(supabase, bookingId);
          // Semnalul pleacă DUPĂ ce serverul a confirmat și ÎNAINTE de
          // reîmprospătare: momentul aparține unei rezervări care chiar există,
          // și pornește peste re-randarea listei, nu după ea.
          markBookingConfirmed(venueType);
        } else {
          await cancelVenueBooking(supabase, bookingId);
        }
        router.refresh();
      } catch (err) {
        setError(err instanceof RpcError ? err.userMessage : "Nu am putut actualiza rezervarea. Încearcă din nou.");
      }
    });
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {status === "quoted" && (
        <button
          type="button"
          disabled={pending}
          onClick={() => run("confirm")}
          className="rounded-full bg-gold px-5 py-2 text-xs font-bold uppercase tracking-wider text-zinc-900 transition hover:bg-gold-light disabled:opacity-40"
        >
          {pending ? "Se confirmă…" : `Confirmă${priceMdl != null ? ` · ${priceMdl} MDL` : ""}`}
        </button>
      )}
      <button
        type="button"
        disabled={pending}
        onClick={() => run("cancel")}
        className="text-xs text-white/40 underline underline-offset-4 transition hover:text-white/70 disabled:opacity-40"
      >
        Renunță
      </button>
      {error && <p className="w-full text-xs text-primary">{error}</p>}
    </div>
  );
}
