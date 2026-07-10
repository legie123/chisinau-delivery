"use client";

import { useActionState } from "react";
import { createRestaurant } from "@/app/(admin)/platform/restaurants/actions";

const initialState = { error: null as string | null };

export function CreateRestaurantForm() {
  const [state, formAction, pending] = useActionState(createRestaurant, initialState);

  return (
    <form action={formAction} className="mb-10 flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <h2 className="font-medium">Onboardare restaurant nou</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <input name="name" placeholder="Nume" required className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
        <input name="slug" placeholder="slug-unic" required className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
        <select name="cuisine_type" defaultValue="sushi" className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900">
          <option value="sushi">Sushi</option>
          <option value="fine_dining">Fine dining</option>
          <option value="other">Altele</option>
        </select>
        <input name="sector" placeholder="Sector (ex. Centru)" className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
        <input name="address" placeholder="Adresă" required className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
        <input name="phone" placeholder="Telefon" required className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
        <input name="delivery_fee_mdl" type="number" step="0.01" min="0" placeholder="Taxă livrare (MDL)" className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
        <input name="min_order_amount_mdl" type="number" step="0.01" min="0" placeholder="Comandă minimă (MDL)" className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
      </div>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded-full bg-zinc-900 px-5 py-2 text-sm text-white transition hover:bg-zinc-700 disabled:opacity-50 dark:bg-white dark:text-zinc-900"
      >
        {pending ? "Se creează..." : "Creează restaurant"}
      </button>
    </form>
  );
}
