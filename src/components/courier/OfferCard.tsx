"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { acceptOffer, declineOffer } from "@/app/(courier)/deliveries/actions";
import type { DispatchOffer } from "@/lib/types/domain";

// WS2 — push-dispatch offer with a 30s countdown. On expiry we refresh so the
// stale card vanishes without waiting for the sweeper event. The Accept path
// lands the courier on the active delivery; Decline cascades server-side.
export function OfferCard({ offer }: { offer: DispatchOffer }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setNow(Date.now()));
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(id);
    };
  }, []);

  const deadline = new Date(offer.expires_at).getTime();
  const remaining = now === null ? null : Math.max(0, deadline - now);

  useEffect(() => {
    if (remaining === 0) router.refresh();
  }, [remaining, router]);

  const secs = remaining === null ? null : Math.ceil(remaining / 1000);
  const order = offer.orders;

  function handleAccept() {
    startTransition(async () => {
      const result = await acceptOffer(offer.id);
      if (result.error) setError(result.error);
      else router.push(`/deliveries/${offer.order_id}`);
    });
  }

  function handleDecline() {
    startTransition(async () => {
      const result = await declineOffer(offer.id);
      if (result.error) setError(result.error);
      else router.refresh();
    });
  }

  return (
    <section className="mb-6 overflow-hidden rounded-2xl bg-gradient-to-br from-[#2a1f0a] to-[#3d1220] p-5 ring-1 ring-gold/40 shadow-lg shadow-black/40">
      <div className="flex items-center justify-between">
        <span className="rounded-full bg-gold/20 px-3 py-1 text-xs font-bold uppercase tracking-wide text-gold">
          🔔 Comandă nouă pentru tine
        </span>
        {secs !== null && (
          <span
            className={`rounded-full px-3 py-1 text-sm font-bold tabular-nums ${
              secs <= 10 ? "animate-pulse bg-primary/20 text-primary" : "bg-white/10 text-white/80"
            }`}
          >
            {secs}s
          </span>
        )}
      </div>

      <div className="mt-3 flex items-baseline justify-between gap-3">
        <p className="font-serif text-xl font-bold text-white">
          {order?.order_number ?? "Comandă"}
        </p>
        {order && <p className="text-lg font-bold text-gold">{order.total_mdl} MDL</p>}
      </div>
      <p className="mt-1 text-sm text-white/60">
        {offer.distance_km != null ? `~${Number(offer.distance_km).toFixed(1)} km până la restaurant` : "Distanță estimată"}
      </p>

      {error && <p className="mt-2 text-sm text-primary">{error}</p>}

      <div className="mt-4 flex gap-3">
        <button
          type="button"
          onClick={handleAccept}
          disabled={pending || secs === 0}
          className="flex-1 rounded-full bg-primary px-5 py-3 text-sm font-bold text-white transition hover:bg-primary-dark disabled:opacity-50"
        >
          Acceptă
        </button>
        <button
          type="button"
          onClick={handleDecline}
          disabled={pending}
          className="rounded-full bg-white/5 px-5 py-3 text-sm font-semibold text-white/70 ring-1 ring-white/10 transition hover:bg-white/10 disabled:opacity-50"
        >
          Refuză
        </button>
      </div>
    </section>
  );
}
