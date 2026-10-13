"use client";

import { useActionState, useState } from "react";
import { saveCourierPayoutAccount, type PayoutAccountState } from "@/app/(courier)/profile/actions";
import { ibanError, maskIban } from "@/components/courier/payoutIban";

const initial: PayoutAccountState = { error: null };
const INPUT =
  "w-full rounded-xl bg-white/5 px-3 py-2.5 text-sm text-white placeholder-white/35 ring-1 ring-white/10 outline-none focus:ring-primary/60";

// IBAN + holder for the weekly payout. The saved IBAN is shown masked (last 4); typing a new one
// replaces it. The client rule (payoutIban.ts) gives the reason while typing and holds the button;
// the Server Action and set_payout_account check again.
export function CourierPayoutForm({
  current,
  defaultHolder,
}: {
  current: { iban: string; holder_name: string } | null;
  defaultHolder: string;
}) {
  const [state, action, pending] = useActionState(saveCourierPayoutAccount, initial);
  // Controlled: a form action resets uncontrolled inputs after every submit (React 19).
  const [iban, setIban] = useState("");
  const [holder, setHolder] = useState(current?.holder_name ?? defaultHolder);
  const hint = iban ? ibanError(iban) : null;

  return (
    <form action={action} className="flex flex-col gap-3 rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/[0.06]">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-white/70">Cont bancar pentru plata săptămânală</h2>
        <span className="text-xs text-white/50">
          {current
            ? `Acum: ${maskIban(current.iban)} · ${current.holder_name}`
            : "Nu ai salvat încă un cont. Fără el nu putem plăti săptămâna."}
        </span>
      </div>
      <label className="flex flex-col gap-1 text-xs text-white/55">
        IBAN {current ? "nou" : ""}
        <input
          name="iban"
          value={iban}
          onChange={(e) => setIban(e.target.value)}
          required
          autoComplete="off"
          spellCheck={false}
          inputMode="text"
          placeholder="MD24 AG00 0225 1000 1310 4168"
          aria-invalid={hint ? true : undefined}
          className={INPUT}
        />
        {hint && <span className="text-primary">{hint}</span>}
      </label>
      <label className="flex flex-col gap-1 text-xs text-white/55">
        Titularul contului
        <input name="holder_name" value={holder} onChange={(e) => setHolder(e.target.value)} required minLength={2} className={INPUT} />
      </label>
      <p className="text-xs text-white/45">
        Orice schimbare a IBAN-ului este înregistrată (cine, când, ultimele 4 cifre) și verificată de administrator înainte de plată.
      </p>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending || !iban || hint != null}
          className="min-h-11 rounded-full bg-primary-dark px-5 text-sm font-semibold text-white transition hover:bg-primary-darker disabled:opacity-50"
        >
          {pending ? "Se salvează…" : current ? "Actualizează contul" : "Salvează contul"}
        </button>
        {state.error && <p className="text-xs text-primary">{state.error}</p>}
        {state.saved && !state.error && <p className="text-xs text-emerald-300">Salvat.</p>}
      </div>
    </form>
  );
}
