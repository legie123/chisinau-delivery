"use client";

import { useState, useTransition } from "react";
import { acceptDelivery } from "@/app/(courier)/deliveries/actions";
import type { Order } from "@/lib/types/domain";

export function AvailableOrderRow({ order, disabled }: { order: Order; disabled?: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleAccept() {
    if (disabled) return;
    startTransition(async () => {
      const result = await acceptDelivery(order.id);
      setError(result.error);
    });
  }

  return (
    <li className="flex items-center justify-between gap-4 rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/[0.06]">
      <div className="flex items-center gap-4">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gold/15 text-xl" aria-hidden>
          📦
        </span>
        <div>
          <p className="font-semibold text-white">{order.order_number}</p>
          <p className="mt-0.5 text-sm text-white/50">
            De încasat: <span className="font-semibold text-white/80">{order.total_mdl} MDL</span>
          </p>
          <p className="text-sm font-bold text-gold">Câștig: {order.delivery_fee_mdl} MDL</p>
          {error && <p className="mt-1 text-xs text-primary">{error}</p>}
        </div>
      </div>
      <button
        type="button"
        onClick={handleAccept}
        disabled={pending || disabled}
        title={disabled ? "Finalizează livrarea curentă mai întâi." : undefined}
        className="rounded-full bg-primary-dark px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-darker disabled:opacity-50"
      >
        {pending ? "..." : "Acceptă"}
      </button>
    </li>
  );
}
