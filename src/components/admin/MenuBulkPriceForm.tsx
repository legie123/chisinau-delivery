"use client";

import { useState, useTransition, type FormEvent } from "react";
import { applyBulkPrices, previewBulkPrices, type BulkState } from "@/app/(admin)/restaurant/menu/prices/actions";
import { offlineSafe } from "@/lib/kitchen/offlineSafe";

// Plain state + direct action calls (no <form action>): fields never reset, a network error
// becomes a message instead of the route error page, and Apply sends the previewed rows.
export function MenuBulkPriceForm({ categories }: { categories: { id: string; name: string }[] }) {
  const [state, setState] = useState<BulkState>({ error: null });
  const [pending, startTransition] = useTransition();
  const [category, setCategory] = useState("all");
  const [mode, setMode] = useState<"percent" | "amount">("percent");
  const [value, setValue] = useState("");
  const field = "rounded-xl bg-white/5 px-3 py-2.5 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-gold/60";
  const categoryName = (id: string) => (id === "all" ? "tot meniul" : categories.find((c) => c.id === id)?.name ?? "categoria aleasă");

  function preview(e: FormEvent) {
    e.preventDefault();
    startTransition(async () => setState(await offlineSafe(() => previewBulkPrices(category, mode, value))));
  }
  function apply() {
    const { params, changes } = state;
    if (!params || !changes || pending) return;
    setState({ error: null }); // the preview is consumed: a second click has nothing to send
    startTransition(async () =>
      setState(await offlineSafe(() => applyBulkPrices(params, changes.map((c) => ({ id: c.id, from: c.from }))))),
    );
  }

  return (
    <form onSubmit={preview} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-white/55">
          Categorie
          <select name="category" value={category} onChange={(e) => setCategory(e.target.value)} className={field}>
            <option value="all">Tot meniul</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-white/55">
          Tip
          <select name="mode" value={mode} onChange={(e) => setMode(e.target.value as "percent" | "amount")} className={field}>
            <option value="percent">Procent (%)</option>
            <option value="amount">Sumă fixă (MDL)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-white/55">
          Modificare (ex. 10 sau -5)
          <input name="value" value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" required className={`${field} w-32`} />
        </label>
        <button type="submit" disabled={pending} className="min-h-11 rounded-full bg-white/10 px-4 text-sm text-white ring-1 ring-white/15 disabled:opacity-50">
          Previzualizează
        </button>
      </div>
      {state.error && <p className="text-sm text-primary">{state.error}</p>}
      {state.applied !== undefined && (
        <p className="text-sm text-emerald-300">
          Am actualizat {state.applied} prețuri.
          {state.stale ? ` ${state.stale} se schimbaseră între timp și au rămas neatinse — previzualizează din nou.` : ""}
        </p>
      )}
      {state.changes && state.params && (
        state.changes.length === 0 ? (
          <p className="text-sm text-white/60">Niciun preț nu se schimbă.</p>
        ) : (
          <div className="flex flex-col gap-2">
            <ul className="max-h-80 overflow-auto rounded-2xl bg-white/5 p-3 text-sm ring-1 ring-white/10">
              {state.changes.map((c) => (
                <li key={c.id} className="flex justify-between gap-3 py-0.5">
                  <span className="text-white/80">{c.name}</span>
                  <span className="text-white/50">
                    {c.from} → <span className="font-semibold text-white">{c.to} MDL</span>
                  </span>
                </li>
              ))}
            </ul>
            <button type="button" onClick={apply} disabled={pending} className="pg-cta min-h-11 w-fit rounded-full px-5 text-sm disabled:opacity-50">
              Aplică {state.changes.length} prețuri noi în „{categoryName(state.params.category)}”
            </button>
          </div>
        )
      )}
    </form>
  );
}
