"use client";

import { useActionState } from "react";
import { createCategory } from "@/app/(admin)/restaurant/menu/actions";

const initialState = { error: null as string | null };

export function AddCategoryForm() {
  const [state, formAction, pending] = useActionState(createCategory, initialState);

  return (
    <form action={formAction} className="pg-card mb-6 flex items-center gap-2 rounded-2xl p-2.5">
      <input
        name="name"
        placeholder="Categorie nouă (ex. Roluri)"
        required
        className="rounded-xl bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/35 ring-1 ring-white/10 outline-none focus:ring-primary/60"
      />
      <button
        type="submit"
        disabled={pending}
        className="pg-cta rounded-full px-4 py-2 text-sm disabled:opacity-50"
      >
        {pending ? "..." : "Adaugă categorie"}
      </button>
      {state.error && <span className="text-sm text-red-400">{state.error}</span>}
    </form>
  );
}
