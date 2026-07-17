"use client";

import { useEffect, useState } from "react";
import { formatClock, minutesUntil } from "@/lib/orders/eta";

// WS4 — kitchen-side pressure signal: the accept-time ETA target (HH:MM) with
// colour urgency. Amber under 5 min left, red once past due. Feeds WS8's SLA UI
// mental model on the partner queue. Own 30s timer; null until mounted (no SSR flash).
export function ReadyTargetBadge({ estimatedReadyAt }: { estimatedReadyAt: string }) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setNow(Date.now()));
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(id);
    };
  }, []);

  if (now === null) return null;

  const left = minutesUntil(estimatedReadyAt);
  const tone =
    left < 0
      ? "bg-primary/15 text-primary ring-primary/30"
      : left <= 5
        ? "bg-gold/15 text-gold ring-gold/40"
        : "bg-white/5 text-white/70 ring-white/10";

  return (
    <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${tone}`}>
      {left < 0 ? "⏱ Depășit — pregătește urgent" : `🎯 Țintă: ${formatClock(estimatedReadyAt)}`}
    </span>
  );
}
