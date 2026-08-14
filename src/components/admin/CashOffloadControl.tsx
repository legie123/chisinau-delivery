"use client";

import { useState, useTransition } from "react";
import { recordCashOffloadAction } from "@/app/(admin)/platform/couriers/actions";

// Predarea numerarului: curierul vine la sediu cu banii, adminul confirmă suma.
// Rămâne admin-only prin design (curierul nu-și poate șterge singur datoria —
// gate în record_cash_offload), dar până acum nu exista niciun buton, deci un
// curier ajuns la plafon nu mai putea fi deblocat din aplicație.
// Suma e pre-completată cu balanța (cazul normal: predă tot), dar editabilă
// pentru predările parțiale.
export function CashOffloadControl({
  courierId,
  balanceMdl,
}: {
  courierId: string;
  balanceMdl: number;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(balanceMdl));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (balanceMdl <= 0) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setAmount(String(balanceMdl));
          setOpen(true);
        }}
        className="whitespace-nowrap rounded-full bg-gold/15 px-3 py-1 text-xs font-semibold text-gold ring-1 ring-gold/30 transition hover:bg-gold/25"
      >
        Am primit banii
      </button>
    );
  }

  const value = Number(amount);
  const invalid = !Number.isFinite(value) || value <= 0 || value > balanceMdl;

  return (
    <div className="flex flex-col gap-1.5 rounded-xl bg-white/[0.04] p-2.5 ring-1 ring-gold/20">
      <label className="text-[11px] text-white/50" htmlFor={`offload-${courierId}`}>
        Sumă predată (max {balanceMdl})
      </label>
      <div className="flex items-center gap-1.5">
        <input
          id={`offload-${courierId}`}
          type="number"
          inputMode="decimal"
          value={amount}
          min={1}
          max={balanceMdl}
          onChange={(e) => setAmount(e.target.value)}
          className="w-24 rounded-lg bg-white/5 px-2 py-1 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-gold/60"
        />
        <span className="text-xs text-white/40">MDL</span>
      </div>
      {error && <p className="text-[11px] text-primary">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={pending || invalid}
          onClick={() =>
            startTransition(async () => {
              const result = await recordCashOffloadAction(courierId, value, "predare la sediu");
              setError(result.error);
              if (!result.error) setOpen(false);
            })
          }
          className="rounded-full bg-gold px-3 py-1 text-xs font-bold text-zinc-900 transition hover:bg-gold-light disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? "Se scade…" : "Confirmă"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="text-[11px] text-white/40 underline underline-offset-2 hover:text-white/70"
        >
          Renunță
        </button>
      </div>
    </div>
  );
}
