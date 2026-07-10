"use client";

import { useActionState } from "react";
import { inviteCourier } from "@/app/(admin)/platform/couriers/actions";

const initialState = { error: null as string | null };

export function InviteCourierForm() {
  const [state, formAction, pending] = useActionState(inviteCourier, initialState);

  return (
    <form action={formAction} className="mb-8 flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <h2 className="font-medium">Invită curier</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <input name="full_name" placeholder="Nume complet" required className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
        <input name="email" type="email" placeholder="email@exemplu.com" required className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
        <input name="phone" placeholder="+373..." required className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
        <select name="vehicle_type" defaultValue="car" className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900">
          <option value="bike">Bicicletă</option>
          <option value="e_bike">Bicicletă electrică</option>
          <option value="scooter">Scuter</option>
          <option value="car">Mașină</option>
          <option value="on_foot">Pe jos</option>
        </select>
      </div>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded-full bg-zinc-900 px-5 py-2 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-zinc-900"
      >
        {pending ? "Se trimite..." : "Trimite invitația"}
      </button>
    </form>
  );
}
