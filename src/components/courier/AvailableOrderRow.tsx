"use client";

import { useState, useTransition } from "react";
import { acceptDelivery } from "@/app/(courier)/deliveries/actions";
import type { Order } from "@/lib/types/domain";

export function AvailableOrderRow({ order }: { order: Order }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleAccept() {
    startTransition(async () => {
      try {
        await acceptDelivery(order.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Eroare");
      }
    });
  }

  return (
    <li className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 px-4 py-3 dark:border-zinc-800">
      <div>
        <p className="font-medium">{order.order_number}</p>
        <p className="text-xs text-zinc-500">{order.total_mdl} MDL</p>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
      <button
        type="button"
        onClick={handleAccept}
        disabled={pending}
        className="rounded-full bg-zinc-900 px-4 py-1.5 text-xs text-white disabled:opacity-50 dark:bg-white dark:text-zinc-900"
      >
        {pending ? "..." : "Acceptă livrarea"}
      </button>
    </li>
  );
}
