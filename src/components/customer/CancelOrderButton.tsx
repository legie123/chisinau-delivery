"use client";

import { useState } from "react";
import { cancelOrder, RpcError } from "@chisinau/shared-api";
import { asOrderId } from "@chisinau/shared-types";
import { createClient } from "@/lib/supabase/client";

// #37 — the backend has always allowed the customer to cancel while the order is
// still pending_restaurant (cancel_order RPC); the UI just never offered it.
// Inline confirm (window.confirm is forbidden — no-op in installed PWA).
export function CancelOrderButton({ orderId }: { orderId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    setPending(true);
    setError(null);
    const supabase = createClient();
    try {
      await cancelOrder(supabase, asOrderId(orderId), "Anulată de client înainte de confirmare");
      // Success needs no local state change — useOrderRealtime flips the status live.
    } catch (err) {
      setError(err instanceof RpcError ? err.userMessage : "Nu am putut anula comanda.");
    }
    setPending(false);
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="mx-auto mt-3 block text-sm text-white/40 underline-offset-2 transition hover:text-white/70 hover:underline"
      >
        Anulează comanda
      </button>
    );
  }

  return (
    <div className="mt-3 flex flex-col items-center gap-2 rounded-xl bg-white/[0.04] p-3 ring-1 ring-white/10">
      <p className="text-sm text-white/70">Sigur anulezi comanda? Restaurantul nu a confirmat-o încă.</p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={cancel}
          disabled={pending}
          className="rounded-full bg-primary-dark px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-darker disabled:opacity-50"
        >
          {pending ? "Se anulează..." : "Da, anulează"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={pending}
          className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-white/80 transition hover:bg-white/15"
        >
          Renunță
        </button>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
