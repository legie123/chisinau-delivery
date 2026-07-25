"use client";

import { useState, useTransition } from "react";
import { markPaid } from "@/app/(admin)/platform/payouts/actions";

// Marks a single pending payout as paid via the admin_mark_payout_paid RPC.
// Optimistic-free: on success the revalidated server render drops the button.
export function PayoutMarkPaidButton({ payoutId }: { payoutId: string }) {
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
        className="rounded-full bg-primary-dark px-3 py-1 text-xs font-semibold text-white transition hover:bg-primary-darker disabled:opacity-40"
      >
        {pending ? "Se salvează..." : "Marchează plătit"}
      </button>
      {error && <span className="text-[11px] text-primary">{error}</span>}
    </div>
  );
}
