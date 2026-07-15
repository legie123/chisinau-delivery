"use client";

import { useActionState } from "react";
import { createRestaurant } from "@/app/(admin)/platform/restaurants/actions";

const initialState = { error: null as string | null };

export function CreateRestaurantForm() {
  const [state, formAction, pending] = useActionState(createRestaurant, initialState);

  return (
    <form action={formAction} className="mb-10 flex flex-col gap-3 rounded-2xl bg-white/[0.04] p-4 ring-1 ring-white/[0.06]">
      <h2 className="font-medium">Onboardare restaurant nou</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <input name="name" placeholder="Nume" required className="rounded-xl bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/35 ring-1 ring-white/10 outline-none focus:ring-primary/60" />
        <input name="slug" placeholder="slug-unic" required className="rounded-xl bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/35 ring-1 ring-white/10 outline-none focus:ring-primary/60" />
        <select name="cuisine_type" defaultValue="sushi" className="rounded-xl bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/35 ring-1 ring-white/10 outline-none focus:ring-primary/60">
          <option value="sushi">Sushi</option>
          <option value="fine_dining">Fine dining</option>
          <option value="other">Altele</option>
        </select>
        <input name="sector" placeholder="Sector (ex. Centru)" className="rounded-xl bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/35 ring-1 ring-white/10 outline-none focus:ring-primary/60" />
        <input name="address" placeholder="Adresă" required className="rounded-xl bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/35 ring-1 ring-white/10 outline-none focus:ring-primary/60" />
        <input name="phone" placeholder="Telefon" required className="rounded-xl bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/35 ring-1 ring-white/10 outline-none focus:ring-primary/60" />
        <input name="delivery_fee_mdl" type="number" step="0.01" min="0" placeholder="Taxă livrare (MDL)" className="rounded-xl bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/35 ring-1 ring-white/10 outline-none focus:ring-primary/60" />
        <input name="min_order_amount_mdl" type="number" step="0.01" min="0" placeholder="Comandă minimă (MDL)" className="rounded-xl bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/35 ring-1 ring-white/10 outline-none focus:ring-primary/60" />
      </div>
      {state.error && <p className="text-sm text-red-400">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded-full bg-primary px-5 py-2 text-sm text-white transition hover:bg-primary-dark disabled:opacity-50"
      >
        {pending ? "Se creează..." : "Creează restaurant"}
      </button>
    </form>
  );
}
