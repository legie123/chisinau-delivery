"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { acceptOffer, declineOffer } from "@/app/(courier)/deliveries/actions";
import type { DispatchOffer } from "@/lib/types/domain";

// #17 — accept_dispatch_offer/decline_dispatch_offer raise these exact Romanian
// messages (supabase/migrations/20260717001600_dispatch_offers.sql) when the
// offer died server-side (sweeper expiry, reassigned to another courier, or a
// concurrent decline) between render and click. That's a normal race on a 30s
// countdown, not a bug — show it as a calm "gone" state, not a raw error line.
function isOfferGoneMessage(message: string): boolean {
  return /expirat|nu mai este disponibil|nu mai este activ/i.test(message);
}

// WS2 — push-dispatch offer with a 30s countdown. On expiry we refresh so the
// stale card vanishes without waiting for the sweeper event. The Accept path
// lands the courier on the active delivery; Decline cascades server-side.
export function OfferCard({ offer }: { offer: DispatchOffer }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
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
      if (result.error) {
        if (isOfferGoneMessage(result.error)) setGone(true);
        else setError(result.error);
      } else {
        router.push(`/deliveries/${offer.order_id}`);
      }
    });
  }

  function handleDecline() {
    startTransition(async () => {
      const result = await declineOffer(offer.id);
      if (result.error) {
        if (isOfferGoneMessage(result.error)) setGone(true);
        else setError(result.error);
      } else {
        router.refresh();
      }
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

      <div className="mt-3">
        <p className="font-serif text-xl font-bold text-white">
          {order?.order_number ?? "Comandă"}
        </p>
        {/* #3a — the fee is what the courier earns; total_mdl is cash he collects
            from the customer. Câștig must be the primary gold number, mirroring
            AvailableOrderRow, or a courier reads total_mdl as his own pay.
            Order 2 — courier_fee_quoted_mdl is a FLOOR, not a fixed number:
            "tarif minim" (never "minim garantat" — the final at delivery can
            be higher, never lower). Falls back to delivery_fee_mdl for any
            order that predates the tariff (should not happen post-migration,
            but mark_ready_for_pickup always stamps it going forward). */}
        {order && (
          <div className="mt-1 flex items-baseline gap-2">
            <p className="text-lg font-bold text-gold">
              Câștig: {order.courier_fee_quoted_mdl ?? order.delivery_fee_mdl} MDL
            </p>
            {Number(order.tip_mdl) > 0 && (
              <span className="text-sm font-semibold text-emerald-400">+{order.tip_mdl} bacșiș</span>
            )}
          </div>
        )}
        {order && <p className="text-xs text-white/40">tarif minim — poate crește cu distanța reală</p>}
        {order && (
          <p className="text-sm text-white/50">
            De încasat: <span className="font-semibold text-white/70">{order.total_mdl} MDL</span>
          </p>
        )}
      </div>
      <p className="mt-1 text-sm text-white/60">
        {offer.distance_km != null ? `~${Number(offer.distance_km).toFixed(1)} km până la restaurant` : "Distanță estimată"}
      </p>

      {/* #17 — an honest "gone" state instead of a raw Postgres exception
          message sitting under still-clickable buttons. */}
      {gone ? (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-white/5 px-4 py-3 ring-1 ring-white/10">
          <p className="text-sm text-white/70">⏳ Oferta a expirat sau a fost preluată de alt curier.</p>
          <button
            type="button"
            onClick={() => router.refresh()}
            className="shrink-0 rounded-full bg-white/10 px-4 py-2 text-xs font-semibold text-white transition hover:bg-white/20"
          >
            Reîmprospătează
          </button>
        </div>
      ) : (
        <>
          {error && <p className="mt-2 text-sm text-primary">{error}</p>}
          <div className="mt-4 flex gap-3">
            <button
              type="button"
              onClick={handleAccept}
              disabled={pending || secs === 0}
              className="flex-1 rounded-full bg-primary-dark px-5 py-3 text-sm font-bold text-white transition hover:bg-primary-darker disabled:opacity-50"
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
        </>
      )}
    </section>
  );
}
