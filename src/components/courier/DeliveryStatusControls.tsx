"use client";

import { useState, useTransition } from "react";
import { advanceStatus } from "@/app/(courier)/deliveries/actions";
import { useBroadcastCourierLocation } from "@/hooks/useBroadcastCourierLocation";
import { ORDER_STATUS_LABEL, type Order } from "@/lib/types/domain";

const NEXT_STEP: Record<string, { next: string; label: string }> = {
  courier_assigned: { next: "picked_up", label: "Am ridicat comanda" },
  picked_up: { next: "en_route", label: "Am pornit spre client" },
  en_route: { next: "delivered", label: "Am livrat" },
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
      <p className="text-sm">
        Status: <span className="font-medium">{ORDER_STATUS_LABEL[order.status]}</span>
      </p>
      {broadcasting && (
        <p className="text-xs text-zinc-500">
          {geoError ? `GPS indisponibil: ${geoError}` : "Locația ta se transmite live clientului."}
        </p>
      )}
      {step && (
        <button
          type="button"
          onClick={handleAdvance}
          disabled={pending}
          className="w-fit rounded-full bg-primary px-6 py-3 text-sm text-white transition hover:bg-primary-dark disabled:opacity-50"
        >
          {pending ? "..." : step.label}
        </button>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
