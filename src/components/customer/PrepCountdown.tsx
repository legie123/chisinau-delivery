"use client";

import { useEffect, useState } from "react";
import type { Order } from "@/lib/types/domain";
import { DELIVERY_BUFFER_MIN, formatClock, minutesUntil } from "@/lib/orders/eta";

// WS4 — live "gata în ~N min" countdown from orders.estimated_ready_at (stamped
// by accept_order). No subscription of its own — the parent OrderTracking already
// receives the whole updated orders row via row-filtered realtime, so a fresh
// estimated_ready_at arrives on the accept push and re-renders this.
export function PrepCountdown({
  estimatedReadyAt,
  status,
}: {
  estimatedReadyAt: string;
  status: Order["status"];
}) {
  const [, setTick] = useState<number | null>(null);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setTick(Date.now()));
    const id = setInterval(() => setTick(Date.now()), 30_000);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(id);
    };
  }, []);

  const readyIn = minutesUntil(estimatedReadyAt);
  // Arrival = kitchen-ready + courier travel placeholder (WS3 will refine).
  const arriveClock = formatClock(
    new Date(new Date(estimatedReadyAt).getTime() + DELIVERY_BUFFER_MIN * 60_000).toISOString(),
  );

  const headline =
    readyIn > 0
      ? `Gata în ~${readyIn} min`
      : status === "ready_for_pickup" || status === "courier_assigned"
        ? "Gata — se pregătește ridicarea"
        : "Din clipă în clipă";

  return (
    <div className="mt-1 text-center">
      <p className="text-sm font-semibold text-gold">{headline}</p>
      <p className="text-xs text-white/45">Sosește ~{arriveClock}</p>
    </div>
  );
}
