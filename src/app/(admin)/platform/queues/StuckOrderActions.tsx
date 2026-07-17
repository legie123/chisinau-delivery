"use client";

import { useState, useTransition } from "react";
import { cancelStuckOrder } from "./actions";

// Cancel a stuck order (reuses the guarded cancel_order RPC; admin can cancel
// any-time). Keeps a required reason — it lands in the audit event + the row's
// cancellation_reason.
export function StuckOrderActions({ orderId }: { orderId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleCancel() {
    if (!reason.trim()) return;
    setError(null);
    startTransition(async () => {
      const result = await cancelStuckOrder(orderId, reason.trim());
      if (result.error) setError(result.error);
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full bg-white/5 px-3 py-1 text-xs text-white/70 ring-1 ring-white/10 transition hover:bg-white/10"
      >
        Anulează
      </button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          aria-label="Motivul anulării"
          placeholder="Motiv"
          className="w-40 rounded-lg bg-white/5 px-2 py-1 text-xs text-white placeholder-white/35 ring-1 ring-white/10 outline-none focus:ring-primary/60"
        />
        <button
          type="button"
          onClick={handleCancel}
          disabled={pending || !reason.trim()}
          className="rounded-full bg-primary px-3 py-1 text-xs font-semibold text-white disabled:opacity-40"
        >
          Confirmă
        </button>
      </div>
      {error && <span className="text-[11px] text-primary">{error}</span>}
    </div>
  );
}
