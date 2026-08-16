"use client";

import { useEffect, useState } from "react";
import { formatTargetClock, minutesUntil } from "@/lib/orders/eta";

// WS4 — kitchen-side pressure signal: the accept-time ETA target with colour
// urgency. Amber under 5 min left, red once past due. Feeds WS8's SLA UI mental
// model on the partner queue. Own 30s timer; null until mounted (no SSR flash).
//
// Ținta unei comenzi programate poate cădea legitim mâine dimineață de la
// migrația 20260816000000 încoace, deci ora se scrie cu ziua când nu e azi.
// Până atunci, o comandă de a doua zi trecea în „Depășit — pregătește urgent"
// la 25 de minute după acceptare, fiindcă ținta era ștampilată now()+prep.
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
      {left < 0
        ? "⏱ Depășit — pregătește urgent"
        : `🎯 Țintă: ${formatTargetClock(estimatedReadyAt)}`}
    </span>
  );
}
