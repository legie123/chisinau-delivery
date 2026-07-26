"use client";

import { useState, useTransition } from "react";
import { advanceStatus } from "@/app/(courier)/deliveries/actions";
import { useBroadcastCourierLocation } from "@/hooks/useBroadcastCourierLocation";
import { useOfflinePendingStatusQueue } from "@/hooks/useOfflinePendingStatusQueue";
import { ORDER_STATUS_LABEL, type Order } from "@/lib/types/domain";

const NEXT_STEP: Record<string, { next: string; label: string; emoji: string }> = {
  courier_assigned: { next: "picked_up", label: "Am ridicat comanda", emoji: "🥡" },
  picked_up: { next: "en_route", label: "Am pornit spre client", emoji: "🛵" },
  en_route: { next: "delivered", label: "Am livrat comanda", emoji: "✅" },
};

export function DeliveryStatusControls({ order, courierId }: { order: Order; courierId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Broadcast GPS while the food is with the courier.
  const broadcasting = order.status === "picked_up" || order.status === "en_route";
  const { error: geoError } = useBroadcastCourierLocation(order.id, courierId, broadcasting);

  const step = NEXT_STEP[order.status];
  const [confirmingPayment, setConfirmingPayment] = useState(false);
  const { queued, advanceOrEnqueue } = useOfflinePendingStatusQueue(order.id, advanceStatus);

  function advance(paymentConfirmed?: boolean) {
    if (!step) return;
    setConfirmingPayment(false);
    startTransition(async () => {
      const result = await advanceOrEnqueue(step.next, paymentConfirmed);
      setError(result.error);
    });
  }

  function handleAdvance() {
    if (!step) return;
    // window.confirm can be suppressed in installed PWAs — collect the cash
    // confirmation with an in-app step instead.
    if (step.next === "delivered" && order.payment_method !== "online_gateway") {
      setConfirmingPayment(true);
      return;
    }
    advance();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between rounded-2xl bg-white/[0.04] p-4 ring-1 ring-white/[0.06]">
        <span className="text-sm text-white/60">Status curent</span>
        <span className="rounded-full bg-gold/15 px-3 py-1 text-sm font-semibold text-gold ring-1 ring-gold/30">
          {ORDER_STATUS_LABEL[order.status]}
        </span>
      </div>
      {broadcasting && (
        <p className="flex items-center gap-2 px-1 text-xs text-white/50">
          <span className={`h-2 w-2 rounded-full ${geoError ? "bg-primary" : "animate-pulse bg-emerald-400"}`} aria-hidden />
          {geoError ? `GPS indisponibil: ${geoError}` : "Locația ta se transmite live clientului"}
        </p>
      )}
      {step && !confirmingPayment && (
        <>
          <button
            type="button"
            onClick={handleAdvance}
            disabled={pending}
            className="flex items-center justify-center gap-2.5 rounded-full bg-primary-dark py-4 text-[15px] font-semibold text-white transition hover:bg-primary-darker disabled:opacity-50"
          >
            <span aria-hidden>{step.emoji}</span>
            {pending ? "Se actualizează..." : step.label}
          </button>
          {queued && (
            <p className="px-1 text-xs text-white/50">📡 Fără semnal — se va sincroniza când revii online.</p>
          )}
        </>
      )}
      {confirmingPayment && (
        <div className="flex flex-col gap-2 rounded-2xl bg-white/[0.04] p-4 ring-1 ring-gold/30">
          <p className="text-sm font-semibold text-white">Ai încasat plata ({order.total_mdl} MDL, cash/POS)?</p>
          <p className="text-xs text-white/45">Ambele opțiuni marchează comanda ca livrată.</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => advance(true)}
              disabled={pending}
              className="flex-1 rounded-full bg-emerald-500/90 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
            >
              💰 Da, am încasat
            </button>
            <button
              type="button"
              onClick={() => advance(false)}
              disabled={pending}
              className="flex-1 rounded-full bg-white/10 py-3 text-sm text-white/80 ring-1 ring-white/15 transition hover:bg-white/15 disabled:opacity-50"
            >
              Livrat, neîncasat
            </button>
          </div>
          {/* #3c — advance_delivery_status leaves payment_status='unpaid' on this
              path (never auto-marks 'paid'); the fee then sits excluded from
              Câștiguri until an admin resolves it in coada de plăți, not lost
              but also not silently credited. Say so before the click, not after. */}
          <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-300/90 ring-1 ring-amber-500/20">
            ⚠️ „Neîncasat” înseamnă plata rămâne nerezolvată — taxa ta de livrare NU apare în Câștiguri până nu o rezolvă un administrator.
          </p>
          <button
            type="button"
            onClick={() => setConfirmingPayment(false)}
            disabled={pending}
            className="mt-1 rounded-full py-2 text-xs text-white/50 transition hover:text-white/80 disabled:opacity-50"
          >
            ← Înapoi (nu am livrat încă)
          </button>
        </div>
      )}
      {error && (
        <p className="rounded-xl bg-primary/15 px-4 py-3 text-sm text-primary ring-1 ring-primary/30">{error}</p>
      )}
    </div>
  );
}
