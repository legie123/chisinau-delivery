"use client";

import { useActionState } from "react";
import { createCategory } from "@/app/(admin)/restaurant/menu/actions";

const initialState = { error: null as string | null };

export function AddCategoryForm() {
  const [state, formAction, pending] = useActionState(createCategory, initialState);

  return (
    <form action={formAction} className="mb-6 flex items-center gap-2">
      <input
        name="name"
        placeholder="Categorie nouă (ex. Roluri)"
        required
        className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-full border border-zinc-300 px-4 py-2 text-sm transition hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
      >
        {pending ? "..." : "Adaugă categorie"}
      </button>
      {state.error && <span className="text-sm text-red-600">{state.error}</span>}
    </form>
  );
}
