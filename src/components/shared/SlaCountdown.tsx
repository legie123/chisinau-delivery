"use client";

import { useEffect, useState } from "react";

// WS8 — visible countdown to the restaurant accept-SLA deadline (WS1 added
// restaurants.accept_sla_minutes + the pg_cron auto-cancel). Partner sees
// time left to accept before auto-cancel; customer sees the same deadline.
// Null until mounted (no SSR hydration mismatch); never used as a gate —
// the real enforcement is the server-side sweeper.
export function SlaCountdown({
  createdAt,
  slaMinutes,
  variant,
}: {
  createdAt: string;
  slaMinutes: number;
  variant: "partner" | "customer";
}) {
  const deadline = new Date(createdAt).getTime() + slaMinutes * 60_000;
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setNow(Date.now()));
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(id);
    };
  }, []);

  if (now === null) return null;

  const remaining = Math.max(0, deadline - now);
  const mins = Math.floor(remaining / 60_000);
  const secs = Math.floor((remaining % 60_000) / 1000);
  const clock = `${mins}:${secs.toString().padStart(2, "0")}`;
  const urgent = remaining > 0 && remaining <= 120_000;
  const expired = remaining === 0;

  if (variant === "partner") {
    if (expired) {
      return (
        <span className="rounded-full bg-primary/15 px-2.5 py-1 text-xs font-semibold text-primary ring-1 ring-primary/30">
          ⏱ Timp expirat — comanda se anulează automat…
        </span>
      );
    }
    return (
      <span
        className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${
          urgent
            ? "animate-pulse bg-gold/15 text-gold ring-gold/40"
            : "bg-white/5 text-white/70 ring-white/10"
        }`}
      >
        ⏱ {clock} pentru a accepta
      </span>
    );
  }

  // customer variant
  if (expired) {
    return <p className="text-sm text-white/50">Încă un moment…</p>;
  }
  return (
    <p className={`text-sm ${urgent ? "text-gold" : "text-white/50"}`}>
      Restaurantul are {clock} să confirme comanda.
    </p>
  );
}
