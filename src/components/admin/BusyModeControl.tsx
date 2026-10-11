"use client";

import { useEffect, useState, useTransition } from "react";
import { setRestaurantBusy } from "@/app/(admin)/restaurant/orders/actions";

const OPTIONS = [15, 30, 45] as const;

// Busy mode on the kitchen tablet: one tap adds 15/30/45 min to every prep
// estimate (customer ETA + newly accepted orders) for one hour, then lapses.
export function BusyModeControl({ extraMinutes, until }: { extraMinutes: number; until: string | null }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now);
  const untilMs = until ? new Date(until).getTime() : null;
  const active = extraMinutes > 0 && untilMs != null && untilMs > now;
  // router.refresh() keeps this state, so without a timer the tablet kept saying
  // "Aglomerat" after the window lapsed server-side (red-team F2).
  useEffect(() => {
    if (untilMs == null) return;
    const t = setTimeout(() => setNow(Date.now()), Math.max(0, untilMs - Date.now()) + 1000);
    return () => clearTimeout(t);
  }, [untilMs]);
  const untilLabel = active
    ? new Date(until!).toLocaleTimeString("ro-MD", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Chisinau" })
    : null;

  function set(minutes: 0 | 15 | 30 | 45) {
    startTransition(async () => {
      const result = await setRestaurantBusy(minutes);
      setError(result.error);
    });
  }

  return (
    <div
      className={`flex flex-wrap items-center gap-2 rounded-2xl px-4 py-3 text-sm ring-1 ${
        active ? "bg-amber-500/10 ring-amber-500/30" : "bg-white/5 ring-white/10"
      }`}
    >
      <span className={active ? "font-semibold text-amber-300" : "text-white/60"}>
        {active ? `Aglomerat: +${extraMinutes} min până la ${untilLabel}` : "Bucătăria e aglomerată?"}
      </span>
      <div className="ml-auto flex gap-1.5">
        {OPTIONS.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => set(m)}
            disabled={pending}
            aria-pressed={active && extraMinutes === m}
            className={`min-h-11 rounded-full px-3.5 text-xs font-semibold ring-1 transition disabled:opacity-50 ${
              active && extraMinutes === m
                ? "bg-amber-500/25 text-amber-200 ring-amber-400/50"
                : "bg-white/5 text-white/75 ring-white/10 hover:bg-white/10"
            }`}
          >
            +{m}
          </button>
        ))}
        {active && (
          <button
            type="button"
            onClick={() => set(0)}
            disabled={pending}
            className="min-h-11 rounded-full bg-white/5 px-3.5 text-xs text-white/70 ring-1 ring-white/10 hover:bg-white/10 disabled:opacity-50"
          >
            Oprește
          </button>
        )}
      </div>
      {error && <p className="w-full text-xs text-primary">{error}</p>}
    </div>
  );
}
