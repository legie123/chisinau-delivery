"use client";

import { useState, useTransition } from "react";
import { settlePayee } from "@/app/(admin)/platform/payouts/actions";

// Marks a payee's whole NET pending balance paid (positive payouts and pending clawbacks together),
// after the bank transfer of exactly that amount. Replaces per-row "Marchează plătit": settling a
// positive row alone while a clawback is pending is the +105.50 MDL overpay the red-team found.
export function SettlePayeeButton({
  recipientType,
  recipientId,
  netMdl,
}: {
  recipientType: "courier" | "restaurant";
  recipientId: string;
  netMdl: number;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const res = await settlePayee(recipientType, recipientId, netMdl);
            if (res.error) setError(res.error);
          });
        }}
        className="rounded-full bg-primary-dark px-3 py-1 text-xs font-semibold text-white transition hover:bg-primary-darker disabled:opacity-40"
      >
        {pending ? "Se salvează..." : `Marchează plătit · ${netMdl.toFixed(2)} MDL`}
      </button>
      {error && <span className="text-[11px] text-primary">{error}</span>}
    </div>
  );
}
