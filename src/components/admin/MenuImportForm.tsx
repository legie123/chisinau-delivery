"use client";

import { useActionState, useState } from "react";
import { importMenu, type ImportState } from "@/app/(admin)/restaurant/menu/import/actions";

const initial: ImportState = { error: null };
const EXAMPLE = "Categorie\tProdus\tDescriere\tPreț\nRoluri\tCalifornia Roll\tcrab, avocado, castravete\t120\nSupe\tSupă miso\ttofu, alge wakame\t45";

export function MenuImportForm() {
  const [state, action, pending] = useActionState(importMenu, initial);
  // Controlled: a form action resets the textarea after submit, so a validation
  // error would throw away the whole paste.
  const [sheet, setSheet] = useState("");
  return (
    <form action={action} className="flex flex-col gap-3">
      <textarea
        name="sheet"
        value={sheet}
        onChange={(e) => setSheet(e.target.value)}
        rows={12}
        required
        spellCheck={false}
        placeholder={EXAMPLE}
        className="w-full rounded-2xl bg-white/5 p-4 font-mono text-xs text-white placeholder-white/30 ring-1 ring-white/10 outline-none focus:ring-gold/60"
      />
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="pg-cta min-h-11 rounded-full px-5 text-sm disabled:opacity-50">
          {pending ? "Se importă…" : "Importă"}
        </button>
        {state.imported !== undefined && !state.error && (
          <p className="text-sm text-emerald-300">
            {state.imported === 1 ? "Un produs importat ca ascuns" : `${state.imported} produse importate ca ascunse`}
            {state.createdCategories === 1 ? ", o categorie nouă" : state.createdCategories ? `, ${state.createdCategories} categorii noi` : ""}
            {state.skipped?.length ? `; ${state.skipped.length} existau deja și au fost sărite (${state.skipped.slice(0, 5).join(", ")}${state.skipped.length > 5 ? "…" : ""})` : ""}.
          </p>
        )}
      </div>
      {state.error && <p className="whitespace-pre-line text-sm text-primary">{state.error}</p>}
    </form>
  );
}
