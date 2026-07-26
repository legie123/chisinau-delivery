"use client";

import { useState, useTransition } from "react";
import { cancelStuckOrder, forceAdvance } from "./actions";
import { ORDER_STATUS_LABEL, type OrderStatus } from "@/lib/types/domain";

// Mirrors advance_delivery_status' allowed transitions exactly (courier_assigned
// -> picked_up -> en_route -> delivered) — the RPC rejects anything else, so the
// UI only ever offers a next status that will actually succeed.
const NEXT_STATUS: Partial<Record<OrderStatus, OrderStatus>> = {
  courier_assigned: "picked_up",
  picked_up: "en_route",
  en_route: "delivered",
};

// Cancel (reuses the guarded cancel_order RPC; admin can cancel any-time) and
// force-advance (guarded advance_delivery_status RPC) a stuck order. Keeps a
// required reason for cancel — it lands in the audit event + cancellation_reason.
export function StuckOrderActions({ orderId, status }: { orderId: string; status: OrderStatus }) {
  const [mode, setMode] = useState<"idle" | "cancel" | "advance">("idle");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const nextStatus = NEXT_STATUS[status];

  function handleCancel() {
    if (!reason.trim()) return;
    setError(null);
    startTransition(async () => {
      const result = await cancelStuckOrder(orderId, reason.trim());
      if (result.error) setError(result.error);
    });
  }

  function handleAdvance() {
    if (!nextStatus) return;
    setError(null);
    startTransition(async () => {
      const result = await forceAdvance(orderId, nextStatus);
      if (result.error) setError(result.error);
      else setMode("idle");
    });
  }

  if (mode === "cancel") {
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
            className="rounded-full bg-primary-dark px-3 py-1 text-xs font-semibold text-white disabled:opacity-40"
          >
            Confirmă
          </button>
          <button
            type="button"
            onClick={() => setMode("idle")}
            className="rounded-full bg-white/5 px-3 py-1 text-xs text-white/60 ring-1 ring-white/10"
          >
            Renunță
          </button>
        </div>
        {error && <span className="text-[11px] text-primary">{error}</span>}
      </div>
    );
  }

  if (mode === "advance" && nextStatus) {
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-2">
          <span className="text-xs text-white/60">→ {ORDER_STATUS_LABEL[nextStatus]}?</span>
          <button
            type="button"
            onClick={handleAdvance}
            disabled={pending}
            className="rounded-full bg-gold px-3 py-1 text-xs font-semibold text-zinc-900 disabled:opacity-40"
          >
            Confirmă
          </button>
          <button
            type="button"
            onClick={() => setMode("idle")}
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
    <div className="flex justify-end gap-2">
      {nextStatus && (
        <button
          type="button"
          onClick={() => setMode("advance")}
          className="rounded-full bg-gold/15 px-3 py-1 text-xs font-semibold text-gold ring-1 ring-gold/30 transition hover:bg-gold/25"
        >
          Forțează statusul
        </button>
      )}
      <button
        type="button"
        onClick={() => setMode("cancel")}
        className="rounded-full bg-white/5 px-3 py-1 text-xs text-white/70 ring-1 ring-white/10 transition hover:bg-white/10"
      >
        Anulează
      </button>
    </div>
  );
}
