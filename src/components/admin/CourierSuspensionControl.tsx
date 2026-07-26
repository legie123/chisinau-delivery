"use client";

import { useState, useTransition } from "react";
import { reinstateCourierAction, suspendCourierAction } from "@/app/(admin)/platform/couriers/actions";

// EU 2024/2831 Art 10(5)+11: a courier can only be deactivated by a human admin, with
// a mandatory written reason (recorded + a contest window). Reactivation lifts it.
export function CourierSuspensionControl({ courierId, initialActive }: { courierId: string; initialActive: boolean }) {
  const [active, setActive] = useState(initialActive);
  const [prevActive, setPrevActive] = useState(initialActive);
  if (prevActive !== initialActive) {
    setPrevActive(initialActive);
    setActive(initialActive);
  }
  const [pending, startTransition] = useTransition();
  const [suspending, setSuspending] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSuspend() {
    if (!reason.trim()) return;
    setError(null);
    startTransition(async () => {
      const r = await suspendCourierAction(courierId, reason.trim());
      if (r.error) setError(r.error);
      else {
        setActive(false);
        setSuspending(false);
        setReason("");
      }
    });
  }

  function handleReinstate() {
    setError(null);
    startTransition(async () => {
      const r = await reinstateCourierAction(courierId);
      if (r.error) setError(r.error);
      else setActive(true);
    });
  }

  if (!active) {
    return (
      <div className="flex flex-col items-start gap-1">
        <button
          type="button"
          onClick={handleReinstate}
          disabled={pending}
          className="rounded-full bg-white/10 px-3 py-1 text-xs text-white/60 ring-1 ring-white/10 transition hover:bg-white/15 disabled:opacity-40"
        >
          Suspendat · Reactivează
        </button>
        {error && <span className="text-[11px] text-primary">{error}</span>}
      </div>
    );
  }

  if (suspending) {
    return (
      <div className="flex flex-col items-start gap-1">
        <div className="flex items-center gap-2">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            aria-label="Motivul suspendării"
            placeholder="Motiv (obligatoriu)"
            className="w-44 rounded-lg bg-white/5 px-2 py-1 text-xs text-white placeholder-white/35 ring-1 ring-white/10 outline-none focus:ring-primary/60"
          />
          <button
            type="button"
            onClick={handleSuspend}
            disabled={pending || !reason.trim()}
            className="rounded-full bg-primary-dark px-3 py-1 text-xs font-semibold text-white disabled:opacity-40"
          >
            Suspendă
          </button>
          <button
            type="button"
            onClick={() => setSuspending(false)}
            className="rounded-full bg-white/5 px-3 py-1 text-xs text-white/60 ring-1 ring-white/10"
          >
            Renunță
          </button>
        </div>
        {error && <span className="text-[11px] text-primary">{error}</span>}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setSuspending(true)}
      className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs text-emerald-400 ring-1 ring-emerald-500/30 transition hover:bg-primary/15 hover:text-primary"
    >
      Activ · Suspendă
    </button>
  );
}
