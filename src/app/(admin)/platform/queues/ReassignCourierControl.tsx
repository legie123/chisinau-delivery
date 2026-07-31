"use client";

import { useState, useTransition } from "react";
import { assignCourier, reassignCourier } from "./actions";

export type AvailableCourier = { id: string; full_name: string };

// Wave D2 — pick a courier for a stuck order. In `reassign` mode (default) it
// hands an in-flight order from a ghosting courier to another; with `assign`
// set it places a courier on a ready_for_pickup order that was never picked up
// (SurfaceAudit P2). The RPC re-checks capacity + role either way.
export function ReassignCourierControl({
  orderId,
  couriers,
  assign = false,
}: {
  orderId: string;
  couriers: AvailableCourier[];
  assign?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleReassign() {
    if (!selected) return;
    setError(null);
    startTransition(async () => {
      const result = assign
        ? await assignCourier(orderId, selected)
        : await reassignCourier(orderId, selected);
      if (result.error) setError(result.error);
      else {
        setOpen(false);
        setSelected("");
      }
    });
  }

  if (couriers.length === 0) {
    return <span className="text-xs text-white/30">Niciun curier liber.</span>;
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full bg-white/5 px-3 py-1 text-xs text-white/70 ring-1 ring-white/10 transition hover:bg-white/10"
      >
        {assign ? "Atribuie curier" : "Reatribuie curier"}
      </button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          aria-label="Alege curierul"
          className="w-44 rounded-lg bg-white/5 px-2 py-1 text-xs text-white ring-1 ring-white/10 outline-none focus:ring-gold/60"
        >
          <option value="">Alege curier…</option>
          {couriers.map((c) => (
            <option key={c.id} value={c.id} className="bg-[#0d0d1f]">
              {c.full_name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={handleReassign}
          disabled={pending || !selected}
          className="rounded-full bg-gold px-3 py-1 text-xs font-semibold text-zinc-900 disabled:opacity-40"
        >
          Confirmă
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-full bg-white/5 px-3 py-1 text-xs text-white/60 ring-1 ring-white/10"
        >
          Renunță
        </button>
      </div>
      {error && <span className="text-[11px] text-primary">{error}</span>}
    </div>
  );
}
