"use client";

import { useState, useTransition } from "react";
import { acceptOrder, markReadyForPickup, rejectOrder } from "@/app/(admin)/restaurant/orders/actions";
import { ORDER_STATUS_LABEL, type Order } from "@/lib/types/domain";

const STATUS_EMOJI: Record<string, string> = {
  pending_restaurant: "🔔",
  accepted: "👨‍🍳",
  ready_for_pickup: "🥡",
  courier_assigned: "🛵",
  picked_up: "🛵",
  en_route: "🛵",
};

export function OrderQueueRow({ order }: { order: Order }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleAccept() {
    startTransition(async () => {
      const result = await acceptOrder(order.id);
      setError(result.error);
    });
  }

  function handleReject() {
    const reason = window.prompt("Motiv refuz:");
    if (reason === null) return; // dismissed — don't reject
    startTransition(async () => {
      const result = await rejectOrder(order.id, reason);
      setError(result.error);
    });
  }

  function handleReady() {
    startTransition(async () => {
      const result = await markReadyForPickup(order.id);
      setError(result.error);
    });
  }

  const isNew = order.status === "pending_restaurant";

  return (
    <li
      className={`flex items-center justify-between gap-4 rounded-2xl p-5 ring-1 ${
        isNew ? "bg-primary/10 ring-primary/40" : "bg-white/[0.04] ring-white/[0.06]"
      }`}
    >
      <div className="flex items-center gap-4">
        <span
          className={`flex h-12 w-12 items-center justify-center rounded-full text-xl ${
            isNew ? "animate-pulse bg-primary/20" : "bg-white/10"
          }`}
          aria-hidden
        >
          {STATUS_EMOJI[order.status] ?? "📦"}
        </span>
        <div>
          <p className="font-semibold text-white">{order.order_number}</p>
          <p className="mt-0.5 text-sm text-white/50">
            {ORDER_STATUS_LABEL[order.status]} · <span className="font-semibold text-white/80">{order.total_mdl} MDL</span>
          </p>
          {error && <p className="mt-1 text-xs text-primary">{error}</p>}
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        {order.status === "pending_restaurant" && (
          <>
            <button
              type="button"
              onClick={handleAccept}
              disabled={pending}
              className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-dark disabled:opacity-50"
            >
              Acceptă
            </button>
            <button
              type="button"
              onClick={handleReject}
              disabled={pending}
              className="rounded-full bg-white/5 px-5 py-2.5 text-sm text-white/70 ring-1 ring-white/10 transition hover:bg-white/10 disabled:opacity-50"
            >
              Refuză
            </button>
          </>
        )}
        {order.status === "accepted" && (
          <button
            type="button"
            onClick={handleReady}
            disabled={pending}
            className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-dark disabled:opacity-50"
          >
            🥡 Gata de ridicare
          </button>
        )}
      </div>
    </li>
  );
}
