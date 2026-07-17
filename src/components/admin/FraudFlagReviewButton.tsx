"use client";

import { useState, useTransition } from "react";
import { markFlagReviewed } from "@/app/(admin)/platform/fraud/actions";

export function FraudFlagReviewButton({ flagId }: { flagId: string }) {
  const [reviewed, setReviewed] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleReview() {
    setFailed(false);
    startTransition(async () => {
      const result = await markFlagReviewed(flagId);
      if (result.error) setFailed(true);
      else setReviewed(true);
    });
  }

  if (reviewed) {
    return <span className="text-xs text-emerald-400">Verificat ✓</span>;
  }

  return (
    <button
      type="button"
      onClick={handleReview}
      disabled={pending}
      className="rounded-full bg-white/5 px-3 py-1 text-xs text-white/70 ring-1 ring-white/10 transition hover:bg-white/10 disabled:opacity-50"
    >
      {failed ? "Eroare — reîncearcă" : "Marchează verificat"}
    </button>
  );
}
