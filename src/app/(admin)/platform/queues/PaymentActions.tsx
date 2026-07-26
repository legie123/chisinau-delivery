"use client";

import { useState, useTransition } from "react";
import { resolvePayment } from "./actions";
import type { PaymentStatus } from "@/lib/types/domain";

// Allowed payment transitions mirror admin_update_payment_status exactly; the UI
// only offers the ones valid from the current status (the RPC re-checks anyway).
const NEXT: Partial<Record<PaymentStatus, { to: PaymentStatus; label: string }[]>> = {
  paid: [{ to: "refund_pending", label: "Deschide dispută" }],
  refund_pending: [
    { to: "refunded", label: "Marchează rambursat" },
    { to: "paid", label: "Respinge disputa" },
  ],
  failed: [{ to: "unpaid", label: "Resetează" }],
  unpaid: [{ to: "paid", label: "Confirmă încasarea" }],
  // A stuck online order (intent opened, never captured). No real PSP in the
  // pilot, so an admin resolves it by hand: collected cash on delivery →
  // confirm manually; abandoned → mark failed or reset so the customer pays cash.
  pending_capture: [
    { to: "paid", label: "Confirmă încasarea (manual)" },
    { to: "failed", label: "Marchează eșuată" },
    { to: "unpaid", label: "Resetează la neîncasat" },
  ],
};

export function PaymentActions({ orderId, status }: { orderId: string; status: PaymentStatus }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const options = NEXT[status] ?? [];

  function handle(to: PaymentStatus) {
    setError(null);
    startTransition(async () => {
      const result = await resolvePayment(orderId, to);
      if (result.error) setError(result.error);
    });
  }

  if (options.length === 0) return <span className="text-xs text-white/30">—</span>;

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-1.5">
        {options.map((opt) => (
          <button
            key={opt.to}
            type="button"
            onClick={() => handle(opt.to)}
            disabled={pending}
            className="rounded-full bg-white/5 px-3 py-1 text-xs text-white/70 ring-1 ring-white/10 transition hover:bg-white/10 disabled:opacity-40"
          >
            {opt.label}
          </button>
        ))}
      </div>
      {error && <span className="text-[11px] text-primary">{error}</span>}
    </div>
  );
}
