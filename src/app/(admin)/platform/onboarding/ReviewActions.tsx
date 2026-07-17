"use client";

import { useState, useTransition } from "react";
import { reviewApplication } from "./actions";

export function ReviewActions({ applicationId }: { applicationId: string }) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"approved" | "rejected" | null>(null);
  const [pending, startTransition] = useTransition();

  function act(approve: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await reviewApplication(applicationId, approve, note.trim() || undefined);
      if (result.error) setError(result.error);
      else setDone(approve ? "approved" : "rejected");
    });
  }

  if (done) {
    return (
      <p className={`text-sm font-medium ${done === "approved" ? "text-emerald-400" : "text-primary"}`}>
        {done === "approved" ? "Aprobată ✓" : "Respinsă ✓"}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Notă (opțional)"
        aria-label="Notă de verificare"
        rows={2}
        maxLength={500}
        className="w-full resize-none rounded-xl bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/35 ring-1 ring-white/10 outline-none focus:ring-primary/60"
      />
      {error && <p className="text-xs text-primary">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => act(true)}
          disabled={pending}
          className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-dark disabled:opacity-50"
        >
          {pending ? "..." : "Aprobă"}
        </button>
        <button
          type="button"
          onClick={() => act(false)}
          disabled={pending}
          className="rounded-full border border-white/15 px-5 py-2.5 text-sm font-semibold text-white/80 transition hover:bg-white/10 disabled:opacity-50"
        >
          Respinge
        </button>
      </div>
    </div>
  );
}
