"use client";

import { useEffect, useState } from "react";
import type { Order } from "@/lib/types/domain";
import {
  COUNTDOWN_HORIZON_MIN,
  DELIVERY_BUFFER_MIN,
  formatTargetClock,
  minutesUntil,
} from "@/lib/orders/eta";

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
  const [tick, setTick] = useState<number | null>(null);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setTick(Date.now()));
    const id = setInterval(() => setTick(Date.now()), 30_000);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(id);
    };
  }, []);

  // Gate the Date.now()-dependent text on mount (SSR + first client render both
  // return null) so the live headline never causes a hydration mismatch.
  if (tick === null) return null;

  const readyIn = minutesUntil(estimatedReadyAt);
  // Arrival = kitchen-ready + courier travel placeholder (WS3 will refine).
  const arriveClock = formatTargetClock(
    new Date(new Date(estimatedReadyAt).getTime() + DELIVERY_BUFFER_MIN * 60_000).toISOString(),
  );

  const headline =
    // Comandă programată: de la migrația 20260816000000 ținta e ancorată de
    // fereastra cerută, deci poate fi peste multe ore. „Gata în ~758 min" e o
    // socoteală pe care o lași în seama cititorului — spune ora, nu minutele.
    readyIn > COUNTDOWN_HORIZON_MIN
      ? `Gata ~${formatTargetClock(estimatedReadyAt)}`
      : readyIn > 0
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
