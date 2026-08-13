"use client";

import { useState, useTransition } from "react";
import { restaurantCancelOrder } from "@/app/(admin)/restaurant/orders/actions";

// Dezbatere 2026-08-12 GAP (P1): the partner had no exit after accepting an
// order it cannot fulfil — every real-world "out of stock" became a phone
// call to the platform admin. Deliberately un-flashy (a quiet escape hatch,
// not a tempting button) and reason-first, mirroring the reject flow.
export function RestaurantCancelControl({ orderId }: { orderId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm text-white/40 underline underline-offset-4 transition hover:text-primary"
      >
        Nu pot onora comanda
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-primary/5 p-4 ring-1 ring-primary/25">
      <label htmlFor="cancel-reason" className="text-sm font-medium text-white/80">
        De ce nu poate fi onorată? Clientul primește exact acest motiv.
      </label>
      <input
        id="cancel-reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="ex. S-a terminat somonul proaspăt"
        className="rounded-lg bg-white/5 px-3 py-2 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-primary/60"
      />
      {error && <p className="text-sm text-primary">{error}</p>}
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={pending || reason.trim().length < 5}
          onClick={() =>
            startTransition(async () => {
              const result = await restaurantCancelOrder(orderId, reason.trim());
              setError(result.error);
            })
          }
          className="rounded-full bg-primary-dark px-5 py-2 text-sm font-semibold text-white transition hover:bg-primary-darker disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Se anulează..." : "Anulează comanda"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-sm text-white/40 underline underline-offset-4 hover:text-white/70"
        >
          Renunță
        </button>
      </div>
      <p className="text-xs text-white/35">
        Posibil doar cât timp comanda e la voi (acceptată / gata de ridicare). Anulările repetate se văd în KPI-ul de refuzuri.
      </p>
    </div>
  );
}
