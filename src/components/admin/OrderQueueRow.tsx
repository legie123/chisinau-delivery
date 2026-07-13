"use client";

import { useState, useTransition } from "react";
import { acceptOrder, markReadyForPickup, rejectOrder } from "@/app/(admin)/restaurant/orders/actions";
import { ORDER_STATUS_LABEL, type Order } from "@/lib/types/domain";

export function OrderQueueRow({ order }: { order: Order }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleAccept() {
    startTransition(async () => {
      try {
        await acceptOrder(order.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Eroare");
      }
    });
  }

  function handleReject() {
    const reason = window.prompt("Motiv refuz:") ?? "";
    startTransition(async () => {
      try {
        await rejectOrder(order.id, reason);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Eroare");
      }
    });
  }

  function handleReady() {
    startTransition(async () => {
      try {
        await markReadyForPickup(order.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Eroare");
      }
    });
  }

  return (
    <li className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 px-4 py-3 dark:border-zinc-800">
      <div>
        <p className="font-medium">{order.order_number}</p>
        <p className="text-xs text-zinc-500">
          {ORDER_STATUS_LABEL[order.status]} · {order.total_mdl} MDL
        </p>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
      <div className="flex gap-2">
        {order.status === "pending_restaurant" && (
          <>
            <button
              type="button"
              onClick={handleAccept}
              disabled={pending}
              className="rounded-full bg-primary px-4 py-1.5 text-xs text-white disabled:opacity-50"
            >
              Acceptă
            </button>
            <button
              type="button"
              onClick={handleReject}
              disabled={pending}
              className="rounded-full border border-zinc-300 px-4 py-1.5 text-xs disabled:opacity-50 dark:border-zinc-700"
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
            className="rounded-full bg-primary px-4 py-1.5 text-xs text-white disabled:opacity-50"
          >
            Gata de ridicare
          </button>
        )}
      </div>
    </li>
  );
}
