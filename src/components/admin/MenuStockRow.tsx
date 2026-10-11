"use client";

import { useState, useTransition } from "react";
import { setItemSoldOut, type SoldOutMode } from "@/app/(admin)/restaurant/stoc/actions";

// One dish on the quick stock screen. soldOutLabel is computed on the server
// (null = available) so the row renders the same state the database holds.
export function MenuStockRow({ id, name, soldOutLabel }: { id: string; name: string; soldOutLabel: string | null }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function set(mode: SoldOutMode) {
    startTransition(async () => {
      const result = await setItemSoldOut(id, mode);
      setError(result.error);
    });
  }

  const btn = "min-h-11 rounded-full px-3.5 text-xs font-semibold ring-1 transition disabled:opacity-50";
  return (
    <li className={`flex flex-wrap items-center gap-2 rounded-2xl px-4 py-3 ring-1 ${soldOutLabel ? "bg-red-500/10 ring-red-400/30" : "bg-white/5 ring-white/10"}`}>
      <span className="min-w-0 flex-1">
        <span className={soldOutLabel ? "text-white/60 line-through" : "text-white"}>{name}</span>
        {soldOutLabel && <span className="block text-xs font-semibold text-red-300">{soldOutLabel}</span>}
      </span>
      {soldOutLabel ? (
        <button type="button" disabled={pending} onClick={() => set("off")} className={`${btn} bg-emerald-500/15 text-emerald-200 ring-emerald-400/40`}>
          Din nou disponibil
        </button>
      ) : (
        <>
          <button type="button" disabled={pending} onClick={() => set("today")} className={`${btn} bg-white/5 text-white/80 ring-white/10 hover:bg-white/10`}>
            Epuizat azi
          </button>
          <button type="button" disabled={pending} onClick={() => set("indefinite")} className={`${btn} bg-white/5 text-white/60 ring-white/10 hover:bg-white/10`}>
            Până revin
          </button>
        </>
      )}
      {error && <p className="w-full text-xs text-primary">{error}</p>}
    </li>
  );
}
