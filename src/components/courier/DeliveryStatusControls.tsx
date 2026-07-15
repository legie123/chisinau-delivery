"use client";

import { useState, useTransition } from "react";
import { advanceStatus } from "@/app/(courier)/deliveries/actions";
import { useBroadcastCourierLocation } from "@/hooks/useBroadcastCourierLocation";
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

  function handleAdvance() {
    if (!step) return;
    let paymentConfirmed: boolean | undefined;
    if (step.next === "delivered" && order.payment_method !== "online_gateway") {
      paymentConfirmed = window.confirm("Ai încasat plata (cash/POS)?");
    }
    startTransition(async () => {
      const result = await advanceStatus(order.id, step.next, paymentConfirmed);
      setError(result.error);
    });
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
      {step && (
        <button
          type="button"
          onClick={handleAdvance}
          disabled={pending}
          className="flex items-center justify-center gap-2.5 rounded-full bg-primary py-4 text-[15px] font-semibold text-white transition hover:bg-primary-dark disabled:opacity-50"
        >
          <span aria-hidden>{step.emoji}</span>
          {pending ? "Se actualizează..." : step.label}
        </button>
      )}
      {error && (
        <p className="rounded-xl bg-primary/15 px-4 py-3 text-sm text-primary ring-1 ring-primary/30">{error}</p>
      )}
    </div>
  );
}
