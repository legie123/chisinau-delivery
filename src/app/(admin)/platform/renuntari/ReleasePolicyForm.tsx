"use client";

import { useActionState } from "react";
import { setReleasePolicyAction, type ActionState } from "./actions";

const input =
  "rounded-xl bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/35 ring-1 ring-white/10 outline-none focus:ring-primary/60 [color-scheme:dark]";

export function ReleasePolicyForm({ dailyCap }: { dailyCap: number | null }) {
  const [state, action, pending] = useActionState(setReleasePolicyAction, { error: null });
  return (
    <form action={action} className="flex flex-col gap-3 rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/[0.06]">
      <h2 className="font-medium text-white">Plafon nou de renunțări</h2>
      <p className="text-sm text-white/50">
        Câte comenzi poate lăsa un curier într-o zi după ce le-a preluat. Versiune nouă, de acum; istoricul nu se rescrie.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-white/50">
          Renunțări pe zi (0–20)
          <input name="daily_cap" type="number" step="1" min={0} max={20} required defaultValue={dailyCap ?? ""} className={input} />
        </label>
        <label className="flex min-w-64 flex-1 flex-col gap-1 text-xs text-white/50">
          Motivul schimbării (rămâne în istoric)
          <input name="note" required minLength={5} className={input} placeholder="ex. după pilot, aprobat de fondator" />
        </label>
        <button disabled={pending} className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
          {pending ? "Se salvează…" : "Salvează plafonul"}
        </button>
      </div>
      {state.error && <p role="alert" className="text-sm text-primary">{state.error}</p>}
      {!state.error && state.ok && <p role="status" className="text-sm text-emerald-300">{state.ok}</p>}
    </form>
  );
}
