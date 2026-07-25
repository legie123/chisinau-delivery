"use client";

import { useState, useTransition } from "react";
import { markPaid } from "@/app/(admin)/platform/payouts/actions";

// Marks a single pending payout as paid via the admin_mark_payout_paid RPC.
// Optimistic-free: on success the revalidated server render drops the button.
// clawback = a negative payout (refund reversal). Same RPC settles it, but the
// label reflects recovering money rather than paying it out. (audit #12)
export function PayoutMarkPaidButton({ payoutId, clawback = false }: { payoutId: string; clawback?: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleMarkPaid() {
    setError(null);
    startTransition(async () => {
      const res = await markPaid(payoutId);
      if (res.error) setError(res.error);
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleMarkPaid}
        disabled={pending}
        className={`rounded-full px-3 py-1 text-xs font-semibold text-white transition disabled:opacity-40 ${
          clawback ? "bg-red-600 hover:bg-red-500" : "bg-primary-dark hover:bg-primary-darker"
        }`}
      >
        {pending ? "Se salvează..." : clawback ? "Marchează recuperat" : "Marchează plătit"}
      </button>
      {error && <span className="text-[11px] text-primary">{error}</span>}
    </div>
  );
}
