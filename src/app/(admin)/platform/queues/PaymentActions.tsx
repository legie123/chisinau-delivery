"use client";

import { useState, useTransition } from "react";
import { refundOrder, resolvePayment } from "./actions";
import type { PaymentMethod, PaymentStatus } from "@/lib/types/domain";

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

const input = "w-24 rounded-lg bg-white/5 px-2 py-1 text-xs text-white ring-1 ring-white/10 outline-none focus:ring-primary/60";

export function PaymentActions({
  orderId,
  status,
  paymentMethod,
  totalMdl,
  refundedMdl = 0,
}: {
  orderId: string;
  status: PaymentStatus;
  paymentMethod?: PaymentMethod;
  totalMdl?: number;
  refundedMdl?: number;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const options = NEXT[status] ?? [];
  // Owner decision 2026-10-13 (B2): a partial refund is possible only on a captured ONLINE payment,
  // up to what is left of the total; cash is corrected in the cash ledger instead.
  const left = totalMdl != null ? Math.round((totalMdl - refundedMdl) * 100) / 100 : null;
  const canRefund = paymentMethod === "online_gateway" && (status === "paid" || status === "refund_pending") && left != null && left > 0;

  function handle(to: PaymentStatus) {
    setError(null);
    startTransition(async () => {
      const result = await resolvePayment(orderId, to);
      if (result.error) setError(result.error);
    });
  }

  function handleRefund() {
    setError(null);
    startTransition(async () => {
      const result = await refundOrder(orderId, Number(amount.replace(",", ".")), reason);
      if (result.error) setError(result.error);
      else {
        setAmount("");
        setReason("");
      }
    });
  }

  if (options.length === 0 && !canRefund) return <span className="text-xs text-white/30">—</span>;

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
      {canRefund && (
        <div className="flex flex-wrap items-center justify-end gap-1.5" data-testid="refund-form">
          <span className="text-[11px] text-white/40">
            {refundedMdl > 0 ? `rambursat ${refundedMdl} din ${totalMdl} MDL` : `de rambursat până la ${left} MDL`}
          </span>
          <input
            aria-label="Suma de rambursat (MDL)"
            inputMode="decimal"
            placeholder={`≤ ${left}`}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={input}
          />
          <input
            aria-label="Motivul rambursării"
            placeholder="motiv (în audit)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={`${input} w-40`}
          />
          <button
            type="button"
            onClick={handleRefund}
            disabled={pending || !amount || reason.trim().length < 5}
            className="rounded-full bg-gold/15 px-3 py-1 text-xs text-gold ring-1 ring-gold/30 transition hover:bg-gold/25 disabled:opacity-40"
          >
            Rambursează
          </button>
        </div>
      )}
      {error && <span className="text-[11px] text-primary">{error}</span>}
    </div>
  );
}
