"use client";

import { useActionState, useState } from "react";
import { savePayoutAccount, type PayoutAccountState } from "@/app/(admin)/restaurant/earnings/actions";

const initial: PayoutAccountState = { error: null };

// Partner-side IBAN + holder for the weekly payout. The saved IBAN is shown
// masked; typing a new one replaces it.
export function PayoutAccountForm({ current }: { current: { iban: string; holder_name: string } | null }) {
  const [state, action, pending] = useActionState(savePayoutAccount, initial);
  // Controlled: a form action resets uncontrolled inputs after every submit, so a
  // rejected IBAN also wiped the holder name and the retry was blocked by `required`.
  const [iban, setIban] = useState("");
  const [holder, setHolder] = useState(current?.holder_name ?? "");
  const masked = current ? `${current.iban.slice(0, 4)} •••• ${current.iban.slice(-4)}` : null;
  const input =
    "w-full rounded-xl bg-white/5 px-3 py-2.5 text-sm text-white placeholder-white/35 ring-1 ring-white/10 outline-none focus:ring-gold/60";

  return (
    <form action={action} className="pg-card mb-8 flex flex-col gap-3 rounded-2xl p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="pg-gold-text text-sm font-semibold uppercase tracking-wide">Contul pentru plăți</h2>
        <span className="text-xs text-white/50">
          {masked ? `Salvat: ${masked} · ${current!.holder_name}` : "Lipsește — fără IBAN plata săptămânală nu poate fi trimisă."}
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-white/55">
          IBAN
          <input name="iban" value={iban} onChange={(e) => setIban(e.target.value)} required autoComplete="off" spellCheck={false} placeholder="MD24 AG00 0225 1000 1310 4168" className={input} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-white/55">
          Titular (denumirea firmei)
          <input name="holder_name" value={holder} onChange={(e) => setHolder(e.target.value)} required placeholder="SRL …" className={input} />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className="pg-cta min-h-11 rounded-full px-5 text-sm disabled:opacity-50">
          {current ? "Actualizează contul" : "Salvează contul"}
        </button>
        {state.error && <p className="text-xs text-primary">{state.error}</p>}
        {state.saved && !state.error && <p className="text-xs text-emerald-300">Salvat.</p>}
      </div>
    </form>
  );
}
