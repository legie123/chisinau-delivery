"use client";

import { startTransition, useActionState, useState, type FormEvent } from "react";
import { bulkPriceAction, type BulkState } from "@/app/(admin)/restaurant/menu/prices/actions";

const initial: BulkState = { error: null };

export function MenuBulkPriceForm({ categories }: { categories: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(bulkPriceAction, initial);
  // Controlled so a preview/refusal does not wipe the inputs (form actions reset them).
  const [category, setCategory] = useState("all");
  const [mode, setMode] = useState("percent");
  const [value, setValue] = useState("");
  // Submit by hand: <form action> resets the fields after every run, and a controlled
  // <select> then showed (and sent) "Tot meniul" while React state still said the category.
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    if (submitter?.name) fd.set(submitter.name, submitter.value);
    if (fd.get("intent") === "apply" && state.params) {
      fd.set("category", state.params.category);
      fd.set("mode", state.params.mode);
      fd.set("value", String(state.params.value));
    }
    startTransition(() => action(fd));
  }
  const categoryName = (id: string) => (id === "all" ? "tot meniul" : categories.find((c) => c.id === id)?.name ?? "categoria aleasă");
  const field = "rounded-xl bg-white/5 px-3 py-2.5 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-gold/60";

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
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
          <select name="mode" value={mode} onChange={(e) => setMode(e.target.value)} className={field}>
            <option value="percent">Procent (%)</option>
            <option value="amount">Sumă fixă (MDL)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-white/55">
          Modificare (ex. 10 sau -5)
          <input name="value" value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" required className={`${field} w-32`} />
        </label>
        <button name="intent" value="preview" disabled={pending} className="min-h-11 rounded-full bg-white/10 px-4 text-sm text-white ring-1 ring-white/15 disabled:opacity-50">
          Previzualizează
        </button>
      </div>
      {state.error && <p className="text-sm text-primary">{state.error}</p>}
      {state.applied !== undefined && <p className="text-sm text-emerald-300">Am actualizat {state.applied} prețuri.</p>}
      {state.changes && state.applied === undefined && (
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
            <button name="intent" value="apply" disabled={pending} className="pg-cta min-h-11 w-fit rounded-full px-5 text-sm disabled:opacity-50">
              Aplică {state.changes.length} prețuri noi în „{categoryName(state.params?.category ?? "all")}”
            </button>
          </div>
        )
      )}
    </form>
  );
}
